/**
 * entity-view.js
 * Entity X — Full Investigation Mode
 *
 * Receives entity data via postMessage from the parent (index.html).
 * Renders the complete forensic investigation UI.
 * Sends { type: 'ev:close' } back to parent when user clicks Return.
 */

'use strict';

/* ── Helpers ─────────────────────────────────────────────── */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad(n) { return String(n).padStart(2, '0'); }

function fmtDate(ts) {
  if (!ts) return 'Unknown';
  var d = new Date(ts);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function riskClass(r) {
  r = (r || '').toUpperCase();
  return r === 'HIGH' ? 'risk-high' : r === 'MEDIUM' ? 'risk-medium' : 'risk-low';
}

function riskColor(r) {
  r = (r || '').toUpperCase();
  return r === 'HIGH' ? '#ff6b6b' : r === 'MEDIUM' ? '#fbbf24' : '#4ade80';
}

function scoreColor(pct) {
  return pct >= 70 ? '#ff6b6b' : pct >= 40 ? '#fbbf24' : '#4ade80';
}

function trustColor(score) {
  return score >= 80 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#ff6b6b';
}

function scoreLabel(score) {
  if (!isFinite(score)) return 'UNKNOWN';
  return score >= 80 ? 'STABLE' : score >= 50 ? 'WATCH' : 'CRITICAL';
}

/* forensic finding severity heuristic */
function findingSeverity(text, risk) {
  var t = text.toLowerCase();
  if (t.includes('high') || t.includes('manipulat') || t.includes('fabricat') || t.includes('false')) return 'severity-high';
  if (t.includes('moderate') || t.includes('medium') || t.includes('suspicious') || t.includes('inconsist')) return 'severity-med';
  if (t.includes('low') || t.includes('minor') || t.includes('unlikely') || t.includes('credib')) return 'severity-low';
  return 'severity-info';
}

/* ── Analysis Confidence Meter ──────────────────────────────────────── */

/**
 * Derive three independent confidence factors from the entity snapshot.
 *
 * Factor 1 — Signal Clarity   (0–40 pts)
 *   How decisively the primary probability score deviates from the
 *   ambiguous 50% midpoint.  A score of 50% contributes 0 pts; a score
 *   of 0% or 100% contributes the full 40 pts.
 *
 * Factor 2 — Evidence Depth   (0–35 pts)
 *   Number of distinct forensic indicators returned (5 pts each, max 7).
 *
 * Factor 3 — Analysis Depth   (0–25 pts)
 *   Whether richer AI-assisted forensic layers are present:
 *   AI summary (+15) and key claims (+10).
 *
 * The sum is clamped to [0, 100] and intentionally NEVER labelled as
 * a certainty measure — it reflects how much evidence is available,
 * not whether the evidence is correct.
 */
function computeConfidenceFactors(entity) {
  var isText = entity.entity_type === 'TEXT';
  var aiPct  = (isText
    ? (entity.ai_generated_probability || 0)
    : (entity.fake_probability || 0)) * 100;

  var findings = entity.explanation || entity.forensic_explanation || [];

  var f1 = Math.round((Math.abs(aiPct - 50) / 50) * 40);
  var f2 = Math.min(findings.length, 7) * 5;
  var f3 = 0;
  if (entity.ai_summary)                              f3 += 15;
  if (entity.key_claims && entity.key_claims.length)  f3 += 10;

  return {
    total:  Math.min(f1 + f2 + f3, 100),
    f1: f1,  f1Max: 40,  f1Label: 'Signal Clarity',
    f1Desc: 'Probability score divergence from the ambiguous midpoint',
    f2: f2,  f2Max: 35,  f2Label: 'Evidence Depth',
    f2Desc: findings.length + ' forensic indicator' + (findings.length !== 1 ? 's' : '') + ' identified',
    f3: f3,  f3Max: 25,  f3Label: 'Analysis Depth',
    f3Desc: entity.ai_summary
      ? 'AI forensic analysis layer present'
      : 'No AI enrichment — heuristic analysis only'
  };
}

/**
 * Render the Analysis Confidence Meter into #conf-body.
 * Uses an SVG semi-circular arc gauge + three factor bars.
 * All labels are probabilistic; no claim of certainty is made.
 */
function renderConfidenceMeter(entity) {
  var body = document.getElementById('conf-body');
  if (!body) return;

  var c   = computeConfidenceFactors(entity);
  var pct = c.total;

  /* Tier: colour + level label + cautious description */
  var color, lvl, desc;
  if (pct < 20) {
    color = '#2d4a62';
    lvl   = 'INSUFFICIENT DATA';
    desc  = 'Too few signals to assess. Treat all findings as preliminary and unconfirmed.';
  } else if (pct < 40) {
    color = '#f87171';
    lvl   = 'LOW';
    desc  = 'Limited signals detected. Findings are weakly indicative only — further evidence needed.';
  } else if (pct < 60) {
    color = '#fbbf24';
    lvl   = 'PARTIAL';
    desc  = 'Some corroborating signals present. Interpret carefully and seek independent review.';
  } else if (pct < 80) {
    color = '#4facfe';
    lvl   = 'MODERATE';
    desc  = 'Multiple signals identified. Findings are reasonably supported but not conclusive.';
  } else {
    color = '#4ade80';
    lvl   = 'HIGH';
    desc  = 'Strong signal convergence across multiple indicators. Findings are well-supported, not proven.';
  }

  /* ── SVG semi-circular arc gauge ──
   * Arc: M 22 90 A 78 78 0 0 1 178 90 (r=78, centre at 100,90)
   * Arc length = π × 78 ≈ 245.04
   * Filled segment: stroke-dasharray="<filled> <totalLen+slack>"
   */
  var R   = 78, CX = 100, CY = 90;
  var ARC = Math.PI * R;           /* ≈ 245.04 */
  var filled = (pct / 100) * ARC;
  var x1 = CX - R, x2 = CX + R;
  var arcD = 'M ' + x1 + ' ' + CY + ' A ' + R + ' ' + R + ' 0 0 1 ' + x2 + ' ' + CY;

  /* Tick mark at the 50% point (top of arc) */
  var tick = '<line x1="' + CX + '" y1="' + (CY - R + 5) + '" x2="' + CX + '" y2="' + (CY - R - 3) + '" stroke="#1a2d45" stroke-width="1.5"/>';

  /* Scale labels */
  var lbls = '<text x="' + (x1 - 3) + '" y="' + (CY + 4) + '" text-anchor="end" font-family="Consolas,monospace" font-size="7" fill="#1e3347">0</text>'
           + '<text x="' + (x2 + 3) + '" y="' + (CY + 4) + '" text-anchor="start" font-family="Consolas,monospace" font-size="7" fill="#1e3347">100</text>'
           + '<text x="' + CX + '" y="' + (CY - R - 7) + '" text-anchor="middle" font-family="Consolas,monospace" font-size="7" fill="#1e3347">50</text>';

  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 99"'
    + ' class="conf-gauge-svg" role="img" aria-label="Analysis confidence estimate: ' + pct + ' out of 100">'
    /* track  */ + '<path d="' + arcD + '" stroke="#0f1c2e" stroke-width="12" fill="none" stroke-linecap="round"/>'
    /* fill */   + '<path d="' + arcD + '" stroke="' + color + '" stroke-width="12" fill="none" stroke-linecap="round"'
    +              ' stroke-dasharray="' + filled.toFixed(1) + ' ' + (ARC + 20).toFixed(0) + '"/>'
    /* tick */   + tick
    /* labels */ + lbls
    /* number */ + '<text x="' + CX + '" y="' + (CY - 7) + '" text-anchor="middle" font-family="Consolas,Courier New,monospace"'
    +              ' font-size="27" font-weight="700" fill="' + color + '">' + pct + '</text>'
    /* /100 */   + '<text x="' + CX + '" y="' + (CY + 7) + '" text-anchor="middle" font-family="Consolas,Courier New,monospace"'
    +              ' font-size="8" fill="' + color + '" opacity="0.55">/ 100</text>'
    + '</svg>';

  /* ── Factor bar helper ── */
  function factorBar(label, val, maxVal, subdesc) {
    var pf = maxVal > 0 ? Math.round((val / maxVal) * 100) : 0;
    var fc = pf >= 70 ? '#4ade80' : pf >= 40 ? '#4facfe' : '#2d4a62';
    return '<div class="conf-factor">'
      + '<div class="conf-factor-row">'
      + '<span class="conf-factor-lbl">' + esc(label) + '</span>'
      + '<span class="conf-factor-val" style="color:' + fc + ';">' + val + '\u202f/\u202f' + maxVal + '</span>'
      + '</div>'
      + '<div class="conf-factor-track"><div class="conf-factor-fill" style="width:' + pf + '%;background:' + fc + ';"></div></div>'
      + '<div class="conf-factor-subdesc">' + esc(subdesc) + '</div>'
      + '</div>';
  }

  body.innerHTML = svg
    + '<div class="conf-verdict" style="color:' + color + ';">' + esc(lvl) + '\u00a0CONFIDENCE</div>'
    + '<div class="conf-desc-txt">' + esc(desc) + '</div>'
    + '<div class="conf-factors">'
    + factorBar(c.f1Label, c.f1, c.f1Max, c.f1Desc)
    + factorBar(c.f2Label, c.f2, c.f2Max, c.f2Desc)
    + factorBar(c.f3Label, c.f3, c.f3Max, c.f3Desc)
    + '</div>'
    + '<div class="conf-disclaimer">'
    + '&#x26A0;\u202fEstimated metric only. Does not establish fact, legal validity, or certainty of any kind.'
    + '</div>';
}

/* ── Main render ─────────────────────────────────────────── */
var _entity = null;
var _renderTimeline; // populated after render

function renderInvestigation(entity) {
  _entity = entity;
  var isText = entity.entity_type === 'TEXT';
  var risk = isText ? (entity.misinformation_risk || 'LOW') : (entity.risk_level || 'LOW');
  var aiPct = isText
    ? ((entity.ai_generated_probability || 0) * 100)
    : ((entity.fake_probability || 0) * 100);
  var credPct = (entity.credibility_score || 0) * 100;
  var fakePct = (entity.fake_probability || 0) * 100;
  var trustScore = entity.trust_score || 100;
  var trustDelta = entity.trust_score_delta || 0;
  var expl = entity.explanation || entity.forensic_explanation || [];
  var source = isText
    ? (entity.content_title || entity.url || 'Manual Input')
    : (entity.image_url || 'Unknown');

  /* ── LEFT SIDEBAR ── */

  // Entity overview
  var typeBadge = document.getElementById('ov-type-badge');
  typeBadge.textContent = entity.entity_type || 'UNKNOWN';
  typeBadge.className = 'ov-type-badge ' + (isText ? 'otb-txt' : 'otb-img');

  var riskBadge = document.getElementById('ov-risk-badge');
  riskBadge.textContent = risk;
  riskBadge.className = 'ov-risk-badge ' + riskClass(risk);

  document.getElementById('ov-source').textContent = source.substring(0, 120);
  document.getElementById('ov-source').title = source;
  document.getElementById('ov-ts').textContent = 'Detected: ' + fmtDate(entity.detected_at);

  if (entity.topic) {
    document.getElementById('ov-topic').innerHTML = '<div class="ov-topic">' + esc(entity.topic) + '</div>';
  }

  document.getElementById('topbar-entity-id').textContent = entity.entity_id || 'N/A';

  // Forensic scores
  var aiPctRounded = aiPct.toFixed(1);
  document.getElementById('sc-ai').textContent = aiPctRounded + '%';
  document.getElementById('sc-ai').style.color = scoreColor(aiPct);
  document.getElementById('sc-ai-bar').style.width = Math.round(aiPct) + '%';
  document.getElementById('sc-ai-bar').style.background = scoreColor(aiPct);

  if (isText) {
    document.getElementById('sc-cred-item').style.display = '';
    document.getElementById('sc-cred').textContent = credPct.toFixed(1) + '%';
    document.getElementById('sc-cred').style.color = credPct >= 70 ? '#4facfe' : credPct >= 45 ? '#fbbf24' : '#ff6b6b';
    document.getElementById('sc-cred-bar').style.width = Math.round(credPct) + '%';
  } else {
    document.getElementById('sc-fake-item').style.display = '';
    document.getElementById('sc-fake').textContent = fakePct.toFixed(1) + '%';
    document.getElementById('sc-fake').style.color = scoreColor(fakePct);
    document.getElementById('sc-fake-bar').style.width = Math.round(fakePct) + '%';
    document.getElementById('sc-fake-bar').style.background = scoreColor(fakePct);
  }

  // Trust score
  var tsEl = document.getElementById('trust-big');
  tsEl.textContent = isFinite(trustScore) ? trustScore.toFixed(0) : '100';
  tsEl.style.color = trustColor(trustScore);
  document.getElementById('trust-lbl').textContent = scoreLabel(trustScore);
  document.getElementById('trust-bar').style.width = Math.min(100, Math.max(0, trustScore)) + '%';
  document.getElementById('trust-bar').style.background = trustColor(trustScore);

  if (trustDelta !== 0) {
    var deltaEl = document.getElementById('trust-delta');
    deltaEl.textContent = (trustDelta > 0 ? '+' : '') + trustDelta.toFixed(2);
    deltaEl.style.color = trustDelta < 0 ? '#ff6b6b' : '#4ade80';
  }

  // Evidence snapshot
  var thumbWrap = document.getElementById('ev-thumb-wrap');
  if (!isText && entity.image_url) {
    thumbWrap.innerHTML = '<img class="ev-thumb-img" src="' + esc(entity.image_url) + '" alt="Evidence image" onerror="this.outerHTML=\'<div class=\\\'ev-thumb-ph\\\'>&#x1F4F7;</div>\'">';
  } else {
    thumbWrap.innerHTML = '<div class="ev-thumb-ph">' + (isText ? '&#x1F4C4;' : '&#x1F5BC;') + '</div>';
  }

  // Meta tags
  var tags = [];
  if (entity.word_count) tags.push('Words: ' + entity.word_count);
  if (entity.session_id) tags.push('Session: ' + String(entity.session_id).substring(0, 12));
  tags.push('Type: ' + (entity.entity_type || 'UNKNOWN'));
  if (entity.analyzed_at) tags.push('Analyzed: ' + new Date(entity.analyzed_at).toLocaleTimeString());
  document.getElementById('ev-meta-tags').innerHTML = tags.map(function (t) {
    return '<span class="tag">' + esc(t) + '</span>';
  }).join('');

  // Analysis Confidence Meter
  renderConfidenceMeter(entity);

  /* ── MAIN CONTENT ── */
  var main = document.getElementById('ev-main');
  main.innerHTML = '';

  // 1. FORENSIC FINDINGS
  var findings = buildForensicBlock(expl, risk);
  main.appendChild(findings);

  // 2. AI SUMMARY (if Gemini data present)
  if (isText && entity.ai_summary) {
    main.appendChild(buildAISummaryBlock(entity));
  }

  // 3. KEY CLAIMS
  if (isText && entity.key_claims && entity.key_claims.length) {
    main.appendChild(buildKeyClaimsBlock(entity.key_claims));
  }

  // 4. ARTICLE TEXT
  if (isText) {
    main.appendChild(buildArticleTextBlock(entity));
  }

  // 5. DETECTION TIMELINE
  main.appendChild(buildTimelineBlock(entity));

  // 5.5 TRUST SCORE TIMELINE
  var _tcBlock = buildTrustChartBlock(entity);
  main.appendChild(_tcBlock);
  requestAnimationFrame(function () {
    var _tcCanvas = document.getElementById('trust-chart-canvas');
    if (_tcCanvas) drawTrustChart(_tcCanvas, _tcBlock._chartPoints, _tcBlock._chartColor);
  });

  // 6. LEGAL / COMPLAINT
  main.appendChild(buildLegalBlock(entity, risk, aiPct));

  // Request chat history for this entity from SQLite (async, non-blocking)
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'ev:legal-chat-history', entity_id: entity.entity_id || '' }, '*');
  }

  // Hide loading
  document.getElementById('ev-loading').classList.remove('visible');
}

