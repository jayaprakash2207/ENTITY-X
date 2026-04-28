const { app, BrowserWindow, ipcMain, dialog, session, net, Menu, MenuItem } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Load .env from project root — must happen before any process.env reads
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Lazy-load db to avoid requiring better-sqlite3 (native module) before app.whenReady().
// Loading native modules at top level before Electron initialises can corrupt the
// electron module binding on some Windows / Electron 40 environments.
let _db = null;
const db = new Proxy({}, {
  get(_, prop) {
    if (!_db) _db = require('./db');
    return _db[prop];
  }
});

// Cloud backend URL — set ENTITY_X_CLOUD_URL in .env to point at Render/Railway/etc.
// Falls back to local backend in development.
const CLOUD_BASE = process.env.ENTITY_X_CLOUD_URL || '';
const LOCAL_BASE  = 'http://127.0.0.1:8000';
const API_BASE    = CLOUD_BASE || LOCAL_BASE;

const IMAGE_MONITOR_API_URL =
  process.env.IMAGE_MONITOR_API_URL || `${API_BASE}/api/image-monitor`;

const TEXT_MONITOR_API_URL =
  process.env.TEXT_MONITOR_API_URL || `${API_BASE}/api/text-monitor`;

const NEWS_SCANNER_API_URL =
  process.env.NEWS_SCANNER_API_URL || `${API_BASE}/api/news-scanner`;

const LEGAL_CHAT_API_URL =
  process.env.LEGAL_CHAT_API_URL || `${API_BASE}/api/legal/chat`;

const IMAGE_MONITOR_SESSION_ID = crypto.randomUUID();
// Manual analyses get their own fresh session so live-monitor score depletion
// doesn't drag the per-article trust score to 0.
const newManualSession = () => `manual-${crypto.randomUUID()}`;

// Gemini AI — gemini-2.0-flash (free tier)
// Set env var:  $env:GEMINI_API_KEY="AIza..."
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) console.warn('[CONFIG] GEMINI_API_KEY not set — Gemini analysis will be skipped.');
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// OpenRouter free-tier — Legal Complaint Generator + AI Chat Assistant
// Set env var:  $env:OPENROUTER_API_KEY="sk-or-v1-..."
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.DEEPSEEK_API_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Groq API — completely free, no credit card, ~100 tokens/sec
// Sign up: https://console.groq.com  →  API Keys  →  Create key (free forever)
// Set env var:  $env:GROQ_API_KEY="gsk_..."
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
if (!GROQ_API_KEY) console.warn('[CONFIG] GROQ_API_KEY not set — Groq AI will be skipped.');
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

// HuggingFace Inference API — free with HF account (hf.co → Settings → Tokens)
// Set env var:  $env:HF_API_KEY="hf_..."
// Falls back to no-auth (rate-limited but works for popular models)
const HF_API_KEY = process.env.HF_API_KEY || '';

// Ordered fallback list — fastest/most-reliable free models first.
// Updated February 2026 to use models confirmed available on OpenRouter free tier.
// Models marked noSystem: true don't accept the 'system' role;
// we merge system content into the first user message for them.
const FREE_MODELS = [
  { id: 'deepseek/deepseek-r1:free',                          noSystem: false },
  { id: 'deepseek/deepseek-chat:free',                        noSystem: false },
  { id: 'google/gemma-3-27b-it:free',                         noSystem: true  },
  { id: 'google/gemma-3-12b-it:free',                         noSystem: true  },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free',      noSystem: false },
  { id: 'meta-llama/llama-4-scout:free',                      noSystem: false },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',             noSystem: false },
  { id: 'meta-llama/llama-3.1-8b-instruct:free',              noSystem: false },
  { id: 'qwen/qwen3-14b:free',                                noSystem: false },
];

// Entity cache: maps entity_id to full entity data
const ENTITY_CACHE = new Map();

/* ============= STATIC PATHS ============= */
const WEBVIEW_PRELOAD_PATH = path.join(__dirname, 'renderer', 'webview-preload.js');
const RENDERER_PRELOAD_PATH = path.join(__dirname, 'preload.js');
const INDEX_HTML_PATH = path.join(__dirname, 'dist', 'index.html');

/* ============= UTILS ============= */

function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/* ============= GEMINI CHAT FALLBACK ============= */

/**
 * Convert OpenAI-style messages array to Gemini contents format,
 * then call Gemini 2.0 Flash for a chat response.
 * Used as automatic fallback when all OpenRouter free models fail.
 *
 * @param {Array<{role:string,content:string}>} messages  OpenAI-format messages
 * @returns {Promise<string>} Assistant reply text
 */
async function callGeminiChat(messages) {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured.');

  // Collect system prompts and merge into first user message
  const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
  const nonSystem   = messages.filter(m => m.role !== 'system');

  const systemPrefix = systemParts.length
    ? systemParts.join('\n\n') + '\n\n---\n\n'
    : '';

  // Convert to Gemini contents array (roles: 'user' | 'model')
  const contents = [];
  for (let i = 0; i < nonSystem.length; i++) {
    const m = nonSystem[i];
    const geminiRole = m.role === 'assistant' ? 'model' : 'user';
    // Prepend system text to the very first user message
    const text = (i === 0 && systemPrefix && geminiRole === 'user')
      ? systemPrefix + m.content
      : m.content;
    contents.push({ role: geminiRole, parts: [{ text }] });
  }

  // Gemini requires the conversation to start with a user turn
  if (!contents.length || contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: systemPrefix || 'Hello' }] });
  }

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini ${res.status}: ${err.substring(0, 120)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  if (!text) throw new Error('Gemini returned an empty response.');
  console.log(`[AI] Gemini fallback chat OK (${text.length} chars)`);
  return text;
}

/* ============= POLLINATIONS.AI (zero-key free fallback) ============= */

/**
 * Call Pollinations.ai — completely free, no API key required.
 * Used as the last-resort fallback when both OpenRouter and Gemini are unavailable.
 *
 * @param {Array<{role:string,content:string}>} messages  OpenAI-format messages
 * @returns {Promise<string>} Assistant reply text
 */
async function callPollinationsAI(messages) {
  console.log('[AI] Trying Pollinations.ai (no-key fallback)…');
  const res = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages,
      temperature: 0.4,
      max_tokens: 2048,
      private: true
    }),
    signal: AbortSignal.timeout(45000)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Pollinations ${res.status}: ${err.substring(0, 120)}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('Pollinations returned an empty response.');
  console.log(`[AI] Pollinations.ai fallback OK (${text.length} chars)`);
  return text;
}

/* ============= GEMINI AI SUMMARIZER ============= */

/**
 * Call Gemini 2.0 Flash to perform full forensic analysis of an article.
 * Returns comprehensive analysis including risk scores, forensic bullets, summary and claims.
 * Fails silently — application works without it (falls back to mock backend).
 */
/**
 * Use a hidden Electron BrowserWindow to load a URL (with full JS execution),
 * then extract page title + body text.  Works for JS-rendered sites like MSN.
 * Resolves to { title, text } or rejects on timeout / load failure.
 */
function fetchPageWithBrowser(url) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1280, height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,          // isolate page JS from main process
        javascript: true,
        images: false,          // skip images — faster load
      },
    });

    const TIMEOUT_MS = 25000;
    let settled = false;

    const finish = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const [rawText, rawTitle, rawMedia] = await Promise.all([
          win.webContents.executeJavaScript(
            `(function(){` +
            `  var clone = document.body.cloneNode(true);` +
            `  ['script','style','nav','header','footer','aside','noscript'].forEach(function(t){` +
            `    clone.querySelectorAll(t).forEach(function(el){el.remove();});` +
            `  });` +
            `  return (clone.innerText||clone.textContent||'').replace(/\\s+/g,' ').trim().substring(0,12000);` +
            `})()`
          ),
          win.webContents.executeJavaScript('document.title || ""'),
          win.webContents.executeJavaScript(
            `(function(){` +
            `  var toAbs=function(src){try{return new URL(src||'',location.href).href}catch(e){return null}};` +
            `  var imgs=Array.from(document.querySelectorAll('img'))` +
            `    .map(function(i){return toAbs(i.src||i.dataset.src||i.dataset.lazySrc||'')})` +
            `    .filter(function(s){return s&&s.startsWith('http')&&!/icon|logo|avatar|sprite|pixel|tracking|1x1|badge/i.test(s)})` +
            `    .filter(function(s,i,a){return a.indexOf(s)===i}).slice(0,6);` +
            `  var vids=[].concat(` +
            `    Array.from(document.querySelectorAll('video[src],source[src]')).map(function(v){return toAbs(v.src)}),` +
            `    Array.from(document.querySelectorAll('iframe[src]')).map(function(f){return f.src})` +
            `      .filter(function(s){return s&&/(youtube\\.com|youtu\\.be|vimeo\\.com)/i.test(s)})` +
            `  ).filter(Boolean).filter(function(s,i,a){return a.indexOf(s)===i}).slice(0,3);` +
            `  var auds=Array.from(document.querySelectorAll('audio[src],audio source[src]'))` +
            `    .map(function(a){return toAbs(a.src)}).filter(Boolean).slice(0,3);` +
            `  return {images:imgs,videos:vids,audio:auds};` +
            `})()`
          ),
        ]);
        win.destroy();
        resolve({ text: rawText || '', title: rawTitle || '', images: (rawMedia||{}).images||[], videos: (rawMedia||{}).videos||[], audio: (rawMedia||{}).audio||[] });
      } catch (e) {
        win.destroy();
        reject(e);
      }
    };

    // Wait up to 3 s after load for JS frameworks to render
    win.webContents.on('did-finish-load', () => setTimeout(finish, 3000));

    win.webContents.on('did-fail-load', (ev, code, desc) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      win.destroy();
      reject(new Error(`Page load failed (${code}): ${desc}`));
    });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        finish(); // try extracting whatever loaded so far
      }
    }, TIMEOUT_MS);

    win.loadURL(url);
  });
}

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

    const risk = ['LOW', 'MEDIUM', 'HIGH'].includes(parsed.misinformation_risk)
      ? parsed.misinformation_risk : 'LOW';
    const aiProb = Math.max(0, Math.min(1, parseFloat(parsed.ai_generated_probability) || 0));
    const credScore = Math.max(0, Math.min(1, parseFloat(parsed.credibility_score) || 0.5));

    console.log(`[GEMINI] Analysis OK — Risk:${risk} AI:${(aiProb * 100).toFixed(0)}% Cred:${(credScore * 100).toFixed(0)}% Topic:${parsed.topic}`);
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
        const msg = data?.error?.message || res.statusText;
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

  // All OpenRouter models failed — try Gemini (skip if 429 cooldown active for this context)
  if (GEMINI_API_KEY && Date.now() > _geminiCooldown.openrouter) {
    console.warn('[AI] All OpenRouter models exhausted. Falling back to Gemini…');
    try {
      return await callGeminiChat(messages);
    } catch (geminiErr) {
      if (geminiErr.message && geminiErr.message.includes('429')) {
        _geminiCooldown.openrouter = Date.now() + 60_000;
        console.warn('[AI] Gemini 429 (openrouter context) — cooling down for 60s');
      } else {
        console.warn('[AI] Gemini fallback failed:', geminiErr.message, '— trying Pollinations…');
      }
    }
  } else if (GEMINI_API_KEY) {
    console.log('[AI] Gemini skipped (429 cooldown active) — trying Pollinations…');
  }

  // Gemini also failed — try Pollinations.ai (no API key, always free)
  try {
    return await callPollinationsAI(messages);
  } catch (pollErr) {
    console.error('[AI] Pollinations fallback also failed:', pollErr.message);
    throw lastError || pollErr;
  }
}

// Keep old name as alias for backward compatibility
const callDeepSeekAI = callOpenRouterAI;

/* ============= GROQ AI (free, fastest) ============= */
/**
 * Call Groq's free API — LLaMA 3.3 70B at ~100 tok/s, no credit card needed.
 * Sign up: https://console.groq.com → API Keys → Create key
 *
 * Free limits: 14,400 req/day, 500,000 tokens/day (more than enough).
 */
