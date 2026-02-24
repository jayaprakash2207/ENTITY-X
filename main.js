const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('./db');

const IMAGE_MONITOR_API_URL =
  process.env.IMAGE_MONITOR_API_URL ||
  'http://127.0.0.1:8000/api/image-monitor';

const TEXT_MONITOR_API_URL =
  process.env.TEXT_MONITOR_API_URL ||
  'http://127.0.0.1:8000/api/text-monitor';

const IMAGE_MONITOR_SESSION_ID = crypto.randomUUID();

// Gemini AI — gemini-2.0-flash (free tier)
// Override with env var:  $env:GEMINI_API_KEY="AIza..."
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBxswoi0drK2kX-izVCxUoJfyFRKwznc5w';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// OpenRouter free-tier — Legal Complaint Generator + AI Chat Assistant
// Override with env var:  $env:OPENROUTER_API_KEY="sk-or-v1-..."
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY ||
  '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';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Ordered fallback list — fastest/most-reliable model first.
// Models marked NO_SYSTEM don't accept the 'system' role; we merge it into the first user message.
const FREE_MODELS = [
  { id: 'liquid/lfm-2.5-1.2b-instruct:free',           noSystem: false },
  { id: 'google/gemma-3-4b-it:free',                    noSystem: true  },
  { id: 'google/gemma-3-12b-it:free',                   noSystem: true  },
  { id: 'meta-llama/llama-3.2-3b-instruct:free',        noSystem: false },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',       noSystem: false },
];

// Entity cache: maps entity_id to full entity data
const ENTITY_CACHE = new Map();

/* ============= STATIC PATHS ============= */
const WEBVIEW_PRELOAD_PATH = path.join(__dirname, 'renderer', 'webview-preload.js');
const RENDERER_PRELOAD_PATH = path.join(__dirname, 'preload.js');
const INDEX_HTML_PATH = path.join(__dirname, 'renderer', 'index.html');

/* ============= UTILS ============= */

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ============= GEMINI AI SUMMARIZER ============= */

/**
 * Call Gemini 2.0 Flash to perform full forensic analysis of an article.
 * Returns comprehensive analysis including risk scores, forensic bullets, summary and claims.
 * Fails silently — application works without it (falls back to mock backend).
 */