/* ── Section builders ───────────────────────────────────── */

function buildForensicBlock(expl, risk) {
  var block = document.createElement('div');
  block.className = 'ev-block';
  var inner = '';
  if (expl && expl.length > 0) {
    inner = '<ul class="forensic-list">'
      + expl.map(function (item, i) {
          var sev = findingSeverity(String(item), risk);
          return '<li class="forensic-item ' + sev + '">'
            + '<div class="fi-num">' + (i + 1) + '</div>'
            + '<div class="fi-text">' + esc(String(item)) + '</div>'
            + '</li>';
        }).join('')
      + '</ul>';
  } else {
    inner = '<div class="ev-empty">No forensic findings available for this entity.</div>';
  }
  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x2295;</span>Forensic Findings</div>'
    + '<span style="font-size:8px;color:#1e3347;">' + expl.length + ' findings</span>'
    + '</div>'
    + '<div class="ev-block-body">' + inner + '</div>';
  return block;
}

function buildAISummaryBlock(entity) {
  var block = document.createElement('div');
  block.className = 'ev-block';
  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x2728;</span>AI Summary &mdash; Gemini 2.0 Flash</div>'
    + (entity.topic ? '<span style="font-size:8px;color:#4facfe;padding:2px 8px;border-radius:3px;background:rgba(79,172,254,.1);">' + esc(entity.topic) + '</span>' : '')
    + '</div>'
    + '<div class="ev-block-body">'
    + '<div class="ai-summary-block">'
    + (entity.topic ? '<div class="ais-topic">Topic: ' + esc(entity.topic) + '</div>' : '')
    + '<div class="ais-text">' + esc(entity.ai_summary) + '</div>'
    + '</div>'
    + '</div>';
  return block;
}