async function callGroqAI(messages) {
  if (!GROQ_API_KEY) throw new Error('No Groq API key. Set GROQ_API_KEY env var (free at console.groq.com).');

  // Try best model first, fall back to faster smaller model
  const GROQ_MODELS = [
    'llama-3.3-70b-versatile',   // best quality, 70B
    'llama-3.1-8b-instant',      // faster, smaller
    'mixtral-8x7b-32768',        // good for structured output
  ];

  let lastErr = null;
  for (const model of GROQ_MODELS) {
    try {
      console.log(`[GROQ] Trying model: ${model}`);
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(30000),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = data?.error?.message || res.statusText;
        console.warn(`[GROQ] ${model} failed (${res.status}): ${msg.substring(0, 80)}`);
        lastErr = new Error(msg);
        continue;
      }

      const text = data.choices?.[0]?.message?.content?.trim() || '';
      if (!text) { lastErr = new Error(`${model}: empty response`); continue; }

      console.log(`[GROQ] Success: ${model} (${text.length} chars)`);
      return text;
    } catch (err) {
      console.warn(`[GROQ] ${model} threw: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All Groq models failed.');
}

/* ============= HUGGINGFACE INFERENCE API (free) ============= */
/**
 * Call HuggingFace Serverless Inference API — free with HF account.
 * Sign up: https://huggingface.co → Settings → Access Tokens → New token (free)
 *
 * Uses the /v1/chat/completions endpoint (OpenAI-compatible, added 2024).
 * Falls back to unauthenticated if no key (works for popular models, rate-limited).
 */
async function callHuggingFaceAI(messages) {
  // Instruction models good at legal/structured Q&A
  const HF_MODELS = [
    'mistralai/Mistral-7B-Instruct-v0.3',
    'HuggingFaceH4/zephyr-7b-beta',
    'microsoft/Phi-3-mini-4k-instruct',
  ];

  let lastErr = null;
  for (const model of HF_MODELS) {
    try {
      // router.huggingface.co replaced api-inference.huggingface.co (old endpoint returns 410)
      const url = `https://router.huggingface.co/models/${model}/v1/chat/completions`;
      console.log(`[HF] Trying model: ${model}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(HF_API_KEY ? { 'Authorization': `Bearer ${HF_API_KEY}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        }),
        signal: AbortSignal.timeout(45000),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const msg = (typeof data.error === 'string' ? data.error : data?.error?.message) || res.statusText;
        // 503 = model loading (cold start), skip to next
        console.warn(`[HF] ${model} failed (${res.status}): ${String(msg).substring(0, 80)}`);
        lastErr = new Error(String(msg));
        continue;
      }

      const text = data.choices?.[0]?.message?.content?.trim() || '';
      if (!text) { lastErr = new Error(`${model}: empty response`); continue; }

      console.log(`[HF] Success: ${model} (${text.length} chars)`);
      return text;
    } catch (err) {
      console.warn(`[HF] ${model} threw: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr || new Error('All HuggingFace models failed.');
}

// Gemini 429 cooldowns — separate per context so one rate-limit doesn't block all features.
// Each value is a timestamp (ms) until which Gemini should be skipped for that context.
const _geminiCooldown = {
  openrouter: 0,  // used by callOpenRouterAI fallback chain
  legal: 0,       // used by callLegalAI
};

/* ============= LEGAL AI — dedicated chain for legal features ============= */
/**
 * Priority chain optimised for legal Q&A quality and speed:
 *   1. Groq          — fastest (100+ tok/s), LLaMA 3.3 70B, free forever
 *   2. Gemini Flash   — already in app, 1500 req/day free, strong reasoning
 *   3. HuggingFace   — free serverless inference (router.huggingface.co)
 *   4. OpenRouter    — free model chain (9 models), slower but reliable
 *   5. Pollinations  — no key at all, always available as last resort
 */
async function callLegalAI(messages) {
  // 1. Groq (fastest, best quality)
  if (GROQ_API_KEY) {
    try { return await callGroqAI(messages); }
    catch (e) { console.warn('[LEGAL-AI] Groq failed:', e.message); }
  }

  // 2. Gemini Flash — skip if in 429 cooldown (legal context only)
  if (GEMINI_API_KEY && Date.now() > _geminiCooldown.legal) {
    try { return await callGeminiChat(messages); }
    catch (e) {
      if (e.message && e.message.includes('429')) {
        _geminiCooldown.legal = Date.now() + 60_000; // skip for 60 seconds, legal context only
        console.warn('[LEGAL-AI] Gemini 429 — cooling down for 60s (legal context)');
      } else {
        console.warn('[LEGAL-AI] Gemini failed:', e.message);
      }
    }
  } else if (GEMINI_API_KEY) {
    console.log('[LEGAL-AI] Gemini skipped (429 cooldown active)');
  }

  // 3. HuggingFace free inference
  try { return await callHuggingFaceAI(messages); }
  catch (e) { console.warn('[LEGAL-AI] HuggingFace failed:', e.message); }

  // 4. OpenRouter free chain (only if key is set)
  if (OPENROUTER_API_KEY) {
    try { return await callOpenRouterAI(messages); }
    catch (e) { console.warn('[LEGAL-AI] OpenRouter failed:', e.message); }
  }

  // 5. Pollinations.ai — zero API key required, always available
  return callPollinationsAI(messages);
}

/* ============= BACKEND BRIDGE ============= */

/* ── CDP Image Byte Cache ─────────────────────────────────────────────────
 * Attaches Chrome DevTools Protocol to the webview WebContents.
 * Listens for image network responses and stores raw bytes so
 * doPostImageToBackend can upload them directly — no second HTTP round-trip,
 * no CDN auth/signed-URL expiry issues.
 * ─────────────────────────────────────────────────────────────────────── */
const imageByteCache  = new Map();  // url → Buffer (CDP-captured bytes)
const _cdpRequestMap  = new Map();  // CDP requestId → url (in-flight)
const IMAGE_BYTE_CACHE_MAX       = 40;          // max number of cached images
const IMAGE_BYTE_CACHE_MAX_BYTES = 150_000_000; // 150 MB total size cap
let   _imageByteCacheTotalBytes  = 0;

function _evictImageCache() {
  while (
    imageByteCache.size > 0 &&
    (imageByteCache.size > IMAGE_BYTE_CACHE_MAX || _imageByteCacheTotalBytes > IMAGE_BYTE_CACHE_MAX_BYTES)
  ) {
    const [oldestUrl, oldestBuf] = imageByteCache.entries().next().value;
    imageByteCache.delete(oldestUrl);
    _imageByteCacheTotalBytes -= oldestBuf.length;
  }
}

function attachCDPToWebview(webviewWC) {
  try {
    webviewWC.debugger.attach('1.3');
  } catch (e) {
    if (!e.message.includes('already attached')) {
      console.warn('[CDP] Could not attach debugger:', e.message);
      return;
    }
  }
  try {
    webviewWC.debugger.sendCommand('Network.enable', {});
  } catch (e) {
    console.warn('[CDP] Network.enable failed:', e.message);
    return;
  }

  webviewWC.debugger.on('message', (_evt, method, params) => {
    // Use a non-async handler to avoid unhandled promise rejections in event emitters.
    // Async work is wrapped in an immediately-invoked async IIFE with explicit catch.
    if (method === 'Network.responseReceived') {
      const mime = (params.response?.mimeType || '').toLowerCase();
      if (mime.startsWith('image/') && !mime.includes('svg')) {
        _cdpRequestMap.set(params.requestId, params.response.url);
      }
    } else if (method === 'Network.loadingFinished') {
      const url = _cdpRequestMap.get(params.requestId);
      if (!url) return;
      _cdpRequestMap.delete(params.requestId);
      (async () => {
        try {
          const body = await webviewWC.debugger.sendCommand(
            'Network.getResponseBody', { requestId: params.requestId }
          );
          if (body?.body && body.base64Encoded) {
            const buf = Buffer.from(body.body, 'base64');
            if (buf.length > 500) {
              // Remove old entry's size if URL already cached
              if (imageByteCache.has(url)) {
                _imageByteCacheTotalBytes -= imageByteCache.get(url).length;
              }
              imageByteCache.set(url, buf);
              _imageByteCacheTotalBytes += buf.length;
              _evictImageCache();
              console.log(`[CDP] Cached ${buf.length}B for ${url.substring(0, 70)} (total: ${(_imageByteCacheTotalBytes / 1_048_576).toFixed(1)}MB)`);
            }
          }
        } catch (_) { /* body may be evicted by CDP — that's fine */ }
      })();
    }
  });

  // Clear in-flight map on navigation (request IDs don't survive page load)
  webviewWC.on('did-navigate',         () => _cdpRequestMap.clear());
  webviewWC.on('did-navigate-in-page', () => _cdpRequestMap.clear());

  console.log('[CDP] Attached to webview — image byte caching active');
}

// Rate limiting for ML analysis - prevent overwhelming the backend
const IMAGE_QUEUE = [];
const MAX_CONCURRENT = 2;  // Max images being analyzed at once
let activeRequests = 0;
let _imageQueueRunning = false;  // Guard against concurrent processImageQueue invocations
const PROCESSED_URLS = new Set();  // Dedupe within session
const MIN_IMAGE_SIZE = 100;  // Skip images smaller than 100px in URL

function detectMediaTypeFn(url) {
  if (/\.(mp4|webm|mov|avi|mkv)(\?|#|$)/i.test(url)) return 'VIDEO';
  if (/\.(mp3|wav|ogg|flac|aac|m4a)(\?|#|$)/i.test(url)) return 'AUDIO';
  return 'IMAGE';
}

function shouldSkipImage(url) {
  // Skip already processed URLs
  if (PROCESSED_URLS.has(url)) return true;
  
  // Skip profile pictures and tiny images
  if (url.includes('/profile-') || url.includes('&w=32') || url.includes('w=32&')) return true;
  if (url.includes('&h=32') || url.includes('h=32&')) return true;
  
  // Skip tracking pixels and very small dimensions in URL
  const sizeMatch = url.match(/[?&]w=(\d+)/i);
  if (sizeMatch && parseInt(sizeMatch[1], 10) < MIN_IMAGE_SIZE) return true;
  
  return false;
}

async function processImageQueue() {
  // Guard: only one loop runs at a time to avoid exceeding MAX_CONCURRENT
  if (_imageQueueRunning) return;
  _imageQueueRunning = true;
  try {
    while (IMAGE_QUEUE.length > 0 && activeRequests < MAX_CONCURRENT) {
      const { imageUrl, senderWebContents } = IMAGE_QUEUE.shift();
      activeRequests++;
      doPostImageToBackend(imageUrl, senderWebContents).finally(() => {
        activeRequests--;
        PROCESSED_URLS.add(imageUrl);
        // Kick off the next item without recursion
        if (IMAGE_QUEUE.length > 0 && activeRequests < MAX_CONCURRENT) {
          setImmediate(processImageQueue);
        }
      });
    }
  } finally {
    _imageQueueRunning = false;
  }
}

async function postImageUrlToBackend(imageUrl, senderWebContents) {
  if (!isValidHttpUrl(imageUrl)) {
    console.error(`[BACKEND] Invalid URL: ${imageUrl}`);
    return;
  }

  // Skip unwanted images (profile pics, tiny images, already processed)
  if (shouldSkipImage(imageUrl)) {
    console.log(`[BACKEND] Skipping: ${imageUrl.substring(0, 60)}...`);
    return;
  }

  // Queue the request
  IMAGE_QUEUE.push({ imageUrl, senderWebContents });
  console.log(`[BACKEND] Queued (${IMAGE_QUEUE.length} pending, ${activeRequests} active): ${imageUrl.substring(0, 50)}...`);
  
  // Process queue if capacity available
  processImageQueue();
}

async function doPostImageToBackend(imageUrl, senderWebContents) {
  try {
    console.log(`[BACKEND] Processing: ${imageUrl.substring(0, 60)}...`);

    let res = null;

    // ── Priority 1: CDP byte cache (most reliable — bytes captured at load time)
    if (imageByteCache.has(imageUrl)) {
      try {
        const cachedBytes = imageByteCache.get(imageUrl);
        const blob = new Blob([cachedBytes], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('image', blob, 'image.jpg');
        formData.append('image_url', imageUrl);
        formData.append('session_id', IMAGE_MONITOR_SESSION_ID);
        res = await net.fetch(`${IMAGE_MONITOR_API_URL}/bytes`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(120000)
        });
        console.log(`[BACKEND] CDP cache hit: ${res.status} for ${imageUrl.substring(0, 50)}`);
      } catch (cacheErr) {
        console.log(`[BACKEND] CDP cache upload failed: ${cacheErr.message}`);
        res = null;
      }
    }

    // ── Priority 2: re-fetch via the webview session (has cookies/headers)
    // and upload them directly — avoids backend's blocked server-side re-fetch
    if (!res || !res.ok) try {
      const webviewSession = session.fromPartition('persist:browser');
      const pageOrigin = (() => { try { return new URL(_currentPageUrl).origin; } catch { return _currentPageUrl; } })();
      const imgResponse = await webviewSession.fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': _currentPageUrl,
          'Origin': pageOrigin,
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'cross-site',
        }
      });
      if (imgResponse.ok) {
        const imageBytes = await imgResponse.arrayBuffer();
        const mimeType = imgResponse.headers.get('content-type') || 'image/jpeg';
        const blob = new Blob([imageBytes], { type: mimeType });
        const formData = new FormData();
        formData.append('image', blob, 'image.jpg');
        formData.append('image_url', imageUrl);
        formData.append('session_id', IMAGE_MONITOR_SESSION_ID);
        res = await net.fetch(`${IMAGE_MONITOR_API_URL}/bytes`, {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(120000)
        });
        console.log(`[BACKEND] Bytes upload result: ${res.status} for ${imageUrl.substring(0, 50)}`);
      } else {
        console.log(`[BACKEND] Session fetch returned ${imgResponse.status} for ${imageUrl.substring(0, 50)}, trying canvas fallback...`);
      }
    } catch (fetchErr) {
      console.log(`[BACKEND] Bytes fetch failed (${fetchErr.message}), trying canvas fallback...`);
    }

    // Canvas fallback: scroll the image into view in the webview, then capture
    // via capturePage(). This bypasses CDN auth/signed-URL restrictions because
    // the webview has already rendered the image — we're just screenshotting it.
    if (!res || !res.ok) {
      try {
        const allWC = require('electron').webContents.getAllWebContents();
        const webviewWC = (_lastWebviewWC && !_lastWebviewWC.isDestroyed())
          ? _lastWebviewWC
          : allWC.find(wc =>
              !wc.isDestroyed() &&
              wc !== (_mainWindow && _mainWindow.webContents) &&
              !wc.getURL().startsWith('devtools://')
            );
        if (webviewWC) {
          const urlBase = imageUrl.split('?')[0];
          // Step 1: find the img element, scroll it into view, tag it
          const scrolled = await webviewWC.executeJavaScript(`
            (function() {
              const imgs = Array.from(document.querySelectorAll('img'));
              const img = imgs.find(i =>
                i.src === ${JSON.stringify(imageUrl)} ||
                i.currentSrc === ${JSON.stringify(imageUrl)} ||
                (i.src || '').split('?')[0] === ${JSON.stringify(urlBase)} ||
                (i.currentSrc || '').split('?')[0] === ${JSON.stringify(urlBase)}
              );
              if (!img || !img.complete || !img.naturalWidth) return false;
              img.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
              img.setAttribute('data-entityx-capture', '1');
              return true;
            })()`);

          if (scrolled) {
            // Step 2: wait for scroll to settle before capturing
            await new Promise(r => setTimeout(r, 200));

            // Step 3: get the now-visible rect (clamped to viewport)
            const rect = await webviewWC.executeJavaScript(`
              (function() {
                const img = document.querySelector('[data-entityx-capture="1"]');
                if (!img) return null;
                img.removeAttribute('data-entityx-capture');
                if (!img.complete || !img.naturalWidth) return null;
                const r = img.getBoundingClientRect();
                const vw = window.innerWidth, vh = window.innerHeight;
                const x = Math.max(0, Math.round(r.left));
                const y = Math.max(0, Math.round(r.top));
                const w = Math.min(Math.round(r.width), vw - x);
                const h = Math.min(Math.round(r.height), vh - y);
                if (w < 8 || h < 8) return null;
                return { x, y, width: w, height: h };
              })()`);

            if (rect && rect.width > 0 && rect.height > 0) {
              const nativeImg = await webviewWC.capturePage(rect);
              const imgBuffer = nativeImg.toJPEG(85);
              if (imgBuffer && imgBuffer.length > 500) {
                const blob = new Blob([imgBuffer], { type: 'image/jpeg' });
                const formData = new FormData();
                formData.append('image', blob, 'capture.jpg');
                formData.append('image_url', imageUrl);
                formData.append('session_id', IMAGE_MONITOR_SESSION_ID);
                res = await net.fetch(`${IMAGE_MONITOR_API_URL}/bytes`, {
                  method: 'POST',
                  body: formData,
                  signal: AbortSignal.timeout(120000)
                });
                console.log(`[BACKEND] Canvas fallback result: ${res.status} for ${imageUrl.substring(0, 50)}`);
              }
            } else {
              console.log(`[BACKEND] Canvas fallback: image rect not in viewport for ${imageUrl.substring(0, 50)}`);
            }
          } else {
            console.log(`[BACKEND] Canvas fallback: img element not found for ${imageUrl.substring(0, 50)}`);
          }
        }
      } catch (canvasErr) {
        console.log(`[BACKEND] Canvas fallback failed: ${canvasErr.message}`);
      }
    }

    // Last resort: send URL and let backend try to fetch it
    if (!res || !res.ok) {
      res = await net.fetch(IMAGE_MONITOR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
        signal: AbortSignal.timeout(120000)
      });
    }

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
    const detectedMediaType = detectMediaTypeFn(imageUrl);
    ENTITY_CACHE.set(entityId, {
      entity_id: entityId,
      entity_type: detectedMediaType,
      type: detectedMediaType,
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
    db.insertEntity({ entity_id: entityId, entity_type: detectedMediaType, source_url: imageUrl, risk_level: analysis.risk_level, analysis: { fake_probability: analysis.fake_probability, trust_score: analysis.trust_score, forensic_explanation: analysis.forensic_explanation ?? [] } });
    db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: detectedMediaType, risk_level: analysis.risk_level, fake_probability: analysis.fake_probability });
    evaluateAlertRules({ image_url: imageUrl, risk_level: analysis.risk_level, fake_probability: analysis.fake_probability }, detectedMediaType);

    console.log(`[IPC] Sending image-monitor:analysis to renderer (entity: ${entityId})`);
    senderWebContents.send('image-monitor:analysis', {
      entity_id: entityId,
      entity_type: detectedMediaType,
      type: detectedMediaType,
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

    // Run backend analysis and Gemini forensic analysis in parallel for speed.
    // allSettled ensures a Gemini failure never blocks the backend result.
    const [backendResult, geminiResult] = await Promise.allSettled([
      net.fetch(TEXT_MONITOR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...textPayload, session_id: IMAGE_MONITOR_SESSION_ID }),
        signal: AbortSignal.timeout(30000)
      }),
      callGeminiAnalysis(textPayload.title, textPayload.url, textPayload.text)
    ]);

    if (backendResult.status === 'rejected') {
      console.error(`[BACKEND-TEXT] Backend request failed: ${backendResult.reason}`);
      return;
    }
    const res = backendResult.value;
    if (!res.ok) {
      console.error(`[BACKEND-TEXT] HTTP error: ${res.status} ${res.statusText}`);
      return;
    }
    if (geminiResult.status === 'rejected') {
      console.warn(`[BACKEND-TEXT] Gemini analysis failed (non-fatal): ${geminiResult.reason?.message}`);
    }
    const gemini = geminiResult.status === 'fulfilled' ? geminiResult.value : null;

    const analysis = await res.json();
    if (
      typeof analysis !== 'object' || analysis === null ||
      typeof analysis.misinformation_risk !== 'string' ||
      typeof analysis.ai_generated_probability !== 'number'
    ) {
      console.error('[BACKEND-TEXT] Unexpected response shape:', JSON.stringify(analysis).substring(0, 200));
      return;
    }
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
    // Persist to local SQLite - use risk_level based on AI probability (from backend)
    const textRiskLevel = entity.risk_level || analysis.risk_level || entity.misinformation_risk || 'LOW';
    db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: entity.url, title: entity.content_title, text: entity.text ?? '', risk_level: textRiskLevel, analysis: { ai_generated_probability: entity.ai_generated_probability, credibility_score: entity.credibility_score, trust_score: entity.trust_score } });
    db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: 'TEXT', risk_level: textRiskLevel });
    evaluateAlertRules({ url: textPayload.url, risk_level: textRiskLevel, ai_generated_probability: entity.ai_generated_probability }, 'TEXT');

    console.log(`[IPC] Sending text-monitor:analysis to renderer (gemini=${gemini ? 'ok' : 'skip'})`);
    senderWebContents.send('text-monitor:analysis', {
      entity_id: entityId,
      entity_type: 'TEXT',
      content_title: textPayload.title,
      url: textPayload.url,
      word_count: textPayload.word_count,
      // Scores: Gemini overrides mock backend when available
      ai_generated_probability: entity.ai_generated_probability,
      risk_level: textRiskLevel,  // AI probability-based risk level
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

/* ============= VIDEO/AUDIO MONITOR ENDPOINTS ============= */
const VIDEO_MONITOR_API_URL = 'http://127.0.0.1:8000/api/video-monitor';
const AUDIO_MONITOR_API_URL = 'http://127.0.0.1:8000/api/audio-monitor';

const VIDEO_QUEUE = [];
const AUDIO_QUEUE = [];
const PROCESSED_VIDEO_URLS = new Set();
const PROCESSED_AUDIO_URLS = new Set();
const MAX_VIDEO_CONCURRENT = 1;  // Video is heavy, limit to 1 at a time
const MAX_AUDIO_CONCURRENT = 2;
let activeVideoRequests = 0;
let activeAudioRequests = 0;
let _videoQueueRunning = false;
let _audioQueueRunning = false;

async function processVideoQueue() {
  if (_videoQueueRunning) return;
  _videoQueueRunning = true;
  try {
    while (VIDEO_QUEUE.length > 0 && activeVideoRequests < MAX_VIDEO_CONCURRENT) {
      const { videoUrl, senderWebContents } = VIDEO_QUEUE.shift();
      activeVideoRequests++;
      doPostVideoToBackend(videoUrl, senderWebContents).finally(() => {
        activeVideoRequests--;
        PROCESSED_VIDEO_URLS.add(videoUrl);
        if (VIDEO_QUEUE.length > 0) setImmediate(processVideoQueue);
      });
    }
  } finally {
    _videoQueueRunning = false;
  }
}

async function postVideoUrlToBackend(videoUrl, senderWebContents) {
  if (!isValidHttpUrl(videoUrl)) {
    console.error(`[BACKEND-VIDEO] Invalid URL: ${videoUrl}`);
    return;
  }
  if (PROCESSED_VIDEO_URLS.has(videoUrl)) {
    console.log(`[BACKEND-VIDEO] Already processed: ${videoUrl.substring(0, 50)}...`);
    return;
  }

  VIDEO_QUEUE.push({ videoUrl, senderWebContents });
  console.log(`[BACKEND-VIDEO] Queued (${VIDEO_QUEUE.length} pending): ${videoUrl.substring(0, 50)}...`);
  processVideoQueue();
}

async function doPostVideoToBackend(videoUrl, senderWebContents) {
  try {
    console.log(`[BACKEND-VIDEO] Processing: ${videoUrl.substring(0, 60)}...`);

    const res = await net.fetch(VIDEO_MONITOR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
      signal: AbortSignal.timeout(180000)  // 3 minutes for video analysis
    });

    if (!res.ok) {
      console.error(`[BACKEND-VIDEO] HTTP error: ${res.status} ${res.statusText}`);
      return;
    }

    const analysis = await res.json();
    console.log(`[BACKEND-VIDEO] Result: ${analysis.risk_level} | Fake: ${analysis.fake_probability} | Frames: ${analysis.frames_analysed}`);

    if (senderWebContents.isDestroyed()) {
      console.error('[BACKEND-VIDEO] Sender window destroyed');
      return;
    }

    const entityId = crypto.createHash('sha256')
      .update(`video-${videoUrl}`)
      .digest('hex')
      .substring(0, 16);

    ENTITY_CACHE.set(entityId, {
      entity_id: entityId,
      entity_type: 'VIDEO',
      video_url: videoUrl,
      source_url: videoUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      frames_analysed: analysis.frames_analysed,
      frame_scores: analysis.frame_scores,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      detected_at: Date.now()
    });

    db.insertEntity({ entity_id: entityId, entity_type: 'VIDEO', source_url: videoUrl, risk_level: analysis.risk_level, analysis: { fake_probability: analysis.fake_probability, frames_analysed: analysis.frames_analysed, forensic_explanation: analysis.forensic_explanation ?? [], trust_score: analysis.trust_score, trust_score_delta: analysis.trust_score_delta } });
    db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: 'VIDEO', risk_level: analysis.risk_level });
    evaluateAlertRules({ url: videoUrl, risk_level: analysis.risk_level, fake_probability: analysis.fake_probability }, 'VIDEO');

    console.log(`[IPC] Sending video-monitor:analysis (entity: ${entityId})`);
    senderWebContents.send('video-monitor:analysis', {
      entity_id: entityId,
      entity_type: 'VIDEO',
      video_url: videoUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      frames_analysed: analysis.frames_analysed,
      frame_scores: analysis.frame_scores,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      analyzed_at: Date.now()
    });
  } catch (err) {
    console.error(`[BACKEND-VIDEO] Fetch error: ${err.message}`);
    db.insertAuditLog('ANALYSIS_FAILED', '', IMAGE_MONITOR_SESSION_ID, { type: 'VIDEO', url: videoUrl, error: err.message.substring(0, 120) });
  }
}

async function processAudioQueue() {
  if (_audioQueueRunning) return;
  _audioQueueRunning = true;
  try {
    while (AUDIO_QUEUE.length > 0 && activeAudioRequests < MAX_AUDIO_CONCURRENT) {
      const { audioUrl, senderWebContents } = AUDIO_QUEUE.shift();
      activeAudioRequests++;
      doPostAudioToBackend(audioUrl, senderWebContents).finally(() => {
        activeAudioRequests--;
        PROCESSED_AUDIO_URLS.add(audioUrl);
        if (AUDIO_QUEUE.length > 0) setImmediate(processAudioQueue);
      });
    }
  } finally {
    _audioQueueRunning = false;
  }
}

async function postAudioUrlToBackend(audioUrl, senderWebContents) {
  if (!isValidHttpUrl(audioUrl)) {
    console.error(`[BACKEND-AUDIO] Invalid URL: ${audioUrl}`);
    return;
  }
  if (PROCESSED_AUDIO_URLS.has(audioUrl)) {
    console.log(`[BACKEND-AUDIO] Already processed: ${audioUrl.substring(0, 50)}...`);
    return;
  }

  AUDIO_QUEUE.push({ audioUrl, senderWebContents });
  console.log(`[BACKEND-AUDIO] Queued (${AUDIO_QUEUE.length} pending): ${audioUrl.substring(0, 50)}...`);
  processAudioQueue();
}

async function doPostAudioToBackend(audioUrl, senderWebContents) {
  try {
    console.log(`[BACKEND-AUDIO] Processing: ${audioUrl.substring(0, 60)}...`);

    const res = await net.fetch(AUDIO_MONITOR_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
      signal: AbortSignal.timeout(60000)
    });

    if (!res.ok) {
      console.error(`[BACKEND-AUDIO] HTTP error: ${res.status} ${res.statusText}`);
      return;
    }

    const analysis = await res.json();
    console.log(`[BACKEND-AUDIO] Result: ${analysis.risk_level} | Fake: ${analysis.fake_probability} | Duration: ${analysis.duration_seconds}s`);

    if (senderWebContents.isDestroyed()) {
      console.error('[BACKEND-AUDIO] Sender window destroyed');
      return;
    }

    const entityId = crypto.createHash('sha256')
      .update(`audio-${audioUrl}`)
      .digest('hex')
      .substring(0, 16);

    ENTITY_CACHE.set(entityId, {
      entity_id: entityId,
      entity_type: 'AUDIO',
      audio_url: audioUrl,
      source_url: audioUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      duration_seconds: analysis.duration_seconds,
      analysis_type: analysis.analysis_type,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      detected_at: Date.now()
    });

    db.insertEntity({ entity_id: entityId, entity_type: 'AUDIO', source_url: audioUrl, risk_level: analysis.risk_level, analysis: { fake_probability: analysis.fake_probability, duration_seconds: analysis.duration_seconds, forensic_explanation: analysis.forensic_explanation ?? [], trust_score: analysis.trust_score, trust_score_delta: analysis.trust_score_delta } });
    db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
    db.insertAuditLog('ENTITY_DETECTED', entityId, IMAGE_MONITOR_SESSION_ID, { type: 'AUDIO', risk_level: analysis.risk_level });
    evaluateAlertRules({ url: audioUrl, risk_level: analysis.risk_level, fake_probability: analysis.fake_probability }, 'AUDIO');

    console.log(`[IPC] Sending audio-monitor:analysis (entity: ${entityId})`);
    senderWebContents.send('audio-monitor:analysis', {
      entity_id: entityId,
      entity_type: 'AUDIO',
      audio_url: audioUrl,
      fake_probability: analysis.fake_probability,
      risk_level: analysis.risk_level,
      duration_seconds: analysis.duration_seconds,
      analysis_type: analysis.analysis_type,
      forensic_explanation: analysis.forensic_explanation ?? [],
      trust_score: analysis.trust_score,
      trust_score_delta: analysis.trust_score_delta,
      analyzed_at: Date.now()
    });
  } catch (err) {
    console.error(`[BACKEND-AUDIO] Fetch error: ${err.message}`);
    db.insertAuditLog('ANALYSIS_FAILED', '', IMAGE_MONITOR_SESSION_ID, { type: 'AUDIO', url: audioUrl, error: err.message.substring(0, 120) });
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

  const risk = (p.risk_level || p.misinformation_risk || 'LOW').toUpperCase();
  const riskCls = risk === 'HIGH' ? 'risk-high' : risk === 'MEDIUM' ? 'risk-med' : 'risk-low';
  const isText  = (p.entity_type || '').toUpperCase() === 'TEXT';
  const isVideo = (p.entity_type || '').toUpperCase() === 'VIDEO';
  const isAudio = (p.entity_type || '').toUpperCase() === 'AUDIO';
  const isLegal = !!(p.complaint_draft);
  const entityType = (p.entity_type || (isLegal ? 'LEGAL' : 'UNKNOWN')).toUpperCase();
  const source = esc(p.source_url || 'N/A');
  const _titleDefault = isText ? 'Text Entity' : isVideo ? 'Video Entity' : isAudio ? 'Audio Entity' : isLegal ? 'Legal Report' : 'Image Entity';
  const title = esc(p.content_title || _titleDefault);
  const aiProb = pct(p.ai_generated_probability || p.fake_probability);
  const fakeProb = pct(p.fake_probability || p.ai_generated_probability);
  const credScore = pct(p.credibility_score);
  const trust = parseFloat(p.trust_score) || 0;
  const trustDelta = parseFloat(p.trust_score_delta) || 0;
  const findings = Array.isArray(p.forensic_explanation) ? p.forensic_explanation
    : Array.isArray(p.explanation) ? p.explanation
    : Array.isArray(p.forensic_findings) ? p.forensic_findings
    : [];
  const keyClaims = Array.isArray(p.key_claims) ? p.key_claims : [];
  const aiSummary = p.ai_summary || null;
  const topic = p.topic || null;
  const wordCount = p.word_count ? Number(p.word_count).toLocaleString() : null;
  const complaintDraft = p.complaint_draft || null;
  const now = new Date().toISOString().replace('T', '\u2002').slice(0, 19) + ' UTC';

  /* ── Section builders ── */
  function field(label, val) {
    return `<tr><td class="fl">${esc(label)}</td><td class="fv">${val}</td></tr>`;
  }
  function scoreRow(label, value, pctVal, color) {
    const w = Math.round(Math.min(100, Math.max(0, pctVal)));
    const bar = `<div class="bar-track"><div class="bar-fill" style="width:${w}%;background:${color};"></div></div>`;
    return `<tr><td class="sl">${esc(label)}</td><td class="sv" style="color:${color};">${esc(value)}</td><td class="sb">${bar}</td></tr>`;
  }

  const findingsHtml = findings.length
    ? findings.map((f, i) =>
      `<div class="finding"><span class="fn">${i + 1}</span><span class="ft2">${esc(String(f))}</span></div>`
    ).join('')
    : '<div class="nodata">No forensic findings recorded.</div>';

  /* ── Legal complaint draft section ── */
  const legalHtml = complaintDraft
    ? `<div class="sec" style="page-break-before:always;">
        <div class="sec-title" style="color:#7c3aed;border-bottom-color:rgba(124,58,237,0.25);">Legal Complaint Draft</div>
        <div style="padding:12px 14px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:4px;
                    font-family:'Segoe UI',Arial,sans-serif;font-size:9pt;line-height:1.85;
                    color:#1e1b4b;white-space:pre-wrap;word-break:break-word;">${esc(complaintDraft)}</div>
      </div>` : '';

  const claimsHtml = keyClaims.length
    ? `<div class="sec"><div class="sec-title">Key Claims Identified</div>${keyClaims.map((c, i) =>
      `<div class="claim"><span class="cn">C${i + 1}</span><span class="ct">${esc(String(c))}</span></div>`
    ).join('')}</div>` : '';

  const summaryHtml = aiSummary
    ? `<div class="sec"><div class="sec-title">AI Forensic Summary${topic ? ` &mdash; ${esc(topic)}` : ''}</div><p class="sumtext">${esc(aiSummary)}</p></div>` : '';

  /* ── Evidence section ── */
  let evidenceHtml = '';
  if (isVideo) {
    /* VIDEO evidence */
    const framesAnalysed = p.frames_analysed || p.frames_analyzed || 0;
    const frameScores    = Array.isArray(p.frame_scores) ? p.frame_scores : [];
    const duration       = p.duration_seconds ? `${parseFloat(p.duration_seconds).toFixed(1)}s` : null;
    const audioTrack     = p.audio_analysis || null;
    // Per-frame score sparkline — up to 20 bars
    const sparkBars = frameScores.slice(0, 20).map(s => {
      const h = Math.max(4, Math.round(s * 32));
      const c = s > 0.7 ? '#dc2626' : s > 0.4 ? '#d97706' : '#059669';
      return `<div style="display:inline-block;width:8px;height:${h}px;background:${c};border-radius:2px;margin-right:1px;vertical-align:bottom;"></div>`;
    }).join('');
    evidenceHtml = `
    <div class="sec">
      <div class="sec-title">Evidence &mdash; Video Content</div>
      <table class="ft">
        ${field('Video URL', `<span style="word-break:break-all;font-size:8pt;">${source}</span>`)}
        ${duration ? field('Duration', `<strong>${duration}</strong>`) : ''}
        ${framesAnalysed ? field('Frames Analysed', `<strong>${framesAnalysed}</strong> frames sampled`) : ''}
        ${field('Detection Time', fmtDate(p.detected_at))}
        ${p.analyzed_at ? field('Analysis Time', fmtDate(p.analyzed_at)) : ''}
      </table>
      ${sparkBars ? `<div style="margin-top:10px;"><div style="font-size:7.5pt;font-weight:700;color:#5a6a80;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">Per-Frame AI Score</div><div style="padding:8px;background:#f5f8fc;border-radius:4px;border:1px solid #d8e6f5;line-height:0;">${sparkBars}</div></div>` : ''}
      ${audioTrack ? `<div style="margin-top:10px;padding:8px 12px;background:#fdf4ff;border:1px solid #e9d5ff;border-radius:4px;"><div style="font-size:7.5pt;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px;">Audio Track Analysis</div><div style="font-size:9pt;color:#374151;">Synthetic probability: <strong style="color:${(audioTrack.fake_probability||0)>0.7?'#dc2626':(audioTrack.fake_probability||0)>0.4?'#d97706':'#059669'}">${((audioTrack.fake_probability||0)*100).toFixed(1)}%</strong>${audioTrack.risk_level ? ` &mdash; <strong>${esc(audioTrack.risk_level)}</strong>` : ''}</div></div>` : ''}
    </div>`;
  } else if (isAudio) {
    /* AUDIO evidence */
    const duration     = p.duration_seconds ? `${parseFloat(p.duration_seconds).toFixed(1)}s` : null;
    const analysisType = p.analysis_type || null;
    // Parse key signals from forensic_explanation lines
    const mlPrimary  = findings.find(f => f.includes('[ML-PRIMARY'));
    const wavlm      = findings.find(f => f.includes('[WavLM]'));
    const spectral   = findings.find(f => f.includes('[SPECTRAL]') || f.toLowerCase().includes('pitch') || f.toLowerCase().includes('spectral'));
    const fusion     = findings.find(f => f.includes('[FUSION]') || f.toLowerCase().includes('fusion'));
    evidenceHtml = `
    <div class="sec">
      <div class="sec-title">Evidence &mdash; Audio Content</div>
      <table class="ft">
        ${field('Audio URL', `<span style="word-break:break-all;font-size:8pt;">${source}</span>`)}
        ${duration ? field('Duration', `<strong>${duration}</strong>`) : ''}
        ${analysisType ? field('Analysis Method', `<strong>${esc(analysisType)}</strong>`) : ''}
        ${field('Detection Time', fmtDate(p.detected_at))}
        ${p.analyzed_at ? field('Analysis Time', fmtDate(p.analyzed_at)) : ''}
      </table>
      ${(mlPrimary || wavlm || spectral || fusion) ? `
      <div style="margin-top:10px;">
        <div style="font-size:7.5pt;font-weight:700;color:#5a6a80;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">ML Signal Breakdown</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${mlPrimary  ? `<div style="padding:5px 9px;background:#f5f8fc;border-left:3px solid #1a5fba;border-radius:0 3px 3px 0;font-size:8.5pt;color:#2a3a50;">${esc(mlPrimary)}</div>`  : ''}
          ${wavlm      ? `<div style="padding:5px 9px;background:#f5f8fc;border-left:3px solid #7c3aed;border-radius:0 3px 3px 0;font-size:8.5pt;color:#2a3a50;">${esc(wavlm)}</div>`      : ''}
          ${spectral   ? `<div style="padding:5px 9px;background:#f5f8fc;border-left:3px solid #059669;border-radius:0 3px 3px 0;font-size:8.5pt;color:#2a3a50;">${esc(spectral)}</div>`   : ''}
          ${fusion     ? `<div style="padding:5px 9px;background:#fffbeb;border-left:3px solid #d97706;border-radius:0 3px 3px 0;font-size:8.5pt;color:#2a3a50;">${esc(fusion)}</div>`     : ''}
        </div>
      </div>` : ''}
    </div>`;
  } else if (isText) {
    /* TEXT / NEWS evidence */
    const body = p.articleText ? String(p.articleText) : null;
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
  } else {
    /* IMAGE evidence (default) */
    // Validate data URI before embedding — only allow image/* data URIs to prevent XSS
    const rawDataUri = p.imageDataUri || null;
    const imgSrc = (rawDataUri && /^data:image\/(jpeg|jpg|png|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(rawDataUri))
      ? rawDataUri
      : null;
    const imgBlock = imgSrc
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
                background: ${isText ? 'rgba(192,132,252,.15)' : isVideo ? 'rgba(255,107,53,.12)' : isAudio ? 'rgba(0,180,120,.12)' : 'rgba(59,130,246,.1)'};
                color: ${isText ? '#7c3aed' : isVideo ? '#c2410c' : isAudio ? '#047857' : '#1d4ed8'};
                border: 1px solid ${isText ? 'rgba(192,132,252,.35)' : isVideo ? 'rgba(255,107,53,.35)' : isAudio ? 'rgba(0,180,120,.35)' : 'rgba(59,130,246,.3)'}; }

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
    ${title !== _titleDefault ? field('Title', title) : ''}
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
${(findings.length > 0 || !complaintDraft) ? `<div class="sec">
  <div class="sec-title">Forensic Findings (${findings.length})</div>
  ${findingsHtml}
</div>` : ''}

<!-- Legal Complaint Draft -->
${legalHtml}

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
let _lastWebviewWC = null;  // tracked via did-attach-webview

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
  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_ELECTRON) {
    mainWindow.webContents.openDevTools();
  }

  if (process.env.DEBUG_ELECTRON) {
    console.log(`[MAIN] Webview preload path: file://${WEBVIEW_PRELOAD_PATH}`);
  }

  // Track the webview WebContents and attach CDP byte caching
  mainWindow.webContents.on('did-attach-webview', (_event, webviewWC) => {
    _lastWebviewWC = webviewWC;
    webviewWC.on('destroyed', () => { if (_lastWebviewWC === webviewWC) _lastWebviewWC = null; });
    attachCDPToWebview(webviewWC);
  });

  _mainWindow = mainWindow;
  return mainWindow;
}