async function callGeminiAnalysis(title, url, text) {
  if (!GEMINI_API_KEY) {
    console.log('[GEMINI] No API key set. Skipping analysis.');
    return null;
  }

  // Cap input to ~1500 words to stay within free-tier token budget
  const words = text.split(/\s+/);
  const cappedText = words.slice(0, 1500).join(' ');

  const prompt = [
    'You are a professional forensic media analyst and fact-checker. Analyze the article below.',
    'Respond ONLY with valid JSON — no markdown fences, no extra text outside the JSON object.',
    '',
    'Required JSON structure (all fields mandatory):',
    '{',
    '  "summary": "2-3 sentence plain-English summary of the article",',
    '  "topic": "one short phrase (e.g. Politics, Science, Finance, Technology, Health)",',
    '  "key_claims": ["up to 5 specific factual claims made in the article"],',
    '  "ai_generated_probability": 0.0,',
    '  "misinformation_risk": "LOW",',
    '  "credibility_score": 0.0,',
    '  "forensic_explanation": [',
    '    "Detailed forensic finding 1 (writing style, sourcing, factual consistency, etc.)",',
    '    "Detailed forensic finding 2",',
    '    "Detailed forensic finding 3",',
    '    "Detailed forensic finding 4",',
    '    "Detailed forensic finding 5"',
    '  ]',
    '}',
    '',
    'Field rules:',
    '- ai_generated_probability: float 0.0-1.0. Estimate likelihood this was written by AI based on writing patterns, sentence uniformity, vocabulary, lack of personal voice.',
    '- misinformation_risk: exactly one of "LOW", "MEDIUM", or "HIGH". Base on verifiability of claims, source quality, sensationalist language, logical consistency.',
    '- credibility_score: float 0.0-1.0. Overall credibility considering sourcing, factual accuracy, journalistic quality, and consistency.',
    '- forensic_explanation: array of 4-6 specific analytical observations about THIS article. Be specific — cite actual phrases, patterns, or facts from the text.',
    '',
    `Title: ${title}`,
    `URL: ${url}`,
    '',
    'Article content:',
    cappedText
  ].join('\n');

  try {
    console.log(`[GEMINI] Requesting forensic analysis for: ${title.substring(0, 60)}`);
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!res.ok) {
      console.warn(`[GEMINI] HTTP ${res.status} — ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip accidental markdown fences
    const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (typeof parsed.summary !== 'string') throw new Error('Unexpected response shape');

    const risk = ['LOW','MEDIUM','HIGH'].includes(parsed.misinformation_risk)
      ? parsed.misinformation_risk : 'LOW';
    const aiProb = Math.max(0, Math.min(1, parseFloat(parsed.ai_generated_probability) || 0));
    const credScore = Math.max(0, Math.min(1, parseFloat(parsed.credibility_score) || 0.5));

    console.log(`[GEMINI] Analysis OK — Risk:${risk} AI:${(aiProb*100).toFixed(0)}% Cred:${(credScore*100).toFixed(0)}% Topic:${parsed.topic}`);
    return {
      // Forensic scores (override backend mock)
      ai_generated_probability: aiProb,
      misinformation_risk: risk,
      credibility_score: credScore,
      forensic_explanation: Array.isArray(parsed.forensic_explanation) ? parsed.forensic_explanation.slice(0, 6) : [],
      // Summary enrichment
      ai_summary: parsed.summary,
      topic: parsed.topic || 'General',
      key_claims: Array.isArray(parsed.key_claims) ? parsed.key_claims.slice(0, 5) : []
    };
  } catch (err) {
    console.warn(`[GEMINI] Analysis failed (non-fatal): ${err.message}`);
    return null;
  }
}

/* ============= OPENROUTER AI (free-tier fallback chain) ============= */

/**
 * Call OpenRouter with a fallback model chain.
 * Handles models that don't accept system messages by merging system into user.
 * @param {Array<{role:string,content:string}>} messages
 * @returns {Promise<string>} The assistant reply text.
 */
async function callOpenRouterAI(messages) {
  if (!OPENROUTER_API_KEY) throw new Error('No OpenRouter API key configured.');

  let lastError = null;

  for (const model of FREE_MODELS) {
    try {
      // If model can't handle system role, prepend system content to first user message
      let msgs = messages;
      if (model.noSystem) {
        const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        const rest = messages.filter(m => m.role !== 'system');
        if (sys && rest.length > 0 && rest[0].role === 'user') {
          msgs = [{ role: 'user', content: `[Instructions: ${sys}]\n\n${rest[0].content}` }, ...rest.slice(1)];
        } else if (sys) {
          msgs = [{ role: 'user', content: sys }, ...rest];
        } else {
          msgs = rest;
        }
      }

      console.log(`[AI] Trying model: ${model.id}`);
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://entity-x.app',
          'X-Title': 'Entity X'
        },
        body: JSON.stringify({
          model: model.id,
          messages: msgs,
          temperature: 0.3,
          max_tokens: 2048
        }),
        signal: AbortSignal.timeout(40000)
      });

      const data = await res.json();

      // 429 rate-limit or provider error → try next model
      if (!res.ok || data.error) {
        const code = data?.error?.code || res.status;
        const msg  = data?.error?.message || res.statusText;
        console.warn(`[AI] ${model.id} failed (${code}): ${msg.substring(0, 80)} — trying next model`);
        lastError = new Error(`${model.id}: ${msg.substring(0, 80)}`);
        continue;
      }

      const text = data.choices?.[0]?.message?.content?.trim() || '';
      if (!text) { lastError = new Error(`${model.id}: empty response`); continue; }

      console.log(`[AI] Success with model: ${model.id} (${text.length} chars)`);
      return text;

    } catch (err) {
      console.warn(`[AI] ${model.id} threw: ${err.message} — trying next model`);
      lastError = err;
    }
  }

  throw lastError || new Error('All free models exhausted.');
}

// Keep old name as alias for backward compatibility
const callDeepSeekAI = callOpenRouterAI;

/* ============= BACKEND BRIDGE ============= */

async function postImageUrlToBackend(imageUrl, senderWebContents) {
  if (!isValidHttpUrl(imageUrl)) {
    console.error(`[BACKEND] Invalid URL: ${imageUrl}`);
    return;
  }

  try {
    console.log(`[BACKEND] Posting to ${IMAGE_MONITOR_API_URL}: ${imageUrl}`);
    const res = await fetch(IMAGE_MONITOR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        session_id: IMAGE_MONITOR_SESSION_ID,
        timestamp: Date.now()
      })
    });

    if (!res.ok) {
      console.error(`[BACKEND] HTTP error: ${res.status} ${res.statusText}`);
      return;
    }

    const analysis = await res.json();
    console.log(`[BACKEND] Analysis result: ${analysis.risk_level} | Fake: ${analysis.fake_probability}`);
    if (senderWebContents.isDestroyed()) {
      console.error('[BACKEND] Sender window destroyed, cannot send result');
      return;
    }

    // Generate entity ID for this image
    const entityId = crypto.createHash('sha256')
      .update(`image-${imageUrl}`)
      .digest('hex')
      .substring(0, 16);

    // Cache entity data for later retrieval
    ENTITY_CACHE.set(entityId, {
      entity_id: entityId,
      entity_type: 'IMAGE',
      image_url: imageUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      session_id: analysis.session_id,
      detected_at: Date.now()
    });
    // Persist to local SQLite
    db.insertEntity({ entity_id: entityId, entity_type: 'IMAGE', source_url: imageUrl, risk_level: analysis.risk_level, analysis: { fake_probability: analysis.fake_probability, trust_score: analysis.trust_score, forensic_explanation: analysis.forensic_explanation ?? [] } });
    db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: 'IMAGE', risk_level: analysis.risk_level, fake_probability: analysis.fake_probability });

    console.log(`[IPC] Sending image-monitor:analysis to renderer (entity: ${entityId})`);
    senderWebContents.send('image-monitor:analysis', {
      entity_id: entityId,
      image_url: imageUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      session_id: analysis.session_id,
      analyzed_at: Date.now()
    });
  } catch (err) {
    console.error(`[BACKEND] Fetch error: ${err.message}`);
    db.insertAuditLog('ANALYSIS_FAILED', '', IMAGE_MONITOR_SESSION_ID, { type: 'IMAGE', url: imageUrl, error: err.message.substring(0, 120) });
  }
}

async function postTextToBackend(textPayload, senderWebContents) {
  /**
   * Send extracted article text to backend for AI/misinformation analysis
   * 
   * Input: { title, url, text, word_count, timestamp }
   * Output: { ai_generated_probability, misinformation_risk, credibility_score, explanation[] }
   */
  
  if (!textPayload || typeof textPayload !== 'object') {
    console.error(`[BACKEND-TEXT] Invalid text payload`);
    return;
  }

  if (!isValidHttpUrl(textPayload.url)) {
    console.error(`[BACKEND-TEXT] Invalid URL: ${textPayload.url}`);
    return;
  }

  try {
    console.log(`[BACKEND-TEXT] Posting to ${TEXT_MONITOR_API_URL}: ${textPayload.url}`);

    // Run backend analysis and Gemini forensic analysis in parallel for speed
    const [res, gemini] = await Promise.all([
      fetch(TEXT_MONITOR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...textPayload, session_id: IMAGE_MONITOR_SESSION_ID }),
        signal: AbortSignal.timeout(30000)
      }),
      callGeminiAnalysis(textPayload.title, textPayload.url, textPayload.text)
    ]);

    if (!res.ok) {
      console.error(`[BACKEND-TEXT] HTTP error: ${res.status} ${res.statusText}`);
      return;
    }

    const analysis = await res.json();
    console.log(`[BACKEND-TEXT] Analysis result: Risk=${analysis.misinformation_risk} | AI=${(analysis.ai_generated_probability * 100).toFixed(1)}%`);

    if (senderWebContents.isDestroyed()) {
      console.error('[BACKEND-TEXT] Sender window destroyed, cannot send result');
      return;
    }

    // Generate entity ID for this text content
    const entityId = crypto.createHash('sha256')
      .update(`text-${textPayload.url}-${textPayload.title}`)
      .digest('hex')
      .substring(0, 16);

    // Build full entity — Gemini forensic results override mock backend when available
    const entity = {
      entity_id: entityId,
      entity_type: 'TEXT',
      ...textPayload,
      ...analysis,
      // Gemini overrides: replace heuristic scores with AI-generated forensic analysis
      ...(gemini ? {
        ai_generated_probability: gemini.ai_generated_probability,
        misinformation_risk: gemini.misinformation_risk,
        credibility_score: gemini.credibility_score,
        explanation: gemini.forensic_explanation,
        ai_summary: gemini.ai_summary,
        topic: gemini.topic,
        key_claims: gemini.key_claims
      } : {
        ai_summary: null,
        topic: null,
        key_claims: []
      }),
      detected_at: Date.now()
    };

    ENTITY_CACHE.set(entityId, entity);
    // Persist to local SQLite
    db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: entity.url, title: entity.content_title, text: entity.text ?? '', risk_level: entity.misinformation_risk, analysis: { ai_generated_probability: entity.ai_generated_probability, credibility_score: entity.credibility_score, trust_score: entity.trust_score } });
    db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: 'TEXT', risk_level: entity.misinformation_risk });

    console.log(`[IPC] Sending text-monitor:analysis to renderer (gemini=${gemini ? 'ok' : 'skip'})`);  
    senderWebContents.send('text-monitor:analysis', {
      entity_id: entityId,
      entity_type: 'TEXT',
      content_title: textPayload.title,
      url: textPayload.url,
      word_count: textPayload.word_count,
      // Scores: Gemini overrides mock backend when available
      ai_generated_probability: entity.ai_generated_probability,
      misinformation_risk: entity.misinformation_risk,
      credibility_score: entity.credibility_score,
      explanation: entity.explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      session_id: analysis.session_id,
      // Gemini forensic enrichment
      ai_summary: entity.ai_summary,
      topic: entity.topic,
      key_claims: entity.key_claims,
      analyzed_at: Date.now()
    });
  } catch (err) {
    console.error(`[BACKEND-TEXT] Fetch error: ${err.message}`);
    db.insertAuditLog('ANALYSIS_FAILED', '', IMAGE_MONITOR_SESSION_ID, { type: 'TEXT', url: textPayload?.url || '', error: err.message.substring(0, 120) });
  }
}

/* ============= EVIDENCE PDF BUILDER ============= */

/**
 * Build a self-contained, print-ready HTML string for a Full Proof Mode PDF.
 *
 * Structure:
 *   Page 1  — Cover Page
 *   Page 2+ — Entity Details | Forensic Scores | Evidence Section
 *            (IMAGE: embedded thumbnail | TEXT: article body + word count)
 *            AI Summary | Key Claims | Forensic Findings | Legal Disclaimer
 *
 * @param {object} p  Enriched entity payload.  Extra fields added by the IPC handler:
 *   p.imageDataUri  {string|null}  base64 data URI of the detected image
 *   p.articleText   {string|null}  full article body from ENTITY_CACHE
 */
function buildEvidenceHtml(p) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(ts) {
    if (!ts) return 'Unknown';
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + '\u2002' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }
  function pct(v) { return (parseFloat(v) || 0) * 100; }

  const risk       = (p.risk_level || 'LOW').toUpperCase();
  const riskCls    = risk === 'HIGH' ? 'risk-high' : risk === 'MEDIUM' ? 'risk-med' : 'risk-low';
  const isText     = (p.entity_type || '').toUpperCase() === 'TEXT';
  const entityType = (p.entity_type || 'UNKNOWN').toUpperCase();
  const source     = esc(p.source_url || 'N/A');
  const title      = esc(p.content_title || (isText ? 'Text Entity' : 'Image Entity'));
  const aiProb     = pct(p.ai_generated_probability);
  const fakeProb   = pct(p.fake_probability);
  const credScore  = pct(p.credibility_score);
  const trust      = parseFloat(p.trust_score) || 100;
  const trustDelta = parseFloat(p.trust_score_delta) || 0;
  const findings   = Array.isArray(p.forensic_explanation) ? p.forensic_explanation
                   : (Array.isArray(p.explanation) ? p.explanation : []);
  const keyClaims  = Array.isArray(p.key_claims) ? p.key_claims : [];
  const aiSummary  = p.ai_summary || null;
  const topic      = p.topic || null;
  const wordCount  = p.word_count ? Number(p.word_count).toLocaleString() : null;
  const now        = new Date().toISOString().replace('T', '\u2002').slice(0, 19) + ' UTC';

  /* ── Section builders ── */
  function field(label, val) {
    return `<tr><td class="fl">${esc(label)}</td><td class="fv">${val}</td></tr>`;
  }
  function scoreRow(label, value, pctVal, color) {
    const w   = Math.round(Math.min(100, Math.max(0, pctVal)));
    const bar = `<div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color};"></div></div>`;
    return `<tr><td class="sl">${esc(label)}</td><td class="sv" style="color:${color};">${esc(value)}</td><td class="sb">${bar}</td></tr>`;
  }

  const findingsHtml = findings.length
    ? findings.map((f, i) =>
        `<div class="finding"><span class="fn">${i + 1}</span><span class="ft2">${esc(String(f))}</span></div>`
      ).join('')
    : '<div class="nodata">No forensic findings recorded.</div>';

  const claimsHtml = keyClaims.length
    ? `<div class="sec"><div class="sec-title">Key Claims Identified</div>${keyClaims.map((c, i) =>
        `<div class="claim"><span class="cn">C${i + 1}</span><span class="ct">${esc(String(c))}</span></div>`
      ).join('')}</div>` : '';

  const summaryHtml = aiSummary
    ? `<div class="sec"><div class="sec-title">AI Forensic Summary${topic ? ` &mdash; ${esc(topic)}` : ''}</div><p class="sumtext">${esc(aiSummary)}</p></div>` : '';

  /* ── Evidence section ── */
  let evidenceHtml = '';
  if (!isText) {
    /* IMAGE evidence */
    const imgSrc    = p.imageDataUri || null;
    const imgBlock  = imgSrc
      ? `<div class="ev-img-wrap"><img class="ev-img" src="${imgSrc}" alt="Detected image evidence"></div>`
      : `<div class="nodata">Image could not be embedded (URL may have expired or is unreachable).</div>`;
    evidenceHtml = `
    <div class="sec">
      <div class="sec-title">Evidence &mdash; Image</div>
      ${imgBlock}
      <table class="ft" style="margin-top:8px;">
        ${field('Image URL', `<span style="word-break:break-all;font-size:8pt;">${source}</span>`)}
        ${field('Detection Time', fmtDate(p.detected_at))}
        ${p.analyzed_at ? field('Analysis Time', fmtDate(p.analyzed_at)) : ''}
        ${imgSrc ? field('Evidence Status', '<span style="color:#059669;font-weight:700;">\u2714 Image embedded in report</span>') : field('Evidence Status', '<span style="color:#b45309;">\u26A0 Image not available for embedding</span>')}
      </table>
    </div>`;
  } else {
    /* TEXT / NEWS evidence */
    const body = p.articleText ? String(p.articleText) : null;
    /* Cap article body at ~4 000 chars to prevent multi-page overflow */
    const bodyDisplay = body ? esc(body.length > 4000 ? body.slice(0, 4000) + '\u2026 [truncated]' : body) : null;
    const textBlock = bodyDisplay
      ? `<div class="article-block">${bodyDisplay}</div>`
      : `<div class="nodata">Full article text not available (manual input or text not captured).</div>`;
    evidenceHtml = `
    <div class="sec">
      <div class="sec-title">Evidence &mdash; Article / Text Content</div>
      <table class="ft" style="margin-bottom:9px;">
        ${field('Source URL', `<span style="word-break:break-all;font-size:8pt;">${source}</span>`)}
        ${wordCount ? field('Word Count', `<strong>${wordCount}</strong> words`) : ''}
        ${field('Detection Time', fmtDate(p.detected_at))}
        ${p.analyzed_at ? field('Analysis Time', fmtDate(p.analyzed_at)) : ''}
        ${body ? field('Evidence Status', '<span style="color:#059669;font-weight:700;">\u2714 Article text embedded in report</span>') : field('Evidence Status', '<span style="color:#b45309;">\u26A0 Article text not available</span>')}
      </table>
      ${textBlock}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Entity X \u2014 Evidence Report</title>
<style>
  @page { size: A4; margin: 16mm 15mm 18mm 15mm; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2535; font-size: 10pt; line-height: 1.5; background: #fff; }

  /* \u2500\u2500 Cover page \u2500\u2500 */
  .cover { display: flex; flex-direction: column; justify-content: center; min-height: 96vh; padding: 40px 30px;
           background: linear-gradient(160deg, #0a1525 0%, #0d2040 60%, #0a1525 100%); color: #fff; border-radius: 4px; }
  .cover-logo { font-size: 46pt; font-weight: 900; letter-spacing: 0.07em; color: #fff; margin-bottom: 8px; }
  .cover-logo span { color: #4facfe; }
  .cover-tag  { font-size: 10pt; letter-spacing: 0.18em; text-transform: uppercase; color: #4facfe;
                margin-bottom: 48px; font-weight: 600; }
  .cover-rule { height: 2px; background: linear-gradient(90deg, #4facfe 0%, transparent 100%); margin-bottom: 36px; }
  .cover-rpt  { font-size: 22pt; font-weight: 700; color: #dfe7ef; margin-bottom: 6px; }
  .cover-sub  { font-size: 10pt; color: #4a6a85; margin-bottom: 40px; }
  .cover-meta { font-size: 9pt; color: #4a6a85; line-height: 2; }
  .cover-meta strong { color: #8ab8d8; }
  .cover-stamp { margin-top: 60px; font-size: 8pt; font-weight: 700; letter-spacing: 0.15em;
                 text-transform: uppercase; color: #2d4a62; border: 1px solid #2d4a62;
                 display: inline-block; padding: 4px 12px; border-radius: 3px; }
  .page-break { page-break-after: always; }

  /* \u2500\u2500 Report header (page 2+) \u2500\u2500 */
  .hdr { display: flex; justify-content: space-between; align-items: flex-start;
         border-bottom: 2.5px solid #1a4a8a; padding-bottom: 10px; margin-bottom: 16px; }
  .logo { font-size: 17pt; font-weight: 900; letter-spacing: 0.06em; color: #0d1a2e; }
  .logo span { color: #1a5fba; }
  .hdr-right { text-align: right; font-size: 7.5pt; color: #5a6a80; line-height: 1.6; }
  .hdr-right strong { color: #2a3a50; }
  .rpt-title { font-size: 12pt; font-weight: 700; color: #0d1a2e; margin-bottom: 1px; }
  .rpt-sub   { font-size: 8pt; color: #5a6a80; }

  /* \u2500\u2500 Section \u2500\u2500 */
  .sec { margin-bottom: 14px; }
  .sec-title { font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
               color: #1a5fba; border-bottom: 1px solid #c4d8f0; padding-bottom: 4px; margin-bottom: 9px; }

  /* \u2500\u2500 Field table \u2500\u2500 */
  .ft { width: 100%; border-collapse: collapse; }
  .fl { width: 170px; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: #4a5a70; padding: 3px 8px 3px 0; vertical-align: top; white-space: nowrap; }
  .fv { font-size: 9pt; color: #1a2535; padding: 3px 0; word-break: break-all; vertical-align: top; }

  /* \u2500\u2500 Risk badge \u2500\u2500 */
  .risk-high { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;
               padding: 1.5px 9px; border-radius: 3px; font-weight: 700; font-size: 8pt; text-transform: uppercase; }
  .risk-med  { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
               padding: 1.5px 9px; border-radius: 3px; font-weight: 700; font-size: 8pt; text-transform: uppercase; }
  .risk-low  { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7;
               padding: 1.5px 9px; border-radius: 3px; font-weight: 700; font-size: 8pt; text-transform: uppercase; }
  .type-badge { display: inline-block; padding: 2px 9px; border-radius: 3px; font-size: 8pt; font-weight: 700;
                text-transform: uppercase;
                background: ${isText ? 'rgba(192,132,252,.15)' : 'rgba(59,130,246,.1)'};
                color: ${isText ? '#7c3aed' : '#1d4ed8'};
                border: 1px solid ${isText ? 'rgba(192,132,252,.35)' : 'rgba(59,130,246,.3)'}; }

  /* \u2500\u2500 Score rows \u2500\u2500 */
  .st { width: 100%; border-collapse: collapse; }
  .st thead th { font-size: 7.5pt; font-weight: 700; text-transform: uppercase;
                 letter-spacing: 0.07em; color: #5a6a80; padding: 3px 8px;
                 border-bottom: 1px solid #e0eaf5; text-align: left; }
  .sl { width: 160px; font-size: 8.5pt; color: #2a3a50; padding: 5px 8px 5px 0; font-weight: 600; }
  .sv { width: 80px; font-size: 9.5pt; font-weight: 700; padding: 5px 8px; font-variant-numeric: tabular-nums; }
  .sb { padding: 5px 0; }
  .bar-track { background: #e8f0fa; border-radius: 3px; height: 6px; width: 120px; }
  .bar-fill  { height: 6px; border-radius: 3px; }

  /* \u2500\u2500 Evidence \u2500\u2500 */
  .ev-img-wrap { text-align: center; padding: 8px 0; }
  .ev-img      { max-width: 100%; max-height: 260px; border: 1px solid #d0dcea;
                 border-radius: 4px; object-fit: contain; display: inline-block; }
  .article-block { margin-top: 8px; padding: 10px 13px; background: #f7f9fc;
                   border: 1px solid #d8e6f5; border-radius: 4px;
                   font-family: 'Courier New', Courier, monospace;
                   font-size: 7.5pt; line-height: 1.7; color: #2a3a50;
                   white-space: pre-wrap; word-break: break-word;
                   max-height: 520px; overflow: hidden; }

  /* \u2500\u2500 Forensic findings \u2500\u2500 */
  .finding { display: flex; gap: 8px; padding: 6px 9px; background: #f5f8fc;
             border-left: 3px solid #1a5fba; border-radius: 0 3px 3px 0;
             margin-bottom: 5px; page-break-inside: avoid; }
  .fn  { font-size: 8pt; font-weight: 700; color: #5a7090; min-width: 16px; flex-shrink: 0; margin-top: 1px; }
  .ft2 { font-size: 9pt; color: #2a3a50; line-height: 1.5; }

  /* \u2500\u2500 Claims \u2500\u2500 */
  .claim { display: flex; gap: 8px; padding: 5px 9px; background: #f8fafb;
           border: 1px solid #e0eaf5; border-radius: 3px;
           margin-bottom: 4px; page-break-inside: avoid; }
  .cn { font-size: 7.5pt; font-weight: 700; color: #1a5fba; background: #dceeff;
        padding: 1px 5px; border-radius: 2px; flex-shrink: 0; margin-top: 1px; }
  .ct { font-size: 9pt; color: #2a3a50; line-height: 1.4; }

  /* \u2500\u2500 AI Summary \u2500\u2500 */
  .sumtext { font-size: 9.5pt; color: #2a3a50; line-height: 1.7;
             background: #f0f6ff; border: 1px solid #b8d4f8; border-radius: 4px;
             padding: 9px 12px; }

  /* \u2500\u2500 Disclaimer \u2500\u2500 */
  .disclaimer { padding: 10px 13px; background: #fffbeb; border: 1px solid #fcd34d;
                border-radius: 4px; font-size: 8pt; color: #78350f; line-height: 1.6; }
  .disclaimer strong { color: #92400e; }

  /* \u2500\u2500 Fixed footer \u2500\u2500 */
  .footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #c4d4e8;
            padding-top: 4px; display: flex; justify-content: space-between;
            font-size: 7pt; color: #8a9aaa; }

  /* \u2500\u2500 Watermark \u2500\u2500 */
  .wm { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-32deg);
        font-size: 72pt; font-weight: 900; color: rgba(26,95,186,0.04);
        pointer-events: none; white-space: nowrap; letter-spacing: 0.1em; }

  .nodata { font-size: 9pt; color: #8a9aaa; padding: 6px 0; }
</style>
</head>
<body>

<!-- ======================================
     PAGE 1: COVER
     ====================================== -->
<div class="cover">
  <div class="cover-logo">ENTITY<span>X</span></div>
  <div class="cover-tag">AI-Generated Media Intelligence Platform</div>
  <div class="cover-rule"></div>
  <div class="cover-rpt">Evidence Report</div>
  <div class="cover-sub">Forensic Analysis Output &mdash; Full Proof Mode</div>
  <div class="cover-meta">
    <div><strong>Entity ID</strong>&nbsp;&nbsp;&nbsp; ${esc(p.entity_id || 'N/A')}</div>
    <div><strong>Entity Type</strong>&nbsp; ${esc(entityType)}</div>
    ${title ? `<div><strong>Title</strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${title}</div>` : ''}
    <div><strong>Generated</strong>&nbsp;&nbsp;&nbsp; ${now}</div>
    ${p.session_id ? `<div><strong>Session</strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${esc(p.session_id)}</div>` : ''}
  </div>
  <div class="cover-stamp">Automated Analysis &mdash; Not Legal Advice</div>
</div>

<div class="page-break"></div>

<!-- ======================================
     PAGE 2+: REPORT BODY
     ====================================== -->
<div class="wm">ENTITY X</div>

<div class="hdr">
  <div>
    <div class="logo">ENTITY<span>X</span></div>
    <div class="rpt-title" style="margin-top:4px;">Evidence Report &mdash; Full Proof Mode</div>
    <div class="rpt-sub">Forensic Analysis Output &middot; Entity X Intelligence Platform</div>
  </div>
  <div class="hdr-right">
    <div><strong>Generated:</strong> ${now}</div>
    <div><strong>Entity ID:</strong> ${esc(p.entity_id || 'N/A')}</div>
    <div style="margin-top:5px;font-size:7pt;color:#b04000;">AUTOMATED ANALYSIS &mdash; NOT LEGAL ADVICE</div>
  </div>
</div>

<!-- Entity Details -->
<div class="sec">
  <div class="sec-title">Entity Details</div>
  <table class="ft">
    ${field('Entity ID', esc(p.entity_id || 'N/A'))}
    ${field('Entity Type', `<span class="type-badge">${esc(entityType)}</span>`)}
    ${title !== (isText ? 'Text Entity' : 'Image Entity') ? field('Title', title) : ''}
    ${field('Source URL', `<span style="word-break:break-all;font-size:8.5pt;">${source}</span>`)}
    ${field('Detection Time', fmtDate(p.detected_at))}
    ${p.analyzed_at ? field('Analysis Time', fmtDate(p.analyzed_at)) : ''}
    ${field('Risk Level', `<span class="${riskCls}">${risk}</span>`)}
    ${wordCount ? field('Word Count', `${wordCount} words`) : ''}
  </table>
</div>

<!-- Forensic Scores -->
<div class="sec">
  <div class="sec-title">Forensic Scores &amp; Probabilities</div>
  <table class="st">
    <thead><tr><th>Metric</th><th>Value</th><th>Distribution</th></tr></thead>
    <tbody>
      ${scoreRow('AI-Generated Probability', aiProb.toFixed(1) + '%', aiProb,
          aiProb >= 70 ? '#dc2626' : aiProb >= 40 ? '#d97706' : '#059669')}
      ${isText
        ? scoreRow('Credibility Score', credScore.toFixed(1) + '%', credScore,
            credScore >= 70 ? '#1d4ed8' : credScore >= 45 ? '#d97706' : '#dc2626')
        : scoreRow('Fake Probability', fakeProb.toFixed(1) + '%', fakeProb,
            fakeProb >= 70 ? '#dc2626' : fakeProb >= 40 ? '#d97706' : '#059669')}
      ${scoreRow('Trust Score', trust.toFixed(0) + ' / 100', trust,
          trust >= 80 ? '#059669' : trust >= 50 ? '#d97706' : '#dc2626')}
      ${trustDelta !== 0
        ? scoreRow('Trust Score Delta',
            (trustDelta > 0 ? '+' : '') + trustDelta.toFixed(2),
            Math.abs(trustDelta) * 10,
            trustDelta < 0 ? '#dc2626' : '#059669')
        : ''}
    </tbody>
  </table>
</div>

<!-- Evidence section (IMAGE or TEXT) -->
${evidenceHtml}

<!-- AI Summary -->
${summaryHtml}

<!-- Key Claims -->
${claimsHtml}

<!-- Forensic Findings -->
<div class="sec">
  <div class="sec-title">Forensic Findings (${findings.length})</div>
  ${findingsHtml}
</div>

<!-- Legal Disclaimer -->
<div class="sec">
  <div class="sec-title">Legal Disclaimer &amp; Limitations</div>
  <div class="disclaimer">
    <strong>NOT LEGAL ADVICE.</strong> This report is an automated probabilistic analysis output produced
    by Entity X, an AI-assisted forensic media intelligence platform. All scores, probabilities, and
    assessments are estimates generated by machine-learning and heuristic systems and may contain errors.
    This document does not constitute a legal filing, formal complaint, regulatory submission, or legal
    advice of any kind. Do not submit this report as formal evidence without independent legal review.
    Forensic findings reflect statistical patterns only and do not prove intent, authorship,
    or legal liability. Image embedding is for reference only &mdash; the original source URL is the
    authoritative source. Consult a qualified legal professional before taking any formal action.
  </div>
</div>

<div class="footer">
  <span>Entity X Evidence Report &middot; ${esc(p.entity_id || 'N/A')} &middot; ${esc(entityType)}</span>
  <span>Generated ${now} &middot; Probabilistic automated analysis</span>
</div>

</body>
</html>`;
}

/* ============= WINDOW SETUP ============= */

let _mainWindow = null;

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: RENDERER_PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      enableRemoteModule: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(INDEX_HTML_PATH);
  mainWindow.webContents.openDevTools();

  if (process.env.DEBUG_ELECTRON) {
    console.log(`[MAIN] Webview preload path: file://${WEBVIEW_PRELOAD_PATH}`);
  }

  _mainWindow = mainWindow;
  return mainWindow;
}