function buildKeyClaimsBlock(claims) {
  var block = document.createElement('div');
  block.className = 'ev-block';
  var claimsHtml = '<div class="claims-list">'
    + claims.map(function (c, i) {
        return '<div class="claim-item">'
          + '<span class="claim-num">C' + (i + 1) + '</span>'
          + '<div class="claim-text">' + esc(String(c)) + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x1F4CB;</span>Key Claims Identified</div>'
    + '<span style="font-size:8px;color:#1e3347;">' + claims.length + ' claims</span>'
    + '</div>'
    + '<div class="ev-block-body">' + claimsHtml + '</div>';
  return block;
}

function buildArticleTextBlock(entity) {
  var block = document.createElement('div');
  block.className = 'ev-block';
  var text = entity.text || '';
  var wordCount = entity.word_count || (text.split(/\s+/).filter(Boolean).length);
  var inner = text
    ? '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
        + '<span style="font-size:8px;color:#1e3347;">' + wordCount + ' words &nbsp;|&nbsp; Read-only</span>'
        + '</div>'
        + '<div class="article-text">' + esc(text.substring(0, 8000)) + (text.length > 8000 ? '\n\n[Truncated — ' + Math.round(text.length / 4) + ' more characters]' : '') + '</div>'
    : '<div class="article-text-empty">Full article text not available. The text field was not stored with this entity.<br><br>Browse directly to the source URL to view content.</div>';
  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x1F4F0;</span>Full Article Text</div>'
    + (entity.url && entity.url !== 'manual://input'
        ? '<a href="#" class="legal-copy-btn" id="open-src-btn" style="font-size:8px;text-decoration:none;">Open Source &rarr;</a>'
        : '')
    + '</div>'
    + '<div class="ev-block-body">' + inner + '</div>';
  return block;
}

/* ── Trust Score Timeline ────────────────────────────────────────────────── */

/**
 * Reconstruct a plausible trust-score history from the entity snapshot.
 * Returns an ordered array of { t (epoch ms), score (0-100), label }.
 */
function _deriveTrustPoints(entity) {
  var current  = Math.max(0, Math.min(100, parseFloat(entity.trust_score)  || 100));
  var delta    = parseFloat(entity.trust_score_delta) || 0;
  var preScore = Math.max(0, Math.min(100, current - delta));
  var t1       = entity.detected_at  || Date.now();
  var t2       = entity.analyzed_at  || (t1 + 600);
  var tNow     = Date.now();

  /* Guarantee monotonic ordering even when timestamps are identical */
  if (t2 <= t1)   t2   = t1 + 600;
  if (tNow <= t2) tNow = t2 + 200;

  /* No delta means the trust score was already at this level */
  var pts = [
    { t: t1 - 1800, score: Math.min(100, preScore + Math.abs(delta) * 0.4), label: 'Pre-scan'  },
    { t: t1,        score: preScore,                                          label: 'Detected'  },
    { t: t2,        score: current,                                           label: 'Analyzed'  },
    { t: tNow,      score: current,                                           label: 'Current'   }
  ];

  /* Flat line when there was no change */
  if (Math.abs(delta) < 0.005) {
    pts[0].score = current;
    pts[1].score = current;
  }

  return pts;
}

/**
 * Build the Trust Score Timeline ev-block DOM element.
 * The canvas is drawn after insertion via requestAnimationFrame.
 */
function buildTrustChartBlock(entity) {
  var block    = document.createElement('div');
  block.className = 'ev-block';

  var pts      = _deriveTrustPoints(entity);
  var last     = pts[pts.length - 1].score;
  var lineColor = last >= 80 ? '#4ade80' : last >= 50 ? '#fbbf24' : '#ff6b6b';
  var statusLbl = last >= 80 ? 'STABLE' : last >= 50 ? 'WATCH' : 'CRITICAL';
  var deltaVal  = parseFloat(entity.trust_score_delta) || 0;
  var deltaStr  = deltaVal === 0 ? '—' : (deltaVal > 0 ? '+' : '') + deltaVal.toFixed(2);
  var deltaCol  = deltaVal < 0 ? '#ff6b6b' : deltaVal > 0 ? '#4ade80' : '#2d4a62';

  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x1F4C8;</span>Trust Score Timeline</div>'
    + '<div style="display:flex;align-items:center;gap:10px;">'
    + '<span style="font-size:9px;font-weight:700;color:' + lineColor + ';">' + last.toFixed(0) + '/100 &mdash; ' + statusLbl + '</span>'
    + '<span style="font-size:8px;font-weight:700;color:' + deltaCol + ';">\u0394 ' + deltaStr + '</span>'
    + '</div>'
    + '</div>'
    + '<div class="ev-block-body" style="padding:10px 16px 16px;">'
    + '<div class="trust-chart-wrap">'
    + '<canvas class="trust-chart-canvas" id="trust-chart-canvas"></canvas>'
    + '</div>'
    + '</div>';

  block._chartPoints = pts;
  block._chartColor  = lineColor;
  return block;
}

/**
 * Catmull-Rom cubic bezier spline — connects pts already mapped to px coords.
 * ctx.beginPath / moveTo must be called by the caller first.
 */
function _drawSmoothLine(ctx, xs, ys) {
  if (xs.length < 2) return;
  for (var i = 1; i < xs.length; i++) {
    var cpx = (xs[i - 1] + xs[i]) / 2;
    ctx.bezierCurveTo(cpx, ys[i - 1], cpx, ys[i], xs[i], ys[i]);
  }
}

/**
 * Render the trust-score line chart onto the given canvas element.
 * Pure Canvas 2D — zero external dependencies.
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{t:number,score:number,label:string}>} pts
 * @param {string} lineColor  Hex colour for the line and accent elements
 */
function drawTrustChart(canvas, pts, lineColor) {
  /* ── Size canvas for device pixel ratio ── */
  var W   = canvas.offsetWidth || (canvas.parentElement || {}).offsetWidth || 520;
  var H   = 148;
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width  = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  /* ── Layout constants ── */
  var PL = 36, PR = 14, PT = 16, PB = 34;
  var cW = W - PL - PR;
  var cH = H - PT - PB;

  /* ── Coordinate mappers ── */
  var tMin = pts[0].t, tMax = pts[pts.length - 1].t;
  function xOf(t) {
    if (tMax === tMin) return PL + cW / 2;
    return PL + ((t - tMin) / (tMax - tMin)) * cW;
  }
  function yOf(s) {
    return PT + cH - (Math.max(0, Math.min(100, s)) / 100) * cH;
  }
  function hhmmss(ts) {
    var d = new Date(ts);
    return String(d.getHours()).padStart(2,'0') + ':'
         + String(d.getMinutes()).padStart(2,'0') + ':'
         + String(d.getSeconds()).padStart(2,'0');
  }

  /* Convert hex '#rrggbb' to 'r,g,b' string for rgba() */
  var rgb = (parseInt(lineColor.slice(1,3),16) + ','
           + parseInt(lineColor.slice(3,5),16) + ','
           + parseInt(lineColor.slice(5,7),16));

  /* Pre-compute pixel coords */
  var xs = pts.map(function(p){ return xOf(p.t); });
  var ys = pts.map(function(p){ return yOf(p.score); });

  /* ── Background ── */
  ctx.fillStyle = '#060c15';
  ctx.fillRect(0, 0, W, H);

  /* ── Horizontal grid lines + Y labels ── */
  [0, 25, 50, 75, 100].forEach(function(v) {
    var gy = yOf(v);
    ctx.beginPath();
    ctx.setLineDash(v === 50 ? [3, 5] : [2, 6]);
    ctx.strokeStyle = v === 50 ? '#192940' : '#0f1c2e';
    ctx.lineWidth = 1;
    ctx.moveTo(PL, gy);
    ctx.lineTo(PL + cW, gy);
    ctx.stroke();
    ctx.setLineDash([]);

    /* Risk-zone label at 50 */
    if (v === 50) {
      ctx.fillStyle = '#13243a';
      ctx.font = '7px "Consolas",monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('WATCH THRESHOLD', PL + 4, gy - 2);
    }

    /* Y-axis value */
    ctx.fillStyle = '#1e3347';
    ctx.font = '7.5px "Consolas","Courier New",monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(v), PL - 5, gy);
  });

  /* ── Gradient fill under the line ── */
  var grad = ctx.createLinearGradient(0, PT, 0, PT + cH);
  grad.addColorStop(0,   'rgba(' + rgb + ',0.20)');
  grad.addColorStop(0.6, 'rgba(' + rgb + ',0.06)');
  grad.addColorStop(1,   'rgba(' + rgb + ',0.00)');

  ctx.beginPath();
  ctx.moveTo(xs[0], PT + cH);
  ctx.lineTo(xs[0], ys[0]);
  _drawSmoothLine(ctx, xs, ys);
  ctx.lineTo(xs[xs.length - 1], PT + cH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* ── Line ── */
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  _drawSmoothLine(ctx, xs, ys);
  ctx.strokeStyle = lineColor;
  ctx.lineWidth   = 2;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  /* ── Dots + annotations ── */
  pts.forEach(function(p, i) {
    var px = xs[i], py = ys[i];
    var isLast = (i === pts.length - 1);

    /* Glow halo on current point */
    if (isLast) {
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + rgb + ',0.14)';
      ctx.fill();
    }

    /* Dot */
    ctx.beginPath();
    ctx.arc(px, py, isLast ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle   = isLast ? lineColor : '#0d1728';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = isLast ? 0 : 1.5;
    ctx.fill();
    if (!isLast) ctx.stroke();

    /* Score text above dot */
    ctx.fillStyle    = isLast ? lineColor : '#2d4a62';
    ctx.font         = (isLast ? 'bold ' : '') + '8px "Consolas","Courier New",monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.score.toFixed(0), px, py - 8);

    /* X-axis time label */
    ctx.fillStyle    = '#1e3347';
    ctx.font         = '7px "Consolas","Courier New",monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'center';
    /* Nudge first label right, last label left to avoid clipping */
    var lx = i === 0 ? Math.max(PL + 18, px) : i === pts.length - 1 ? Math.min(PL + cW - 18, px) : px;
    ctx.fillText(hhmmss(p.t), lx, PT + cH + 8);

    /* Label pill below time */
    ctx.fillStyle    = '#132030';
    ctx.font         = '6.5px "Segoe UI",Arial,sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label.toUpperCase(), lx, PT + cH + 19);
  });

  /* ── Axes ── */
  ctx.beginPath();
  ctx.strokeStyle = '#1a2d45';
  ctx.lineWidth   = 1;
  ctx.moveTo(PL, PT);
  ctx.lineTo(PL, PT + cH);
  ctx.lineTo(PL + cW, PT + cH);
  ctx.stroke();

  /* ── Redraw on container resize (ResizeObserver, if available) ── */
  if (typeof ResizeObserver !== 'undefined' && !canvas._trustRO) {
    var _ro = new ResizeObserver(function () {
      requestAnimationFrame(function () {
        if (canvas.isConnected) drawTrustChart(canvas, pts, lineColor);
        else _ro.disconnect();
      });
    });
    _ro.observe(canvas.parentElement);
    canvas._trustRO = _ro;
  }
}

function buildTimelineBlock(entity) {
  var block = document.createElement('div');
  block.className = 'ev-block';

  var events = [];
  var detectedAt = entity.detected_at || Date.now();

  events.push({ ts: detectedAt, label: 'Entity detected and captured', type: 'detection', current: true });

  if (entity.analyzed_at && entity.analyzed_at !== detectedAt) {
    events.push({ ts: entity.analyzed_at, label: 'Backend analysis completed', type: 'analysis' });
  } else {
    events.push({ ts: detectedAt + 400, label: 'Backend heuristic analysis completed', type: 'analysis' });
  }

  if (entity.ai_summary) {
    events.push({ ts: detectedAt + 1800, label: 'Gemini 2.0 Flash forensic analysis completed — topic: ' + (entity.topic || 'General'), type: 'gemini' });
  }

  if ((entity.misinformation_risk || entity.risk_level || 'LOW').toUpperCase() === 'HIGH') {
    events.push({ ts: detectedAt + 2200, label: 'High-risk verdict issued — trust score decremented', type: 'alert' });
  }

  events.push({ ts: detectedAt + 2500, label: 'Entity cached and available for investigation', type: 'cached' });
  events.push({ ts: Date.now(), label: 'Investigation view opened', type: 'view', current: true });

  var timelineHtml = '<div class="timeline">'
    + events.sort(function (a, b) { return a.ts - b.ts; }).map(function (ev) {
        var typeColors = {
          detection: '#4facfe',
          analysis: '#4ade80',
          gemini: '#c084fc',
          alert: '#ff6b6b',
          cached: '#2d4a62',
          view: '#4facfe'
        };
        var col = typeColors[ev.type] || '#2d4a62';
        return '<div class="tl-item">'
          + '<div class="tl-dot-col">'
          + '<div class="tl-dot' + (ev.current ? ' tl-current' : '') + '" style="border-color:' + col + ';background:' + col + ';"></div>'
          + '</div><div class="tl-content">'
          + '<div class="tl-time">' + new Date(ev.ts).toLocaleTimeString() + '</div>'
          + '<div class="tl-event">' + esc(ev.label) + '</div>'
          + '<span class="tl-badge" style="background:' + col + '22;color:' + col + ';">' + ev.type.toUpperCase() + '</span>'
          + '</div></div>';
      }).join('')
    + '</div>';

  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x23F1;</span>Detection Timeline</div>'
    + '<span style="font-size:8px;color:#1e3347;">' + events.length + ' events</span>'
    + '</div>'
    + '<div class="ev-block-body">' + timelineHtml + '</div>';
  return block;
}

/**
 * buildLegalBlock — Legal & Reporting Assistance
 *
 * Design rules:
 *  - Draft never auto-submits; it is always user-reviewed first
 *  - Evidence panel is read-only (display only)
 *  - Editable textarea gives full control to the user
 *  - All probabilistic language is generated server-side
 *  - Clear disclaimer is always visible
 */
function buildLegalBlock(entity, risk, aiPct) {
  var block = document.createElement('div');
  block.className = 'ev-block';
  var isText = entity.entity_type === 'TEXT';
  var source = isText ? (entity.url || 'manual://input') : (entity.image_url || 'N/A');
  var title  = isText ? (entity.content_title || 'Untitled Document') : 'Image Entity';
  var findings = (entity.explanation || entity.forensic_explanation || []);

  /* ── Evidence row helper ── */
  function evRow(lbl, val) {
    return '<div class="legal-ev-row">'
      + '<span class="legal-ev-lbl">' + esc(lbl) + '</span>'
      + '<span class="legal-ev-val">' + esc(String(val)) + '</span>'
      + '</div>';
  }

  /* ── Read-only evidence panel ── */
  var evidenceHtml = '<div class="legal-evidence-panel">'
    + '<div class="legal-evidence-hdr">'
    + '<span class="legal-evidence-title">&#x1F50D; Evidence Summary</span>'
    + '<span class="legal-evidence-ro">READ-ONLY</span>'
    + '</div>'
    + '<div class="legal-evidence-body">'
    + evRow('Entity ID',      entity.entity_id || 'N/A')
    + evRow('Type',           entity.entity_type || 'UNKNOWN')
    + evRow('Source',         source)
    + evRow('Risk verdict',   risk)
    + evRow('AI probability', aiPct.toFixed(1) + '%')
    + (isText
        ? evRow('Credibility score', ((entity.credibility_score || 0) * 100).toFixed(1) + '%')
        : evRow('Fake probability',  ((entity.fake_probability  || 0) * 100).toFixed(1) + '%'))
    + evRow('Trust Δ',        (entity.trust_score_delta || 0).toFixed(2))
    + (findings.length
        ? '<div class="legal-ev-row"><span class="legal-ev-lbl">Forensic findings</span>'
          + '<span class="legal-ev-val"><ul class="legal-ev-list">'
          + findings.map(function(f){ return '<li>' + esc(f) + '</li>'; }).join('')
          + '</ul></span></div>'
        : '')
    + '</div></div>';

  /* ── Disclaimer banner ── */
  var disclaimerHtml = '<div class="legal-disclaimer">'
    + '<div class="legal-disclaimer-icon">&#x26A0;&#xFE0F;</div>'
    + '<div class="legal-disclaimer-text">'
    + '<strong>NOT LEGAL ADVICE.</strong> This tool generates a neutral, probabilistic '
    + 'platform-review request only. It does not constitute a legal filing, a formal '
    + 'complaint, or regulatory action. All findings are estimates from automated systems. '
    + 'You are responsible for reviewing, editing, and deciding whether to submit this text. '
    + 'Consult a qualified legal professional before taking any formal action.'
    + '</div></div>';

  /* ── Channel guidance (static info cards) ── */
  var options = [
    { icon: '&#x1F4E4;', title: 'Platform Trust & Safety',
      desc: 'Submit via the platform\'s own reporting flow, attaching the generated draft and this evidence summary as supporting context.' },
    { icon: '&#x1F4BC;', title: 'Internal Compliance',
      desc: 'Forward the draft and evidence to your organisation\'s compliance or legal team for formal review before any external submission.' },
    { icon: '&#x1F9FE;', title: 'Independent Fact-Check',
      desc: 'Share the content reference with independent fact-checking organisations (e.g. FullFact, Snopes, AFP Fact Check) for verification.' }
  ];
  var optionsHtml = options.map(function(o) {
    return '<div class="legal-option">'
      + '<div class="legal-opt-title">' + o.icon + ' ' + esc(o.title) + '</div>'
      + '<div class="legal-opt-desc">' + esc(o.desc) + '</div>'
      + '</div>';
  }).join('');

  /* ── Draft area (hidden until generated) ── */
  var draftId     = 'legal-draft-ta';
  var draftWrapId = 'legal-draft-wrap';
  var genBtnId    = 'legal-gen-btn';
  var genStatusId = 'legal-gen-status';
  var copyBtnId   = 'legal-copy-draft-btn';
  var txtBtnId    = 'legal-export-txt-btn';
  var jsonBtnId   = 'legal-export-json-btn';

  var draftHtml = '<div class="legal-draft-wrap" id="' + draftWrapId + '">'
    + '<div class="legal-draft-label">'
    + '&#x1F4DD; Complaint Draft'
    + '<span class="legal-draft-editable">EDITABLE — review before use</span>'
    + '</div>'
    + '<textarea class="legal-draft-textarea" id="' + draftId + '" spellcheck="true" '
    + 'placeholder="Draft will appear here after generation…"></textarea>'
    + '<div class="legal-action-row">'
    + '<button class="legal-action-btn" id="' + copyBtnId + '">&#x1F4CB; Copy Text</button>'
    + '<button class="legal-action-btn" id="' + txtBtnId + '">&#x2B07; Export .TXT</button>'
    + '<button class="legal-action-btn json-btn" id="' + jsonBtnId + '">&#x2B07; Export .JSON</button>'
    + '</div>'
    + '</div>';

  /* ── Legal Awareness Chat input section ── */
  var chatSectionHtml = '<div class="legal-chat-section" id="legal-chat-section">'
    + '<div class="legal-chat-hdr">'
    + '<span class="legal-chat-title">&#x1F4AC; Legal Awareness Chat</span>'
    + '<span class="legal-chat-badge">AUDIT LOG</span>'
    + '</div>'
    + '<div class="legal-chat-disclaimer">'
    + '&#x26A0;&#xFE0F; This information is for general awareness only and not legal advice.'
    + '</div>'
    + '<div class="legal-chat-messages" id="legal-chat-messages"></div>'
    + '<div class="legal-chat-input-row">'
    + '<input type="text" id="legal-chat-input" class="legal-chat-input" '
    + 'placeholder="Ask about laws, procedures, or your options…" maxlength="500" autocomplete="off" />'
    + '<button id="legal-chat-send-btn" class="legal-chat-send-btn">Send</button>'
    + '</div>'
    + '<div class="legal-chat-status" id="legal-chat-status"></div>'
    + '</div>';

  /* ── Assemble block ── */
  block.innerHTML = '<div class="ev-block-hdr">'
    + '<div class="ev-block-title"><span class="ev-block-icon">&#x2696;</span>Legal &amp; Reporting Assistance</div>'
    + '</div>'
    + '<div class="ev-block-body">'
    + '<div class="legal-block">'
    + disclaimerHtml
    + evidenceHtml
    + optionsHtml
    + '<div class="legal-gen-wrap">'
    + '<button class="legal-gen-btn" id="' + genBtnId + '">'
    + '<span class="legal-gen-spinner"></span>'
    + '&#x1F4C4; Generate Complaint Draft'
    + '</button>'
    + '<span class="legal-gen-status" id="' + genStatusId + '"></span>'
    + '</div>'
    + draftHtml
    + chatSectionHtml
    + '</div>'
    + '</div>';

  /* Store entity on block for the message handler to access */
  block._legalEntity = entity;

  return block;
}

/* ── Legal block runtime helpers ─────────────────────────────────────────────── */

/**
 * Called when the user clicks "Generate Complaint Draft".
 * Sends a request to the parent window which relays it through IPC to the backend.
 */
function _legalGenerate(entity) {
  var isText = entity.entity_type === 'TEXT';
  var payload = {
    entity_id:              entity.entity_id   || 'N/A',
    entity_type:            entity.entity_type || 'UNKNOWN',
    source_url:             (isText ? entity.url : entity.image_url) || '',
    content_title:          (isText ? entity.content_title : 'Image Entity') || '',
    ai_generated_probability: isText ? (entity.ai_generated_probability || null) : null,
    fake_probability:         isText ? null : (entity.fake_probability || null),
    misinformation_risk:    (entity.misinformation_risk || entity.risk_level || null),
    credibility_score:      entity.credibility_score  || null,
    forensic_findings:      entity.explanation || entity.forensic_explanation || [],
    ai_summary:             entity.ai_summary  || null,
    key_claims:             entity.key_claims  || [],
    trust_score_delta:      entity.trust_score_delta  || null,
    detected_at:            entity.detected_at || null
  };
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'ev:legal-generate', payload: payload }, '*');
  }
}

/** Populate the draft textarea and show the draft area. */
function _legalShowResult(result) {
  var btn    = document.getElementById('legal-gen-btn');
  var status = document.getElementById('legal-gen-status');
  var wrap   = document.getElementById('legal-draft-wrap');
  var ta     = document.getElementById('legal-draft-ta');

  if (btn) {
    btn.disabled = false;
    btn.classList.remove('generating');
  }

  if (result.error) {
    if (status) { status.textContent = 'Error: ' + result.error; status.style.color = '#ff6b6b'; }
    return;
  }

  if (status) { status.textContent = 'Draft ready — review and edit before use.'; status.style.color = '#4ade80'; }

  var draft = result.complaint_draft || '';
  if (ta) ta.value = draft;

  /* Attach evidence JSON to button dataset for export */
  var jsonBtn = document.getElementById('legal-export-json-btn');
  if (jsonBtn && result.evidence_summary) {
    jsonBtn.dataset.evidenceJson = JSON.stringify(result.evidence_summary, null, 2);
  }

  if (wrap) wrap.classList.add('visible');
}

/* ── Event wiring ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  // Back button — notify parent
  document.getElementById('back-btn').addEventListener('click', function () {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ev:close' }, '*');
    }
  });

  // Export Evidence button — toggle dropdown
  document.getElementById('export-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    var dd = document.getElementById('export-dd');
    if (dd) dd.classList.toggle('open');
  });

  // Close dropdown on any outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#export-wrap')) {
      var dd = document.getElementById('export-dd');
      if (dd) dd.classList.remove('open');
    }
  });

  // Listen for entity data + legal results from parent
  window.addEventListener('message', function (evt) {
    if (!evt.data) return;
    if (evt.data.type === 'ev:load') {
      renderInvestigation(evt.data.entity);
    }
    if (evt.data.type === 'ev:legal-result') {
      _legalShowResult(evt.data.result || { error: 'No result received.' });
    }
    if (evt.data.type === 'ev:legal-chat-result') {
      /* AI response for a legal awareness chat query */
      _legalChatHandleResult(evt.data.result || { error: 'No result received.' });
    }
    if (evt.data.type === 'ev:legal-chat-history-result') {
      /* Persistent chat history loaded from SQLite — read-only display */
      _legalChatLoadHistory(evt.data.history || []);
    }
    if (evt.data.type === 'ev:export-pdf-result') {
      var exportBtn = document.getElementById('export-btn');
      if (!exportBtn) return;
      exportBtn.disabled = false;
      var result = evt.data.result || {};
      if (result.success) {
        _flashBtn(exportBtn, '&#x2714; PDF Saved', 2800, '&#x2913; Export Evidence');
      } else if (result.canceled || result.cancelled) {
        /* user dismissed the save dialog — silently restore button */
        exportBtn.innerHTML = '&#x2913; Export Evidence';
        exportBtn.classList.remove('success');
      } else {
        var errShort = String(result.error || 'Export failed').substring(0, 22);
        _flashBtn(exportBtn, '&#x26A0; ' + errShort, 3500, '&#x2913; Export Evidence');
      }
    }
  });

  // Enter key sends legal chat message (delegated — input may not exist at DOMContentLoaded time)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && document.activeElement && document.activeElement.id === 'legal-chat-input') {
      e.preventDefault();
      _legalChatSend();
    }
  });

  // Notify parent that entity-view is ready to receive data
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'ev:ready' }, '*');
  }
});