/* ============= PYTHON BACKEND AUTO-SPAWN ============= */

let _backendProcess = null;

function startBackend() {
  const projectRoot = __dirname;
  let spawnArgs, spawnOpts;

  // 1. Production: use the bundled PyInstaller exe packed inside the installer
  const bundledExe = path.join(process.resourcesPath || '', 'entity_x_backend', 'entity_x_backend.exe');
  // 2. Development: use the local venv Python
  const venvPython = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');

  if (fs.existsSync(bundledExe)) {
    console.log(`[BACKEND] Using bundled exe: ${bundledExe}`);
    spawnArgs = [bundledExe, []];
    spawnOpts = { stdio: 'pipe', windowsHide: true };
  } else {
    const python = fs.existsSync(venvPython) ? venvPython : 'python';
    console.log(`[BACKEND] Dev mode — using Python: ${python}`);
    spawnArgs = [python, ['-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000']];
    spawnOpts = { cwd: projectRoot, stdio: 'pipe', windowsHide: true };
  }

  console.log('[BACKEND] Spawning Python backend...');
  _backendProcess = spawn(spawnArgs[0], spawnArgs[1], spawnOpts);

  _backendProcess.stdout.on('data', d => process.stdout.write('[PY] ' + d));
  _backendProcess.stderr.on('data', d => process.stderr.write('[PY] ' + d));
  _backendProcess.on('close', code => {
    console.log(`[BACKEND] Process exited (code ${code})`);
    _backendProcess = null;
  });
  _backendProcess.on('error', err => {
    console.error('[BACKEND] Spawn error:', err.message);
    // Notify all open windows so the user knows why analysis won't work
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('backend:spawn-error', { message: err.message });
      }
    }
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
// Skip if using cloud backend (ENTITY_X_CLOUD_URL is set)
if (!CLOUD_BASE) startBackend();

// Poll until the backend is reachable, then notify the renderer
let _backendIsReady = false;

async function waitForBackend(maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await net.fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok || r.status === 404) {
        console.log('[BACKEND] Ready after', Date.now() - start, 'ms');
        _backendIsReady = true;
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('backend:ready');
        }
        return;
      }
    } catch (_) {}
    await new Promise(res => setTimeout(res, 800));
  }
  console.warn('[BACKEND] Timed out waiting for backend — renderer will poll via backendBus');
}
// Start polling — resolves asynchronously when backend is up
waitForBackend();