/* ============= PYTHON BACKEND AUTO-SPAWN ============= */

let _backendProcess = null;

function startBackend() {
  const projectRoot = __dirname;
  const uvicorn = path.join(projectRoot, '.venv', 'Scripts', 'uvicorn.exe');

  console.log('[BACKEND] Spawning Python backend (backend.main:app)...');
  _backendProcess = spawn(uvicorn, [
    'backend.main:app',
    '--host', '127.0.0.1',
    '--port', '8000'
  ], {
    cwd: projectRoot,
    stdio: 'pipe',
    windowsHide: true
  });

  _backendProcess.stdout.on('data', d => process.stdout.write('[PY] ' + d));
  _backendProcess.stderr.on('data', d => process.stderr.write('[PY] ' + d));
  _backendProcess.on('close', code => {
    console.log(`[BACKEND] Process exited (code ${code})`);
    _backendProcess = null;
  });
  _backendProcess.on('error', err => {
    console.error('[BACKEND] Spawn error:', err.message);
  });
}

function stopBackend() {
  if (!_backendProcess) return;
  console.log('[BACKEND] Shutting down Python backend...');
  try {
    spawn('taskkill', ['/F', '/T', '/PID', String(_backendProcess.pid)], { windowsHide: true });
  } catch (_) {
    _backendProcess.kill();
  }
  _backendProcess = null;
}