// Delegated events on dynamically created elements
document.addEventListener('click', function (evt) {
  var t = evt.target;

  /* ── Export PDF (via main-process IPC) ── */
  if (t && t.id === 'export-pdf-btn') {
    evt.preventDefault();
    var dd0 = document.getElementById('export-dd');
    if (dd0) dd0.classList.remove('open');
    if (!_entity) return;
    var exportBtnPdf = document.getElementById('export-btn');
    if (exportBtnPdf) {
      exportBtnPdf.disabled = true;
      exportBtnPdf.innerHTML = '&#x23F3; Generating&hellip;';
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ev:export-pdf', payload: _buildExportPayload(_entity) }, '*');
    }
  }

  /* ── Export JSON (renderer-only, no IPC needed) ── */
  if (t && t.id === 'export-json-btn') {
    evt.preventDefault();
    var dd1 = document.getElementById('export-dd');
    if (dd1) dd1.classList.remove('open');
    if (!_entity) return;
    var jsonPayload = _buildExportPayload(_entity);
    _downloadText(
      JSON.stringify(jsonPayload, null, 2),
      'entity-x-evidence-' + (_entity.entity_id || 'report') + '-' + _safeFilename() + '.json',
      'application/json'
    );
    _flashBtn(document.getElementById('export-btn'), '&#x2714; JSON Saved', 2400, '&#x2913; Export Evidence');
  }

  /* ── Legacy copy button (forensic report) ── */
  if (t && t.id === 'copy-report-btn') {
    evt.preventDefault();
    copyReport();
  }

  /* ── Legacy toggle preview ── */
  if (t && t.id === 'toggle-report-btn') {
    evt.preventDefault();
    var preview = document.getElementById('legal-report-preview');
    if (preview) {
      var visible = preview.classList.toggle('visible');
      t.textContent = visible ? 'Hide Report Preview' : 'Show Report Preview';
    }
  }

  /* ── Legal Complaint: Generate button ── */
  if (t && t.id === 'legal-gen-btn') {
    evt.preventDefault();
    if (!_entity) return;
    t.disabled = true;
    t.classList.add('generating');
    var st = document.getElementById('legal-gen-status');
    if (st) { st.textContent = 'Generating draft…'; st.style.color = '#4facfe'; }
    _legalGenerate(_entity);
  }

  /* ── Legal Awareness Chat: Send button ── */
  if (t && t.id === 'legal-chat-send-btn') {
    evt.preventDefault();
    _legalChatSend();
  }

  /* ── Legal Complaint: Copy draft text ── */
  if (t && t.id === 'legal-copy-draft-btn') {
    evt.preventDefault();
    var ta = document.getElementById('legal-draft-ta');
    var text = ta ? ta.value : '';
    if (!text) return;
    _copyText(text, t, '&#x1F4CB; Copy Text', '&#x2714; Copied!');
  }

  /* ── Legal Complaint: Export .TXT ── */
  if (t && t.id === 'legal-export-txt-btn') {
    evt.preventDefault();
    var ta2 = document.getElementById('legal-draft-ta');
    var txt = ta2 ? ta2.value : '';
    if (!txt) return;
    _downloadText(txt, 'entity-x-complaint-' + _safeFilename() + '.txt', 'text/plain');
    _flashBtn(t, '&#x2714; Saved', 1800);
  }

  /* ── Legal Complaint: Export .JSON ── */
  if (t && t.id === 'legal-export-json-btn') {
    evt.preventDefault();
    var ta3 = document.getElementById('legal-draft-ta');
    var evidenceJson = t.dataset.evidenceJson || null;
    var exportObj = {
      complaint_draft:  ta3 ? ta3.value : '',
      evidence_summary: evidenceJson ? JSON.parse(evidenceJson) : {},
      exported_at:      new Date().toISOString(),
      disclaimer:       'NOT LEGAL ADVICE — probabilistic analysis output only. Review before use.'
    };
    _downloadText(JSON.stringify(exportObj, null, 2), 'entity-x-complaint-' + _safeFilename() + '.json', 'application/json');
    _flashBtn(t, '&#x2714; Saved', 1800);
  }

  /* ── Open source URL ── */
  if (t && t.id === 'open-src-btn') {
    evt.preventDefault();
    if (_entity && _entity.url && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'ev:open-url', url: _entity.url }, '*');
    }
  }
});