// If a window loads AFTER the backend is already ready, send it the signal once its DOM is ready
app.on('browser-window-created', (_, win) => {
  win.webContents.on('dom-ready', () => {
    if (_backendIsReady && !win.isDestroyed()) {
      win.webContents.send('backend:ready');
    }
    // Notify renderer if DB failed to initialise — user must know persistence is broken
    if (!win.isDestroyed() && db.initDb && db.initDb._lastError) {
      win.webContents.send('db:init-error', { message: db.initDb._lastError });
    }
  });
});

/* ============= SESSION-LEVEL WEBVIEW INTERCEPTOR ============= */
/*
 * Intercepts ALL completed requests made by the webview's persist:browser
 * partition at the session level — no webview preload IPC chain required.
 * Triggered by Electron's net module before responses reach the renderer.
 */

/** URLs sent to backend this session (deduped per navigation) */
const _seenImageUrls = new Set();

/** Current page URL in the webview — used as Referer when fetching image bytes */
let _currentPageUrl = 'https://www.google.com/';

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

  /* ── Audio interceptor — catches streams/players that bypass DOM ── */
  const AUDIO_MIME_RE = /^audio\//i;
  const AUDIO_EXT_RE  = /\.(mp3|wav|ogg|flac|aac|m4a|opus|weba)(\?|$)/i;

  webviewSession.webRequest.onCompleted(
    { urls: ['http://*/*', 'https://*/*'] },
    (details) => {
      if (!_mainWindow || _mainWindow.isDestroyed()) return;
      if (details.statusCode < 200 || details.statusCode >= 300) return;

      const ct   = (details.responseHeaders['content-type'] || details.responseHeaders['Content-Type'] || [])[0] || '';
      const mime = ct.split(';')[0].trim();

      const isAudio = AUDIO_MIME_RE.test(mime)
        || AUDIO_EXT_RE.test(details.url.split('?')[0]);

      if (!isAudio) return;
      if (PROCESSED_AUDIO_URLS.has(details.url)) return;

      console.log(`[INTERCEPT-AUDIO] Detected via network: ${details.url.substring(0, 80)}`);
      postAudioUrlToBackend(details.url, _mainWindow.webContents);
    }
  );

  console.log('[INTERCEPT] Webview session interceptors installed on persist:browser (image + audio)');
}