// Start backend immediately — before the window opens so it has time to boot
startBackend();

/* ============= SESSION-LEVEL WEBVIEW INTERCEPTOR ============= */
/*
 * Intercepts ALL completed requests made by the webview's persist:browser
 * partition at the session level — no webview preload IPC chain required.
 * Triggered by Electron's net module before responses reach the renderer.
 */

/** URLs sent to backend this session (deduped per navigation) */
const _seenImageUrls = new Set();

function installWebviewInterceptors() {
  const webviewSession = session.fromPartition('persist:browser');

  /* ── Image interceptor ── */
  webviewSession.webRequest.onCompleted(
    { urls: ['http://*/*', 'https://*/*'] },
    (details) => {
      if (!_mainWindow || _mainWindow.isDestroyed()) return;
      if (details.statusCode < 200 || details.statusCode >= 300) return;

      const ct = (details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'] || [])[0] || '';
      const mime = ct.split(';')[0].trim().toLowerCase();

      const isImage = /^image\/(jpeg|jpg|png|webp|gif|avif|bmp)$/i.test(mime)
        || /\.(jpg|jpeg|png|webp|gif|avif|bmp)(\?|$)/i.test(details.url)
        || details.resourceType === 'image';

      if (!isImage) return;
      if (_seenImageUrls.has(details.url)) return;
      _seenImageUrls.add(details.url);

      console.log(`[INTERCEPT-IMG] Detected: ${details.url.substring(0, 80)}`);
      postImageUrlToBackend(details.url, _mainWindow.webContents);
    }
  );

  console.log('[INTERCEPT] Webview session interceptors installed on persist:browser');
}

/* ============= IPC HANDLERS ============= */

app.whenReady().then(() => {
  // Initialise local SQLite database (userData dir, persists across restarts)
  db.initDb(path.join(app.getPath('userData'), 'entityx.db'));

  // Restore entity cache from persisted DB so entity:details & history work across restarts
  try {
    const { records } = db.queryEntities({ limit: 2000 });
    let restored = 0;
    records.forEach(row => {
      if (row.entity_id && !ENTITY_CACHE.has(row.entity_id)) {
        const isImage = (row.entity_type || '').toUpperCase() === 'IMAGE';
        ENTITY_CACHE.set(row.entity_id, {
          entity_id:    row.entity_id,
          entity_type:  row.entity_type,
          source_url:   row.source_url,
          image_url:    isImage ? row.source_url : undefined,
          title:        row.title,
          content_title: row.title,
          url:          row.source_url,
          text:         row.extracted_text,
          risk_level:   row.risk_level,
          detected_at:  row.detected_at,
          _from_db:     true,
          ...row.analysis
        });
        restored++;
      }
    });
    if (restored > 0) console.log(`[DB] Restored ${restored} entities into memory cache`);
  } catch (restoreErr) {
    console.error('[DB] Cache restore error:', restoreErr.message);
  }

  createMainWindow();
  installWebviewInterceptors();

  /* Navigation event from renderer — clear dedup cache so a revisited page
   * can have its images re-analyzed on a fresh load */
  ipcMain.on('webview:navigated', (event, url) => {
    _seenImageUrls.clear();
    console.log(`[INTERCEPT] Nav — image cache cleared. New URL: ${url ? url.substring(0, 60) : '?'}`);
  });

  /* Fallback: renderer can still forward webview payloads via these channels */
  ipcMain.on('image-monitor:url', (event, url) => {
    if (!_seenImageUrls.has(url)) {
      _seenImageUrls.add(url);
      postImageUrlToBackend(url, _mainWindow ? _mainWindow.webContents : event.sender);
    }
  });
  ipcMain.on('text-monitor:article', (event, payload) => {
    postTextToBackend(payload, _mainWindow ? _mainWindow.webContents : event.sender);
  });

  /* Entity detail lookup — returns full cached entity including raw text/image data.
   * Falls back to SQLite when not in memory (entity from a previous session). */
  ipcMain.handle('entity:details', (event, entityId) => {
    if (!entityId) return null;
    const entity = ENTITY_CACHE.get(entityId);
    if (entity) {
      db.insertAuditLog('ENTITY_VIEWED', entityId, '', { source: 'cache' });
      return entity;
    }
    // Not in memory — try persisted DB (e.g., entity opened after app restart)
    try {
      const row = db.getEntity(entityId);
      if (row) {
        const isImage = (row.entity_type || '').toUpperCase() === 'IMAGE';
        const restored = {
          entity_id:    row.entity_id,
          entity_type:  row.entity_type,
          source_url:   row.source_url,
          image_url:    isImage ? row.source_url : undefined,
          title:        row.title,
          content_title: row.title,
          url:          row.source_url,
          text:         row.extracted_text,
          risk_level:   row.risk_level,
          detected_at:  row.detected_at,
          _from_db:     true,
          ...row.analysis
        };
        ENTITY_CACHE.set(entityId, restored);
        db.insertAuditLog('ENTITY_VIEWED', entityId, '', { source: 'db_restore' });
        return restored;
      }
    } catch (e) {
      console.error('[ENTITY:DETAILS] DB fallback error:', e.message);
    }
    return null;
  });

  /* Legal complaint draft generation from entity data */
  ipcMain.handle('legal:generate-complaint', async (event, payload = {}) => {
    try {
      const lines = [];
      if (payload.entity_type)   lines.push(`Entity Type: ${payload.entity_type}`);
      if (payload.source_url)    lines.push(`Source URL: ${payload.source_url}`);
      if (payload.content_title)             lines.push(`Title / Description: ${payload.content_title}`);
      if (payload.misinformation_risk)       lines.push(`Risk Verdict: ${payload.misinformation_risk}`);
      if (payload.ai_generated_probability != null)
        lines.push(`AI-Generated Probability: ${(payload.ai_generated_probability * 100).toFixed(1)}%`);
      if (payload.fake_probability != null)
        lines.push(`Synthetic / Fake Probability: ${(payload.fake_probability * 100).toFixed(1)}%`);
      if (payload.credibility_score != null)
        lines.push(`Credibility Score: ${(payload.credibility_score * 100).toFixed(1)}%`);
      if (payload.ai_summary)
        lines.push(`\nAI Analysis Summary:\n${payload.ai_summary}`);
      if (Array.isArray(payload.forensic_findings) && payload.forensic_findings.length)
        lines.push(`\nForensic Findings:\n${payload.forensic_findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}`);
      if (Array.isArray(payload.key_claims) && payload.key_claims.length)
        lines.push(`\nKey Claims Identified:\n${payload.key_claims.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);

      const systemPrompt =
        'You are a professional legal document assistant specialising in drafting platform content-review requests, ' +
        'formal complaints, and regulatory notices based on forensic media-analysis data. ' +
        'Your drafts are neutral, factual, and formally structured, suitable for submission to platform ' +
        'trust-and-safety teams, press regulators, or legal counsel. ' +
        'Always conclude with a disclaimer that findings are probabilistic outputs of automated systems.';

      const userPrompt =
        'Generate a professional, ready-to-submit complaint / platform-review request based on the ' +
        'following forensic analysis data.\n\n' +
        lines.join('\n') +
        '\n\nThe complaint must:\n' +
        '1. Have a formal subject line and date\n' +
        '2. Identify the content and its source clearly\n' +
        '3. Present the forensic evidence and metrics in a structured way\n' +
        '4. State a clear request/demand (e.g. content review, removal, labelling, or investigation)\n' +
        '5. Note that the evidence was produced by an AI-assisted forensic analysis platform\n' +
        '6. End with a disclaimer that all findings are probabilistic estimates\n\n' +
        'Write the complete letter now.';

      console.log('[LEGAL] Calling OpenRouter AI to generate complaint draft...');
      const draft = await callOpenRouterAI([
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   }
      ]);

      const evidence_summary = {
        entity_type:               payload.entity_type,
        source_url:                payload.source_url,
        content_title:             payload.content_title,
        risk_level:                payload.misinformation_risk,
        ai_generated_probability:  payload.ai_generated_probability,
        fake_probability:          payload.fake_probability,
        credibility_score:         payload.credibility_score,
        forensic_findings:         payload.forensic_findings || [],
        key_claims:                payload.key_claims || [],
        generated_at:              new Date().toISOString(),
        model:                     FREE_MODELS[0].id + ' (OpenRouter free)'
      };

      console.log('[LEGAL] AI draft generated successfully.');
      // Persist legal session and audit event
      db.insertLegalSession(payload.entity_id || '', `Complaint: ${payload.content_title || payload.entity_type || 'entity'}`, draft, 'COMPLAINT_DRAFT');
      db.insertAuditLog('LEGAL_CHAT_USED', payload.entity_id || '', '', { type: 'complaint_draft', entity_type: payload.entity_type });
      return { complaint_draft: draft, evidence_summary };
    } catch (e) {
      console.error('[LEGAL] AI generate error:', e.message);
      return { error: e.message };
    }
  });

  /* AI Chat Assistant — general Q&A powered by OpenRouter free AI */
  ipcMain.handle('ai:chat', async (event, { messages = [], context = null } = {}) => {
    try {
      /* ──────────────────────────────────────────────────────────────────
       * Entity X performs continuous, silent, background monitoring and
       * assists users through explainable, ethical AI guidance.
       * ────────────────────────────────────────────────────────────────── */
      const isAdvisorCtx = context && context._role === 'entity_x_advisor';
      const systemContent =
        'You are Entity X — a calm, factual, and ethical digital security advisor.\n' +
        'Entity X performs continuous, silent, background monitoring and assists users through explainable, ethical AI guidance.\n\n' +
        'YOUR ROLE:\n' +
        'You explain, summarise, and advise based SOLELY on already-detected forensic data provided by the platform.\n' +
        'You do NOT perform scans, make new detections, or access external data.\n\n' +
        'YOU CAN HELP WITH:\n' +
        '- Explaining in plain language why content was flagged\n' +
        '- Interpreting trust scores, risk levels, AI probability, and credibility scores\n' +
        '- Summarising forensic indicators without technical jargon\n' +
        '- Advising what the user can do next (verify, report, seek independent review)\n' +
        '- Explaining platform reporting options (Meta, YouTube, Google, Twitter/X, etc.)\n' +
        '- Verification tips and digital media literacy\n' +
        '- Friendly general conversation, like an intelligent assistant\n\n' +
        'STRICT RULES — ALWAYS FOLLOW THESE:\n' +
        '1. Use probabilistic language only: "may indicate", "appears to suggest", "could be consistent with"\n' +
        '2. NEVER make definitive claims about authenticity or guilt\n' +
        '3. NEVER provide formal legal advice — only general procedural information\n' +
        '4. NEVER use fear-based, alarmist, or accusatory language\n' +
        '5. NEVER trigger any automatic actions\n' +
        '6. Keep responses SHORT, clear, and practical\n' +
        '7. Use bullet points when listing 3 or more items\n' +
        '8. End responses that discuss risk with a calm, reassuring note\n\n' +
        'TONE: Professional, calm, transparent, and reassuring.\n' +
        (isAdvisorCtx
          ? `\n\nCurrent entity under analysis (read-only context):\n${JSON.stringify(context, null, 2)}`
          : context
            ? `\n\nCase context the user is working on:\n${JSON.stringify(context, null, 2)}`
            : '');

      const response = await callOpenRouterAI([
        { role: 'system', content: systemContent },
        ...messages
      ]);
      db.insertAuditLog('AI_CHAT_USED', context?.entity_id || '', '', { message_count: messages.length });
      return { response };
    } catch (e) {
      console.error('[AI-CHAT] Error:', e.message);
      return { error: e.message };
    }
  });

  /* ── Legal Awareness Chat ─────────────────────────────────────────────────
   * Channel: legal-chat:query
   * Payload: { entity_id, user_query }
   *
   * 1. Generates a jurisdiction-aware, ethically framed awareness response
   *    using the OpenRouter free AI chain.
   * 2. Saves the exchange immutably to legal_sessions (never overwrites).
   * 3. Logs to audit_log for transparency.
   * Returns: { ai_response, timestamp } or { error }
   * ────────────────────────────────────────────────────────────────────────── */
  ipcMain.handle('legal-chat:query', async (event, { entity_id = '', user_query = '' } = {}) => {
    if (!user_query.trim()) return { error: 'Empty query — nothing to process.' };

    const systemPrompt =
      'You are Entity X Legal Awareness Module — a calm, factual, jurisdiction-aware AI assistant.\n' +
      'Your ONLY purpose is to provide GENERAL LEGAL AWARENESS information about digital-content law.\n\n' +
      'SCOPE — you may discuss:\n' +
      '- Bharatiya Nyaya Sanhita (BNS) 2023 sections relevant to digital misuse in India\n' +
      '- IT Act 2000 provisions (Sections 43, 66, 66B, 66C, 66D, 67, 72, 72A)\n' +
      '- Global equivalents: GDPR (EU), DMCA (US), EU Digital Services Act, UK Online Safety Act\n' +
      '- Platform reporting options (Meta, Google, YouTube, X/Twitter)\n' +
      '- General steps a person may explore (document, preserve, report)\n\n' +
      'STRICT RULES — NEVER BREAK THESE:\n' +
      '1. Always begin responses with the disclaimer:\n' +
      '   "This information is for general awareness only and not legal advice."\n' +
      '2. NEVER tell the user to file an FIR, lodge a complaint, or take legal action. Use phrases like\n' +
      '   "may be explored", "commonly considered", "awareness-only".\n' +
      '3. NEVER accuse any person or platform of wrongdoing.\n' +
      '4. NEVER make definitive claims about legality or guilt.\n' +
      '5. Keep responses concise — use bullet points for lists of 3 or more items.\n' +
      '6. If the question is outside your scope, say so clearly and suggest the user consult\n' +
      '   a qualified legal professional.\n\n' +
      'TONE: Professional, neutral, factual, reassuring.';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: user_query.trim().substring(0, 1000) }
    ];

    try {
      console.log(`[LEGAL-CHAT] Query for entity ${entity_id}: ${user_query.substring(0, 60)}`); 
      const ai_response = await callOpenRouterAI(messages);
      const timestamp   = new Date().toISOString();

      // Persist immutably — INSERT only, never UPDATE or DELETE
      db.insertLegalSession(entity_id, user_query, ai_response || '', 'LEGAL_CHAT');
      db.insertAuditLog('LEGAL_CHAT_USED', entity_id, '', { query_preview: user_query.substring(0, 80) });

      return { ai_response: ai_response || 'No response received.', timestamp };
    } catch (e) {
      console.error('[LEGAL-CHAT] Error:', e.message);
      return { error: e.message };
    }
  });

  /* Channel: legal-chat:history
   * Returns all past legal-chat rows for an entity, oldest-first.
   * Read-only — the renderer may only display, never mutate. */
  ipcMain.handle('legal-chat:history', (event, { entity_id = '' } = {}) => {
    try {
      return db.getLegalChatHistory(entity_id);
    } catch (e) {
      console.error('[LEGAL-CHAT-HISTORY] Error:', e.message);
      return [];
    }
  });

  /* Evidence PDF export — Full Proof Mode
   * 1. Fetches image as base64 for IMAGE entities (5 s timeout, graceful fallback)
   * 2. Pulls full article text from ENTITY_CACHE for TEXT entities
   * 3. Builds print-ready HTML, renders in hidden window, saves PDF
   */
  ipcMain.handle('evidence:export-pdf', async (event, payload = {}) => {
    const focusedWin = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(focusedWin, {
        title: 'Export Evidence Report as PDF',
        defaultPath: `entity-x-evidence-${(payload.entity_id || 'report').replace(/[^a-z0-9_-]/gi, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      });

      if (canceled || !filePath) return { canceled: true };

      const isImage = (payload.entity_type || '').toUpperCase() === 'IMAGE';
      const isText  = (payload.entity_type || '').toUpperCase() === 'TEXT';

      /* ── Pull full article text from in-memory entity cache ── */
      let articleText = null;
      if (isText && payload.entity_id) {
        const cached = ENTITY_CACHE.get(payload.entity_id);
        if (cached && cached.text) articleText = String(cached.text);
      }

      /* ── Fetch detected image and encode as base64 data URI ──
       * Uses a 5-second timeout; silently omits the thumbnail on any failure
       * so the PDF is always generated even if the image has been removed.
       */
      let imageDataUri = null;
      const imgUrl = payload.image_url || (isImage ? payload.source_url : null);
      if (isImage && imgUrl && imgUrl.startsWith('http')) {
        try {
          console.log(`[EXPORT-PDF] Fetching image thumbnail: ${imgUrl.substring(0, 80)}`);
          const imgRes = await fetch(imgUrl, {
            signal: AbortSignal.timeout(5000),
            headers: { 'User-Agent': 'Mozilla/5.0 (EntityX Evidence Export)' }
          });
          if (imgRes.ok) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
            const mimeOk = /^image\/(jpeg|jpg|png|webp|gif|bmp|svg\+xml)$/i.test(contentType);
            if (mimeOk) {
              const buf = Buffer.from(await imgRes.arrayBuffer());
              imageDataUri = `data:${contentType};base64,${buf.toString('base64')}`;
              console.log(`[EXPORT-PDF] Image embedded (${Math.round(buf.length / 1024)} KB, ${contentType})`);
            } else {
              console.warn(`[EXPORT-PDF] Skipping image — unexpected content-type: ${contentType}`);
            }
          } else {
            console.warn(`[EXPORT-PDF] Image fetch failed: HTTP ${imgRes.status}`);
          }
        } catch (imgErr) {
          console.warn(`[EXPORT-PDF] Image fetch error (non-fatal): ${imgErr.message}`);
        }
      }

      /* Enrich payload with server-side data before passing to HTML builder */
      const enrichedPayload = Object.assign({}, payload, {
        imageDataUri,
        articleText
      });

      const html = buildEvidenceHtml(enrichedPayload);

      /* Hidden window to render the HTML then print to PDF */
      const pdfWin = new BrowserWindow({
        show: false,
        width: 900,
        height: 1280,
        webPreferences: { contextIsolation: true, sandbox: true }
      });

      await pdfWin.loadURL(
        'data:text/html;charset=utf-8,' + encodeURIComponent(html)
      );

      const pdfBuffer = await pdfWin.webContents.printToPDF({
        pageSize: 'A4',
        margins: { marginType: 'default' },
        printBackground: true
      });

      pdfWin.close();
      fs.writeFileSync(filePath, pdfBuffer);
      db.insertAuditLog('PDF_EXPORTED', payload.entity_id || '', '', { path: filePath, entity_type: payload.entity_type });

      console.log(`[EXPORT-PDF] Saved: ${filePath}`);
      return { success: true, path: filePath };
    } catch (err) {
      console.error('[EXPORT-PDF] Error:', err.message);
      return { error: err.message };
    }
  });

  /* Global history from backend in-memory store */
  ipcMain.handle('history:get', async (event, filters = {}) => {
    try {
      const params = new URLSearchParams();
      if (filters.type)       params.set('type',       filters.type);
      if (filters.risk_level) params.set('risk_level', filters.risk_level);
      if (filters.limit)      params.set('limit',      String(filters.limit));
      const res = await fetch(
        `http://127.0.0.1:8000/api/history?${params}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return { records: [], total: 0 };
      return await res.json();
    } catch (e) {
      console.error('[HISTORY] Fetch error:', e.message);
      // Backend unreachable — serve from local SQLite cache
      const local = db.queryEntities({ type: filters.type, risk_level: filters.risk_level, limit: filters.limit || 500 });
      if (local.total > 0) return local;
      return { records: [], total: 0, error: e.message };
    }
  });

  /* Local SQLite queries — renderer can fetch persisted data directly */
  ipcMain.handle('db:query', (event, { action = 'entities', ...opts } = {}) => {
    try {
      switch (action) {
        case 'entities':
          return db.queryEntities({ type: opts.type, risk_level: opts.risk_level, limit: opts.limit });
        case 'entity':
          return db.getEntity(opts.entity_id);
        case 'audit_log':
          return db.queryAuditLog(opts.limit);
        case 'legal_sessions':
          return db.queryLegalSessions(opts.limit);
        case 'trust_history':
          return db.queryTrustHistory(opts.entity_id);
        default:
          return { error: `Unknown db:query action: ${action}` };
      }
    } catch (e) {
      console.error('[DB:QUERY]', e.message);
      return { error: e.message };
    }
  });

  /* Manual URL analysis: image or article */
  ipcMain.handle('analyze:manual-url', async (event, url) => {
    if (!isValidHttpUrl(url)) return { success: false, error: 'Invalid URL' };
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url);
    try {
      if (isImage) {
        const res = await fetch(IMAGE_MONITOR_API_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, session_id: IMAGE_MONITOR_SESSION_ID, timestamp: Date.now() })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        const analysis = await res.json();
        const entityId = crypto.createHash('sha256').update(`image-${url}`).digest('hex').substring(0, 16);
        const entity = { entity_id: entityId, entity_type: 'IMAGE', image_url: url, detected_at: Date.now(), ...analysis };
        ENTITY_CACHE.set(entityId, entity);
        db.insertEntity({ entity_id: entityId, entity_type: 'IMAGE', source_url: url, risk_level: analysis.risk_level, analysis, detected_at: entity.detected_at });
        db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
        db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'IMAGE', url });
        return { success: true, entity };
      } else {
        const pageRes = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const html = await pageRes.text();
        const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : url;
        const words = text.split(/\s+/).filter(w => w.length > 1);
        const [res, gemini] = await Promise.all([
          fetch(TEXT_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, text: words.slice(0, 500).join(' '), word_count: words.length, timestamp: Date.now(), session_id: IMAGE_MONITOR_SESSION_ID })
          }),
          callGeminiAnalysis(title, url, text)
        ]);
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        const analysis = await res.json();
        const entityId = crypto.createHash('sha256').update(`text-${url}-${title}`).digest('hex').substring(0, 16);
        const entity = {
          entity_id: entityId, entity_type: 'TEXT', content_title: title, url,
          detected_at: Date.now(), ...analysis,
          ...(gemini ? {
            ai_generated_probability: gemini.ai_generated_probability,
            misinformation_risk: gemini.misinformation_risk,
            credibility_score: gemini.credibility_score,
            explanation: gemini.forensic_explanation,
            ai_summary: gemini.ai_summary,
            topic: gemini.topic,
            key_claims: gemini.key_claims
          } : { ai_summary: null, topic: null, key_claims: [] })
        };
        ENTITY_CACHE.set(entityId, entity);
        db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: url, title, risk_level: entity.misinformation_risk, analysis: entity, detected_at: entity.detected_at });
        db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
        db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'TEXT', url });
        return { success: true, entity };
      }
    } catch (e) {
      console.error('[MANUAL-URL]', e.message);
      return { success: false, error: e.message };
    }
  });

  /* Manual text paste analysis */
  ipcMain.handle('analyze:manual-text', async (event, { text, title }) => {
    try {
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const resolvedTitle = title || 'Manual Text Input';
      const [res, gemini] = await Promise.all([
        fetch(TEXT_MONITOR_API_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: resolvedTitle, url: 'manual://input', text, word_count: words.length, timestamp: Date.now(), session_id: IMAGE_MONITOR_SESSION_ID })
        }),
        callGeminiAnalysis(resolvedTitle, 'manual://input', text)
      ]);
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const analysis = await res.json();
      const entityId = crypto.createHash('sha256').update(`text-manual-${Date.now()}-${text.substring(0, 30)}`).digest('hex').substring(0, 16);
      const entity = {
        entity_id: entityId, entity_type: 'TEXT', content_title: resolvedTitle, url: 'manual://input',
        detected_at: Date.now(), ...analysis,
        ...(gemini ? {
          ai_generated_probability: gemini.ai_generated_probability,
          misinformation_risk: gemini.misinformation_risk,
          credibility_score: gemini.credibility_score,
          explanation: gemini.forensic_explanation,
          ai_summary: gemini.ai_summary,
          topic: gemini.topic,
          key_claims: gemini.key_claims
        } : { ai_summary: null, topic: null, key_claims: [] })
      };
      ENTITY_CACHE.set(entityId, entity);
      db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: 'manual://input', title: resolvedTitle, text, risk_level: entity.misinformation_risk, analysis: entity, detected_at: entity.detected_at });
      db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
      db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'TEXT', source: 'manual_text' });
      return { success: true, entity };
    } catch (e) {
      console.error('[MANUAL-TEXT]', e.message);
      return { success: false, error: e.message };
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => stopBackend());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});