/* ── Copy / export helpers ─────────────────────────────────────────────────── */

/**
 * Build the canonical export payload from a live entity object.
 * Used by both PDF (IPC) and JSON (renderer) exports.
 */
function _buildExportPayload(entity) {
  var isText = entity.entity_type === 'TEXT';
  return {
    entity_id:                 entity.entity_id || 'N/A',
    entity_type:               entity.entity_type || 'UNKNOWN',
    content_title:             entity.content_title || (isText ? 'Text Entity' : 'Image Entity'),
    source_url:                isText ? (entity.url || 'N/A') : (entity.image_url || 'N/A'),
    image_url:                 entity.image_url || null,   // explicit — used for thumbnail embedding
    word_count:                entity.word_count || null,  // TEXT: word count from extraction
    detected_at:               entity.detected_at || null,
    analyzed_at:               entity.analyzed_at || null,
    risk_level:                isText ? (entity.misinformation_risk || 'LOW') : (entity.risk_level || 'LOW'),
    ai_generated_probability:  entity.ai_generated_probability || 0,
    fake_probability:          entity.fake_probability || 0,
    credibility_score:         entity.credibility_score || 0,
    trust_score:               entity.trust_score || 100,
    trust_score_delta:         entity.trust_score_delta || 0,
    forensic_explanation:      entity.forensic_explanation || entity.explanation || [],
    ai_summary:                entity.ai_summary || null,
    key_claims:                entity.key_claims || [],
    topic:                     entity.topic || null,
    session_id:                entity.session_id || null,
    exported_at:               new Date().toISOString(),
    disclaimer: 'NOT LEGAL ADVICE — Automated probabilistic analysis from Entity X. '
      + 'All scores are AI/ML estimates. Not a legal filing or formal complaint. '
      + 'Consult a qualified legal professional before taking formal action.'
  };
}