/* ============= IPC HANDLERS ============= */

// ── Alert Rules Engine (module-level so all async handlers can reach it) ──────
function _matchCondition(detection, entityType, cond) {
  if (!cond || !cond.field) return false;
  const { field, operator, value } = cond;
  let actual;
  switch (field) {
    case 'risk_level':       actual = (detection.risk_level || 'LOW').toUpperCase(); break;
    case 'fake_probability': actual = parseFloat(detection.fake_probability ?? detection.ai_generated_probability ?? 0); break;
    case 'entity_type':      actual = entityType; break;
    case 'source_domain':
      try { actual = new URL(detection.image_url || detection.url || '').hostname.replace(/^www\./, ''); } catch { actual = ''; }
      break;
    default: return false;
  }
  const v = value;
  switch (operator) {
    case 'eq':       return String(actual).toUpperCase() === String(v).toUpperCase();
    case 'neq':      return String(actual).toUpperCase() !== String(v).toUpperCase();
    case 'gt':       return parseFloat(actual) > parseFloat(v);
    case 'gte':      return parseFloat(actual) >= parseFloat(v);
    case 'lt':       return parseFloat(actual) < parseFloat(v);
    case 'lte':      return parseFloat(actual) <= parseFloat(v);
    case 'contains': return String(actual).toLowerCase().includes(String(v).toLowerCase());
    default: return false;
  }
}