function _safeFilename() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function _downloadText(content, filename, mime) {
  var blob = new Blob([content], { type: mime });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(a); }, 1000);
}

function _copyText(text, btn, origHtml, successHtml) {
  var done = function() { _flashBtn(btn, successHtml, 2200, origHtml); };
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(function () { _fallbackCopy(text); done(); });
    } else {
      _fallbackCopy(text);
      done();
    }
  } catch (e) {
    _fallbackCopy(text);
    done();
  }
}

function _flashBtn(btn, html, duration, restoreHtml) {
  var orig = restoreHtml || btn.innerHTML;
  btn.innerHTML = html;
  btn.classList.add('success');
  setTimeout(function () {
    btn.innerHTML = orig;
    btn.classList.remove('success');
  }, duration || 2000);
}

function copyReport() {
  var preview = document.getElementById('legal-report-preview');
  if (!preview) return;
  var text = preview.textContent;
  if (!text) return;
  try {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { showCopied(); }).catch(function () { _fallbackCopy(text); showCopied(); });
    } else {
      _fallbackCopy(text);
      showCopied();
    }
  } catch (e) {
    _fallbackCopy(text);
    showCopied();
  }
}

function _fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* silent */ }
  document.body.removeChild(ta);
}

/* Keep backward-compat alias */
function fallbackCopy(text) { _fallbackCopy(text); }

function showCopied() {
  var btn = document.getElementById('copy-report-btn');
  if (!btn) return;
  var orig = btn.textContent;
  btn.textContent = '✓ Copied to clipboard';
  btn.style.color = '#4ade80';
  setTimeout(function () {
    btn.textContent = orig;
    btn.style.color = '';
  }, 2200);
}