function evaluateAlertRules(detection, entityType) {
  try {
    const rules = db.getAlertRules().filter(r => r.enabled);
    const fired = [];
    for (const rule of rules) {
      if (_matchCondition(detection, entityType, rule.condition)) {
        fired.push(rule);
        db.incrementRuleTriggerCount(rule.rule_id);
      }
    }
    if (fired.length > 0 && _mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('alert-rules:triggered', fired.map(r => ({
        rule_id: r.rule_id, name: r.name,
        action: r.action || {},
        detection: {
          type: entityType,
          risk: detection.risk_level || 'LOW',
          prob: +(detection.fake_probability ?? detection.ai_generated_probability ?? 0).toFixed(3),
          url: detection.image_url || detection.url || '',
        },
      })));
    }
  } catch (e) { console.error('[RULES]', e.message); }
}

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
          entity_id: row.entity_id,
          entity_type: row.entity_type,
          source_url: row.source_url,
          image_url: isImage ? row.source_url : undefined,
          title: row.title,
          content_title: row.title,
          url: row.source_url,
          text: row.extracted_text,
          risk_level: row.risk_level,
          detected_at: row.detected_at,
          _from_db: true,
          ...row.analysis
        });
        restored++;
      }
    });
    if (restored > 0) console.log(`[DB] Restored ${restored} entities into memory cache`);
  } catch (restoreErr) {
    console.error('[DB] Cache restore error:', restoreErr.message);
  }

  // ── Security: block dangerous permission requests ──────────────────────────
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['clipboard-read', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  // ── Security: reject bad TLS certificates ──────────────────────────────────
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    callback(request.errorCode === 0 ? 0 : -2);
  });

  // ── Security: block navigation to non-http(s) schemes from webviews ────────
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-navigate', (event, url) => {
      try {
        const { protocol } = new URL(url);
        if (!['https:', 'http:', 'file:'].includes(protocol)) event.preventDefault();
      } catch { event.preventDefault(); }
    });

    wc.setWindowOpenHandler(({ url }) => {
      // Open external links in the system browser, not a new Electron window
      try {
        const { protocol } = new URL(url);
        if (['https:', 'http:'].includes(protocol)) {
          require('electron').shell.openExternal(url);
        }
      } catch {}
      return { action: 'deny' };
    });
  });

  // ── Auto-updater: check GitHub Releases on startup ─────────────────────────
  if (process.env.NODE_ENV !== 'development') {
    autoUpdater.checkForUpdatesAndNotify();
    autoUpdater.on('update-available', () => {
      dialog.showMessageBox({ type: 'info', title: 'Update Available', message: 'A new version of Entity X is downloading in the background.' });
    });
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info', title: 'Update Ready',
        message: 'Update downloaded. Entity X will restart to apply it.',
        buttons: ['Restart Now', 'Later'],
      }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
    });
  }

  createMainWindow();
  installWebviewInterceptors();

  /* Navigation event from renderer — clear dedup cache so a revisited page
   * can have its media re-analyzed on a fresh load */
  ipcMain.on('webview:navigated', (event, url) => {
    _seenImageUrls.clear();
    PROCESSED_VIDEO_URLS.clear();
    PROCESSED_AUDIO_URLS.clear();
    if (url) _currentPageUrl = url;
    console.log(`[INTERCEPT] Nav — media caches cleared. New URL: ${url ? url.substring(0, 60) : '?'}`);
  });

  /* Let renderer query the correct webview preload path at runtime */
  ipcMain.handle('get:webview-preload-path', () => `file://${WEBVIEW_PRELOAD_PATH}`);

  /* ── Context-scan: right-click / double-click from webview ── */
  ipcMain.on('webview:context-scan-request', (event, payload) => {
    if (!payload || !payload.type) return;

    /* Double-click sends immediate=true — skip the menu and open popup directly */
    if (payload.immediate) {
      if (_mainWindow) _mainWindow.webContents.send('scan:popup:open', payload);
      return;
    }

    const typeLabel = {
      image: '⚡  Scan Image with Entity X',
      video: '⚡  Scan Video with Entity X',
      audio: '⚡  Scan Audio with Entity X',
      text:  '⚡  Scan Selected Text with Entity X',
    }[payload.type] || '⚡  Scan with Entity X';

    const menu = new Menu();
    menu.append(new MenuItem({
      label: typeLabel,
      click: () => {
        if (_mainWindow) _mainWindow.webContents.send('scan:popup:open', payload);
      },
    }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Cancel' }));

    const fromWin = BrowserWindow.fromWebContents(event.sender) || _mainWindow;
    if (fromWin) menu.popup({ window: fromWin });
  });

  /* Handler for webview image detection */
  ipcMain.on('webview:image-url', (event, url) => {
    console.log(`[WEBVIEW] Image detected: ${url.substring(0, 60)}...`);
    if (!_seenImageUrls.has(url)) {
      _seenImageUrls.add(url);
      postImageUrlToBackend(url, _mainWindow ? _mainWindow.webContents : event.sender);
    }
  });

  /* Fallback: renderer can still forward webview payloads via these channels */
  ipcMain.on('image-monitor:url', (event, url) => {
    if (!_seenImageUrls.has(url)) {
      _seenImageUrls.add(url);
      postImageUrlToBackend(url, _mainWindow ? _mainWindow.webContents : event.sender);
    }
  });
  /* Text content sent by webview preload (primary channel) */
  ipcMain.on('webview:text-content', (event, payload) => {
    console.log(`[WEBVIEW] Text detected: "${(payload?.title || '').substring(0, 50)}" (${payload?.word_count || 0} words)`);
    postTextToBackend(payload, _mainWindow ? _mainWindow.webContents : event.sender);
  });
  /* Legacy / renderer-forwarded fallback */
  ipcMain.on('text-monitor:article', (event, payload) => {
    postTextToBackend(payload, _mainWindow ? _mainWindow.webContents : event.sender);
  });

  /* Handler for webview video detection */
  ipcMain.on('webview:video-url', (event, url) => {
    console.log(`[WEBVIEW] Video detected: ${url.substring(0, 60)}...`);
    postVideoUrlToBackend(url, _mainWindow ? _mainWindow.webContents : event.sender);
  });

  /* Handler for webview audio detection */
  ipcMain.on('webview:audio-url', (event, url) => {
    console.log(`[WEBVIEW] Audio detected: ${url.substring(0, 60)}...`);
    postAudioUrlToBackend(url, _mainWindow ? _mainWindow.webContents : event.sender);
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
          entity_id: row.entity_id,
          entity_type: row.entity_type,
          source_url: row.source_url,
          image_url: isImage ? row.source_url : undefined,
          title: row.title,
          content_title: row.title,
          url: row.source_url,
          text: row.extracted_text,
          risk_level: row.risk_level,
          detected_at: row.detected_at,
          _from_db: true,
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
      if (payload.entity_type) lines.push(`Entity Type: ${payload.entity_type}`);
      if (payload.source_url) lines.push(`Source URL: ${payload.source_url}`);
      if (payload.content_title) lines.push(`Title / Description: ${payload.content_title}`);
      if (payload.misinformation_risk) lines.push(`Risk Verdict: ${payload.misinformation_risk}`);
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

      console.log('[LEGAL] Calling Legal AI to generate complaint draft...');
      const draft = await callLegalAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]);

      const evidence_summary = {
        entity_type: payload.entity_type,
        source_url: payload.source_url,
        content_title: payload.content_title,
        risk_level: payload.misinformation_risk,
        ai_generated_probability: payload.ai_generated_probability,
        fake_probability: payload.fake_probability,
        credibility_score: payload.credibility_score,
        forensic_findings: payload.forensic_findings || [],
        key_claims: payload.key_claims || [],
        generated_at: new Date().toISOString(),
        model: FREE_MODELS[0].id + ' (OpenRouter free)'
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

      const response = await callLegalAI([
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

  /* ── Browser AI Agent (Comet-style) ──────────────────────────────────────
   * Takes the current page context + chat history and returns a reply + actions
   * to perform on the webview (navigate, click, type, scroll, etc.)
   * ───────────────────────────────────────────────────────────────────────── */
  ipcMain.handle('browser:ai-agent', async (_event, { messages = [], pageContext = {} } = {}) => {
    try {
      const { url = '', title = '', text = '', elements = {} } = pageContext;

      const systemPrompt =
        'You are an intelligent browser agent built into Entity X — a digital integrity tool.\n' +
        'You help users navigate the web, research content, and take actions in their browser.\n\n' +
        'CURRENT PAGE:\n' +
        `URL: ${url}\n` +
        `Title: ${title}\n` +
        `Page text (truncated): ${text.substring(0, 2500)}\n` +
        `Links on page: ${JSON.stringify((elements.links || []).slice(0, 20))}\n` +
        `Buttons: ${JSON.stringify((elements.buttons || []).slice(0, 15))}\n` +
        `Inputs: ${JSON.stringify((elements.inputs || []).slice(0, 8))}\n\n` +
        'RULES:\n' +
        '- Always respond ONLY with valid JSON — no prose outside the JSON block\n' +
        '- Keep "reply" short, friendly, and conversational\n' +
        '- Only include actions that are actually needed\n' +
        '- For searches, build the full URL directly rather than clicking a search box\n\n' +
        'RESPONSE FORMAT (strict JSON):\n' +
        '{\n' +
        '  "reply": "what you are doing or your answer",\n' +
        '  "actions": [\n' +
        '    // list of action objects — may be empty if just answering\n' +
        '  ]\n' +
        '}\n\n' +
        'AVAILABLE ACTIONS:\n' +
        '{"type":"navigate","url":"https://..."}\n' +
        '{"type":"search","query":"search terms","engine":"google"}\n' +
        '{"type":"click","text":"visible text of element to click"}\n' +
        '{"type":"click","selector":"CSS selector"}\n' +
        '{"type":"type","selector":"CSS selector","value":"text","submit":true}\n' +
        '{"type":"scroll","direction":"down","amount":600}\n' +
        '{"type":"scroll","direction":"up","amount":600}\n' +
        '{"type":"scroll","direction":"top"}\n' +
        '{"type":"scroll","direction":"bottom"}\n' +
        '{"type":"back"}\n' +
        '{"type":"reload"}\n' +
        '{"type":"wait","ms":1500}\n\n' +
        'EXAMPLES:\n' +
        'User: "go to bbc news"\n' +
        '{"reply":"Navigating to BBC News...","actions":[{"type":"navigate","url":"https://www.bbc.com/news"}]}\n\n' +
        'User: "search youtube for deepfake news"\n' +
        '{"reply":"Searching YouTube for deepfake news...","actions":[{"type":"navigate","url":"https://www.youtube.com/results?search_query=deepfake+news"}]}\n\n' +
        'User: "what is this page about"\n' +
        '{"reply":"This page is about...","actions":[]}\n\n' +
        'User: "scroll down"\n' +
        '{"reply":"Scrolling down...","actions":[{"type":"scroll","direction":"down","amount":600}]}\n\n' +
        'User: "click the first article"\n' +
        '{"reply":"Clicking the first article link...","actions":[{"type":"click","text":"' + (elements.links?.[0]?.text || 'first link') + '"}]}\n';

      const geminiMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      const raw = await callLegalAI(geminiMessages);

      // Extract JSON from response (sometimes Gemini wraps in markdown)
      let parsed;
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      } catch {
        parsed = { reply: raw, actions: [] };
      }

      return { success: true, reply: parsed.reply || '', actions: parsed.actions || [] };
    } catch (e) {
      console.error('[BROWSER-AGENT]', e.message);
      return { success: false, reply: `Error: ${e.message}`, actions: [] };
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
  ipcMain.handle('legal-chat:query', async (event, { entity_id = '', user_query = '', history = [] } = {}) => {
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
      '1. NEVER tell the user to file an FIR, lodge a complaint, or take legal action. Use phrases like\n' +
      '   "may be explored", "commonly considered", "awareness-only".\n' +
      '2. NEVER accuse any person or platform of wrongdoing.\n' +
      '3. NEVER make definitive claims about legality or guilt.\n' +
      '4. Keep responses concise — use bullet points for lists of 3 or more items.\n' +
      '5. If the question is outside your scope, say so clearly and suggest the user consult\n' +
      '   a qualified legal professional.\n' +
      '6. Do NOT start your reply with any disclaimer — a disclaimer is already shown in the UI.\n\n' +
      'TONE: Professional, neutral, factual, reassuring. Be conversational and helpful.';

    // Build messages: system + last 10 turns of history + new user query
    const historyMsgs = Array.isArray(history)
      ? history.slice(-10).map(m => ({ role: m.role, content: String(m.content).substring(0, 800) }))
      : [];
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMsgs,
      { role: 'user', content: user_query.trim().substring(0, 1000) }
    ];

    try {
      console.log(`[LEGAL-CHAT] Query for entity ${entity_id}: ${user_query.substring(0, 60)}`);

      // Run LLM chat + Python structured guidance in parallel
      const [ai_response, guidanceResult] = await Promise.allSettled([
        callLegalAI(messages),
        fetch(LEGAL_CHAT_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entity_type: 'TEXT',
            context: user_query.substring(0, 500),
            country: 'India',
            analysis_data: {},
          }),
          signal: AbortSignal.timeout(20000),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const responseText = ai_response.status === 'fulfilled'
        ? ai_response.value
        : 'Legal AI unavailable. Please try again.';

      const guidance = guidanceResult.status === 'fulfilled'
        ? guidanceResult.value
        : null;

      const timestamp = new Date().toISOString();
      db.insertLegalSession(entity_id, user_query, responseText, 'LEGAL_CHAT');
      db.insertAuditLog('LEGAL_CHAT_USED', entity_id, '', { query_preview: user_query.substring(0, 80) });

      return { ai_response: responseText, guidance, timestamp };
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

      const _eType  = (payload.entity_type || '').toUpperCase();
      const isImage = _eType === 'IMAGE';
      const isText  = _eType === 'TEXT';
      const isVideo = _eType === 'VIDEO';
      const isAudio = _eType === 'AUDIO';

      /* ── Pull full article text from in-memory entity cache ── */
      let articleText = null;
      if (isText && payload.entity_id) {
        const cached = ENTITY_CACHE.get(payload.entity_id);
        if (cached && cached.text) articleText = String(cached.text);
      }

      /* ── Pull video/audio fields from entity cache if not already in payload ── */
      let videoAudioExtra = {};
      if ((isVideo || isAudio) && payload.entity_id) {
        const cached = ENTITY_CACHE.get(payload.entity_id);
        if (cached) {
          videoAudioExtra = {
            duration_seconds:     cached.duration_seconds,
            frames_analysed:      cached.frames_analysed  || cached.frames_analyzed,
            frame_scores:         cached.frame_scores,
            analysis_type:        cached.analysis_type,
            audio_analysis:       cached.audio_analysis,
            forensic_explanation: cached.forensic_explanation || payload.forensic_explanation,
          };
        }
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
      const enrichedPayload = Object.assign({}, payload, videoAudioExtra, {
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

  /* Global history — SQLite is the primary source (persists across backend restarts).
   * Falls back to backend in-memory store only when SQLite is empty (fresh install). */
  ipcMain.handle('history:get', async (event, filters = {}) => {
    // Normalize 'all' sentinel values → null so SQLite query fetches everything
    const type       = (filters.type       && filters.type       !== 'all') ? filters.type       : null;
    const risk_level = (filters.risk_level && filters.risk_level !== 'all') ? filters.risk_level : null;
    const limit      = filters.limit || 500;
    // Always query SQLite first — all entities are stored here regardless of backend state
    try {
      const local = db.queryEntities({ type, risk_level, limit });
      if (local.total > 0) {
        console.log(`[HISTORY] Serving ${local.total} records from SQLite`);
        return local;
      }
    } catch (dbErr) {
      console.error('[HISTORY] SQLite query error:', dbErr.message);
    }
    // SQLite empty — try backend as secondary source (first run or just-cleared DB)
    try {
      const params = new URLSearchParams();
      if (type)       params.set('type',       type);
      if (risk_level) params.set('risk_level', risk_level);
      params.set('limit', String(limit));
      const res = await net.fetch(
        `http://127.0.0.1:8000/api/history?${params}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return { records: [], total: 0 };
      return await res.json();
    } catch (e) {
      console.error('[HISTORY] Backend fetch error:', e.message);
      return { records: [], total: 0 };
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

  // evaluateAlertRules and _matchCondition are defined at module level (see below app.whenReady)

  /* Manual URL analysis: image or article */
  ipcMain.handle('analyze:manual-url', async (event, url) => {
    if (!isValidHttpUrl(url)) return { success: false, error: 'Invalid URL' };
    // Tier 1: extension in URL path
    let isImage = /\.(jpg|jpeg|png|gif|webp|bmp|avif|tiff?|svg)([\?&#:]|$)/i.test(url);

    // Tier 2: known image CDN domains (no extension in URL)
    if (!isImage) {
      const IMG_CDNS = [
        'images.unsplash.com', 'plus.unsplash.com',
        'i.imgur.com', 'pbs.twimg.com', 'i.redd.it',
        'media.giphy.com', 'cdn.discordapp.com',
        'images.pexels.com', 'img.freepik.com',
        'live.staticflickr.com', 'farm*.staticflickr.com',
        'media.istockphoto.com', 'images.gettyimages.com',
        'upload.wikimedia.org', 'commons.wikimedia.org',
      ];
      const low = url.toLowerCase();
      isImage = IMG_CDNS.some(cdn => low.includes(cdn.replace('*', '')));
    }

    // Tier 3: HEAD request — check Content-Type for any remaining uncertain URLs
    if (!isImage) {
      try {
        const headRes = await net.fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        const ct = (headRes.headers.get('content-type') || '').toLowerCase();
        isImage = ct.startsWith('image/');
      } catch { /* non-fatal — fall through to text path */ }
    }

    try {
      if (isImage) {
        const res = await net.fetch(IMAGE_MONITOR_API_URL, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url, session_id: IMAGE_MONITOR_SESSION_ID })
        });
        if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
        const analysis = await res.json();
        const entityId = crypto.createHash('sha256').update(`image-${url}`).digest('hex').substring(0, 16);
        const entity = { entity_id: entityId, entity_type: 'IMAGE', image_url: url, detected_at: Date.now(), ...analysis };
        ENTITY_CACHE.set(entityId, entity);
        db.insertEntity({ entity_id: entityId, entity_type: 'IMAGE', source_url: url, risk_level: analysis.risk_level, analysis, detected_at: entity.detected_at });
        db.insertTrustHistory(entityId, analysis.trust_score ?? 0, analysis.trust_score_delta ?? 0);
        db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'IMAGE', url });
        // Push to Detection Feed in renderer
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('image-monitor:analysis', entity);
        }
        return { success: true, entity };
      } else {
        // Use a hidden Electron BrowserWindow to load the page with full JS execution.
        // This handles JS-rendered sites (MSN, etc.) that block plain HTTP scrapers.
        let pageText = '';
        let pageTitle = url;
        let pageImages = [], pageVideos = [], pageAudio = [];
        try {
          const fetched = await fetchPageWithBrowser(url);
          pageText   = fetched.text   || '';
          pageTitle  = fetched.title  || url;
          pageImages = fetched.images || [];
          pageVideos = fetched.videos || [];
          pageAudio  = fetched.audio  || [];
        } catch (fetchErr) {
          console.warn('[MANUAL-URL] Browser fetch failed, falling back to news-scanner:', fetchErr.message);
        }

        // If browser extraction yielded enough text, use text-monitor directly.
        // Otherwise fall back to the Python news-scanner (httpx with browser headers).
        let analysis;
        let title;
        if (pageText.trim().length >= 50) {
          const words = pageText.split(/\s+/).filter(w => w.length > 1);
          title = pageTitle;
          const tmRes = await net.fetch(TEXT_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, text: words.slice(0, 500).join(' '), word_count: words.length, timestamp: Date.now(), session_id: newManualSession() }),
            signal: AbortSignal.timeout(30000),
          });
          if (!tmRes.ok) return { success: false, error: `HTTP ${tmRes.status}` };
          analysis = await tmRes.json();
          title = pageTitle;
        } else {
          // Fallback: Python news-scanner (handles static / server-rendered pages)
          const nsRes = await net.fetch(NEWS_SCANNER_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ article_url: url, session_id: newManualSession() })
          });
          if (!nsRes.ok) return { success: false, error: `HTTP ${nsRes.status}` };
          const nsData = await nsRes.json();
          if (nsData.word_count === 0) {
            return { success: false, error: 'Could not extract article text. The page may require a login or is behind a paywall.' };
          }
          analysis = {
            ai_generated_probability: nsData.ai_generated_probability,
            risk_level:               nsData.risk_level,
            misinformation_risk:      nsData.misinformation_risk,
            credibility_score:        nsData.credibility_score,
            explanation:              nsData.explanation,
            trust_score:              nsData.trust_score,
            trust_score_delta:        nsData.trust_score_delta,
          };
          title = nsData.title || pageTitle || url;
        }

        // Run Gemini + media analyses in parallel, each with a hard 12s timeout
        // so a slow/blocked CDN image can't stall the entire analyzeUrl call.
        const MEDIA_TIMEOUT = 12000;
        const safeJson = async (fetchPromise) => {
          try {
            const r = await fetchPromise;
            if (!r.ok) return null;
            return await r.json();
          } catch { return null; }
        };

        const [gemini, ...mediaRawResults] = await Promise.all([
          callGeminiAnalysis(title, url, pageText),
          // Images (up to 3 — capped to keep total time reasonable)
          ...pageImages.slice(0, 3).map(imgUrl => safeJson(net.fetch(IMAGE_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: imgUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
            signal: AbortSignal.timeout(MEDIA_TIMEOUT),
          })).then(d => d ? { _mediaType: 'image', url: imgUrl, ...d } : null)),
          // Videos (up to 2)
          ...pageVideos.slice(0, 2).map(vidUrl => safeJson(net.fetch(VIDEO_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: vidUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
            signal: AbortSignal.timeout(MEDIA_TIMEOUT),
          })).then(d => d ? { _mediaType: 'video', url: vidUrl, ...d } : null)),
          // Audio (up to 2)
          ...pageAudio.slice(0, 2).map(audUrl => safeJson(net.fetch(AUDIO_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_url: audUrl, session_id: IMAGE_MONITOR_SESSION_ID }),
            signal: AbortSignal.timeout(MEDIA_TIMEOUT),
          })).then(d => d ? { _mediaType: 'audio', url: audUrl, ...d } : null)),
        ]);

        // Collate media results
        const article_media = {
          images: mediaRawResults.filter(r => r?._mediaType === 'image'),
          videos: mediaRawResults.filter(r => r?._mediaType === 'video'),
          audio:  mediaRawResults.filter(r => r?._mediaType === 'audio'),
        };

        const entityId = crypto.createHash('sha256').update(`text-${url}-${title}`).digest('hex').substring(0, 16);
        const entity = {
          entity_id: entityId, entity_type: 'TEXT', content_title: title, url,
          detected_at: Date.now(), ...analysis,
          // Keep extracted text so ContentIntel enrichment can read it
          text: pageText.trim().substring(0, 4000),
          ...(gemini ? {
            ai_generated_probability: gemini.ai_generated_probability,
            misinformation_risk: gemini.misinformation_risk,
            credibility_score: gemini.credibility_score,
            explanation: gemini.forensic_explanation,
            ai_summary: gemini.ai_summary,
            topic: gemini.topic,
            key_claims: gemini.key_claims
          } : { ai_summary: null, topic: null, key_claims: [] }),
          article_media,
        };
        ENTITY_CACHE.set(entityId, entity);
        // Use risk_level from API (based on AI probability), fallback to misinformation_risk
        const urlRiskLevel = entity.risk_level || analysis.risk_level || entity.misinformation_risk || 'LOW';
        entity.risk_level = urlRiskLevel;
        db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: url, title, risk_level: urlRiskLevel, analysis: entity, detected_at: entity.detected_at });
        db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
        db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'TEXT', url });
        // Push to Detection Feed in renderer
        if (_mainWindow && !_mainWindow.isDestroyed()) {
          _mainWindow.webContents.send('text-monitor:analysis', entity);
        }
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
          body: JSON.stringify({ title: resolvedTitle, url: 'manual://input', text, word_count: words.length, timestamp: Date.now(), session_id: newManualSession() })
        }),
        callGeminiAnalysis(resolvedTitle, 'manual://input', text)
      ]);
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const body = await res.json(); detail = body?.detail || body?.message || detail; } catch {}
        return { success: false, error: detail };
      }
      const analysis = await res.json();
      const entityId = crypto.createHash('sha256').update(`text-manual-${Date.now()}-${text.substring(0, 30)}`).digest('hex').substring(0, 16);
      const entity = {
        entity_id: entityId, entity_type: 'TEXT', content_title: resolvedTitle, url: 'manual://input',
        detected_at: Date.now(), ...analysis,
        text: text.substring(0, 4000),  // for ContentIntel enrichment
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
      // Use risk_level from API (based on AI probability), fallback to misinformation_risk
      const manualRiskLevel = entity.risk_level || analysis.risk_level || entity.misinformation_risk || 'LOW';
      entity.risk_level = manualRiskLevel;  // Ensure entity has risk_level
      db.insertEntity({ entity_id: entityId, entity_type: 'TEXT', source_url: 'manual://input', title: resolvedTitle, text, risk_level: manualRiskLevel, analysis: entity, detected_at: entity.detected_at });
      db.insertTrustHistory(entityId, entity.trust_score ?? 0, entity.trust_score_delta ?? 0);
      db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'TEXT', source: 'manual_text' });
      return { success: true, entity };
    } catch (e) {
      console.error('[MANUAL-TEXT]', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('analyze:manual-video', async (_event, url) => {
    try {
      if (!url || !isValidHttpUrl(url)) return { success: false, error: 'Invalid video URL' };
      const res = await fetch(VIDEO_MONITOR_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: url, session_id: newManualSession() }),
        signal: AbortSignal.timeout(180000)
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const analysis = await res.json();
      const entityId = crypto.createHash('sha256').update(`video-manual-${Date.now()}-${url}`).digest('hex').substring(0, 16);
      const entity = {
        entity_id: entityId, entity_type: 'VIDEO',
        video_url: url, source_url: url,
        detected_at: Date.now(),
        fake_probability:  analysis.fake_probability  ?? 0,
        risk_level:        analysis.risk_level        ?? 'LOW',
        frames_analysed:   analysis.frames_analysed   ?? 0,
        frame_scores:      analysis.frame_scores      ?? [],
        forensic_explanation: analysis.forensic_explanation ?? [],
      };
      ENTITY_CACHE.set(entityId, entity);
      db.insertEntity({ entity_id: entityId, entity_type: 'VIDEO', source_url: url, risk_level: entity.risk_level, analysis: entity });
      db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'VIDEO', source: 'manual_video' });
      return { success: true, entity };
    } catch (e) {
      console.error('[MANUAL-VIDEO]', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('trust:reset', async () => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/trust/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: IMAGE_MONITOR_SESSION_ID }),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { success: true, trust_score: data.trust_score };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('analyze:manual-audio', async (_event, url) => {
    try {
      if (!url || !isValidHttpUrl(url)) return { success: false, error: 'Invalid audio URL' };
      const res = await net.fetch(AUDIO_MONITOR_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: url, session_id: newManualSession() }),
        signal: AbortSignal.timeout(120000)
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const analysis = await res.json();
      const entityId = crypto.createHash('sha256').update(`audio-manual-${Date.now()}-${url}`).digest('hex').substring(0, 16);
      const entity = {
        entity_id: entityId, entity_type: 'AUDIO',
        audio_url: url, source_url: url,
        detected_at: Date.now(),
        fake_probability:     analysis.fake_probability     ?? 0,
        risk_level:           analysis.risk_level           ?? 'LOW',
        duration_seconds:     analysis.duration_seconds     ?? null,
        analysis_type:        analysis.analysis_type        ?? 'ML',
        forensic_explanation: analysis.forensic_explanation ?? [],
      };
      ENTITY_CACHE.set(entityId, entity);
      db.insertEntity({ entity_id: entityId, entity_type: 'AUDIO', source_url: url, risk_level: entity.risk_level, analysis: entity });
      db.insertAuditLog('MANUAL_ANALYSIS', entityId, '', { type: 'AUDIO', source: 'manual_audio' });
      return { success: true, entity };
    } catch (e) {
      console.error('[MANUAL-AUDIO]', e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('analyze:manual-video-with-audio', async (_event, url) => {
    try {
      if (!url || !isValidHttpUrl(url)) return { success: false, error: 'Invalid video URL' };

      // Run video and audio analysis in parallel
      const [videoRes, audioRes] = await Promise.allSettled([
        (async () => {
          const r = await net.fetch(VIDEO_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_url: url, session_id: newManualSession() }),
            signal: AbortSignal.timeout(180000)
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })(),
        (async () => {
          const r = await net.fetch(AUDIO_MONITOR_API_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audio_url: url, session_id: newManualSession() }),
            signal: AbortSignal.timeout(120000)
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })(),
      ]);

      if (videoRes.status === 'rejected') {
        return { success: false, error: videoRes.reason?.message || 'Video analysis failed' };
      }

      const videoAnalysis = videoRes.value;
      const videoEntityId = crypto.createHash('sha256').update(`video-manual-${Date.now()}-${url}`).digest('hex').substring(0, 16);
      const videoEntity = {
        entity_id: videoEntityId, entity_type: 'VIDEO',
        video_url: url, source_url: url,
        detected_at: Date.now(),
        fake_probability:     videoAnalysis.fake_probability     ?? 0,
        risk_level:           videoAnalysis.risk_level           ?? 'LOW',
        frames_analysed:      videoAnalysis.frames_analysed      ?? 0,
        frame_scores:         videoAnalysis.frame_scores         ?? [],
        forensic_explanation: videoAnalysis.forensic_explanation ?? [],
      };
      ENTITY_CACHE.set(videoEntityId, videoEntity);
      db.insertEntity({ entity_id: videoEntityId, entity_type: 'VIDEO', source_url: url, risk_level: videoEntity.risk_level, analysis: videoEntity });
      db.insertAuditLog('MANUAL_ANALYSIS', videoEntityId, '', { type: 'VIDEO', source: 'manual_video_with_audio' });

      let audioEntity = null;
      if (audioRes.status === 'fulfilled') {
        const audioAnalysis = audioRes.value;
        const audioEntityId = crypto.createHash('sha256').update(`audio-from-video-${Date.now()}-${url}`).digest('hex').substring(0, 16);
        audioEntity = {
          entity_id: audioEntityId, entity_type: 'AUDIO',
          audio_url: url, source_url: url,
          detected_at: Date.now(),
          fake_probability:     audioAnalysis.fake_probability     ?? 0,
          risk_level:           audioAnalysis.risk_level           ?? 'LOW',
          duration_seconds:     audioAnalysis.duration_seconds     ?? null,
          analysis_type:        audioAnalysis.analysis_type        ?? 'ML',
          forensic_explanation: audioAnalysis.forensic_explanation ?? [],
        };
        ENTITY_CACHE.set(audioEntityId, audioEntity);
        db.insertEntity({ entity_id: audioEntityId, entity_type: 'AUDIO', source_url: url, risk_level: audioEntity.risk_level, analysis: audioEntity });
      } else {
        console.warn('[MANUAL-VIDEO-WITH-AUDIO] Audio analysis failed:', audioRes.reason?.message);
      }

      return { success: true, videoEntity, audioEntity };
    } catch (e) {
      console.error('[MANUAL-VIDEO-WITH-AUDIO]', e.message);
      return { success: false, error: e.message };
    }
  });

  // ── Rich content enrichment ───────────────────────────────────────────────
  ipcMain.handle('analyze:enrich', async (_event, payload) => {
    try {
      const res = await net.fetch('http://127.0.0.1:8000/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const b = await res.json(); detail = b?.detail || b?.error || detail; } catch {}
        return { error: detail };
      }
      return await res.json();
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('db:domain-reputation', () => db.queryDomainReputation());
  ipcMain.handle('alert-rules:list',   () => db.getAlertRules());
  ipcMain.handle('alert-rules:save',   (_, rule) => { db.saveAlertRule(rule); return db.getAlertRules(); });
  ipcMain.handle('alert-rules:delete', (_, ruleId) => { db.deleteAlertRule(ruleId); return db.getAlertRules(); });

  // ── Cases ─────────────────────────────────────────────────────────────────
  ipcMain.handle('cases:get', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases/${encodeURIComponent(id)}`);
    return res.json();
  });
  ipcMain.handle('cases:list', async (_, workspaceId) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases${workspaceId ? `?workspace_id=${workspaceId}` : ''}`);
    return res.json();
  });
  ipcMain.handle('cases:create', async (_, data) => {
    const res = await fetch('http://127.0.0.1:8000/api/cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  });
  ipcMain.handle('cases:update', async (_, { id, ...data }) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  });
  ipcMain.handle('cases:delete', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases/${id}`, { method: 'DELETE' });
    return res.json();
  });
  ipcMain.handle('cases:add-evidence', async (_, { caseId, ...ev }) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases/${caseId}/evidence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) });
    return res.json();
  });
  ipcMain.handle('cases:export', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/cases/${id}/export/edrm`);
    return { xml: await res.text() };
  });

  // ── Feedback ──────────────────────────────────────────────────────────────
  ipcMain.handle('feedback:submit', async (_, payload) => {
    const res = await fetch('http://127.0.0.1:8000/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  });

  // ── Community ─────────────────────────────────────────────────────────────
  ipcMain.handle('community:stats', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/community/stats');
    return res.json();
  });
  ipcMain.handle('community:check', async (_, payload) => {
    const res = await fetch('http://127.0.0.1:8000/api/community/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  });
  ipcMain.handle('community:report', async (_, payload) => {
    const res = await fetch('http://127.0.0.1:8000/api/community/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return res.json();
  });

  // ── Social Scanner ────────────────────────────────────────────────────────
  ipcMain.handle('social:list', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/social/feeds');
    return res.json();
  });
  ipcMain.handle('social:add', async (_, data) => {
    const res = await fetch('http://127.0.0.1:8000/api/social/feeds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  });
  ipcMain.handle('social:remove', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/social/feeds/${id}`, { method: 'DELETE' });
    return res.json();
  });
  ipcMain.handle('social:scan', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/social/scan');
    return res.json();
  });

  // ── Creator Shield ────────────────────────────────────────────────────────
  ipcMain.handle('creator:list', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/creator/profiles');
    return res.json();
  });
  ipcMain.handle('creator:register', async (_, profile) => {
    const res = await fetch('http://127.0.0.1:8000/api/creator/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    return res.json();
  });
  ipcMain.handle('creator:delete', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/creator/profiles/${id}`, { method: 'DELETE' });
    return res.json();
  });

  // ── Threat Map ────────────────────────────────────────────────────────────
  ipcMain.handle('threat-map:data', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/threat-map');
    return res.json();
  });

  // ── Trust Badge ───────────────────────────────────────────────────────────
  ipcMain.handle('badge:generate', async (_, url) => {
    const res = await fetch(`http://127.0.0.1:8000/api/badge/${encodeURIComponent(url)}`);
    return { svg: await res.text(), url };
  });

  // ── Newsroom ──────────────────────────────────────────────────────────────
  ipcMain.handle('newsroom:workspaces', async () => {
    const res = await fetch('http://127.0.0.1:8000/api/newsroom/workspaces');
    return res.json();
  });
  ipcMain.handle('newsroom:create', async (_, data) => {
    const res = await fetch('http://127.0.0.1:8000/api/newsroom/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return res.json();
  });
  ipcMain.handle('newsroom:delete', async (_, id) => {
    const res = await fetch(`http://127.0.0.1:8000/api/newsroom/workspaces/${id}`, { method: 'DELETE' });
    return res.json();
  });

  // ── Web News Search + AI Verdict ──────────────────────────────────────────
  ipcMain.handle('web:search', async (_event, { query = '', url = '' } = {}) => {
    try {
      const searchQuery = (query || url || '').trim().substring(0, 300);
      if (!searchQuery) return { success: false, error: 'No query provided', results: [] };

      // 1. Get search results from Python backend (Google News RSS + DDG)
      const searchRes = await fetch('http://127.0.0.1:8000/api/news-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, max_results: 10 }),
      });
      const searchData = await searchRes.json();
      const results   = searchData.results || [];
      const ddgAnswer = searchData.ddg_answer || null;

      // 2. AI verdict — Groq/Gemini analyses the search results
      let verdict = 'UNVERIFIED', ai_summary = '', key_sources = [], confidence = 0.5;

      if (results.length > 0 || ddgAnswer) {
        const snippets = [
          ...(ddgAnswer ? [`[${ddgAnswer.source || 'Web'}]: ${ddgAnswer.text}`] : []),
          ...results.slice(0, 8).map(r => `[${r.source}] "${r.title}": ${r.snippet}`),
        ].join('\n');

        const verdictMessages = [
          {
            role: 'system',
            content:
              'You are a professional fact-checker and misinformation analyst. ' +
              'Analyse the following news search results and determine the credibility of the claim. ' +
              'Respond ONLY with valid JSON — no prose outside the JSON.',
          },
          {
            role: 'user',
            content:
              `Claim / Query: "${searchQuery}"\n\n` +
              `Search results from the internet:\n${snippets}\n\n` +
              `Respond with this exact JSON:\n` +
              `{"verdict":"CONFIRMED|DISPUTED|UNVERIFIED|MISLEADING|SATIRE",` +
              `"confidence":0.0-1.0,` +
              `"summary":"2-3 sentence analysis of what internet sources say",` +
              `"key_sources":["source1","source2"]}`,
          },
        ];

        try {
          const raw = await callLegalAI(verdictMessages);
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) {
            const p = JSON.parse(m[0]);
            verdict     = p.verdict    || 'UNVERIFIED';
            ai_summary  = p.summary    || '';
            key_sources = p.key_sources || [];
            confidence  = typeof p.confidence === 'number' ? p.confidence : 0.5;
          }
        } catch (_) { /* keep defaults */ }
      }

      return { success: true, results, ddg_answer: ddgAnswer, verdict, ai_summary, key_sources, confidence, total: results.length, resolved_query: searchData.resolved_query || searchQuery };
    } catch (e) {
      console.error('[WEB-SEARCH]', e.message);
      return { success: false, error: e.message, results: [] };
    }
  });

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