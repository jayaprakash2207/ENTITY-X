'use strict';

/* ═══════════════════════════════════════════════════
 * history.js — Global Entity History renderer
 * Runs inside an iframe in index.html
 * Communicates via window.postMessage protocol:
 *   ← parent: { type:'hist:data',    records:[], total:0 }
 *   → parent: { type:'hist:ready'  }
 *   → parent: { type:'hist:fetch',   filters:{} }
 *   → parent: { type:'hist:close'  }
 *   → parent: { type:'hist:open-entity', entityId }
 * ═══════════════════════════════════════════════════ */

/* ── State ── */
let _allRecords   = [];          // current result set from parent
let _sortCol      = 'timestamp';
let _sortDir      = -1;          // -1 = desc, 1 = asc
let _searchTerm   = '';

/* ── DOM ── */
const tbody       = document.getElementById('hist-tbody');
const loadingState = document.getElementById('loading-state');
const emptyState  = document.getElementById('empty-state');
const loadingDot  = document.getElementById('loading-dot');
const countChip   = document.getElementById('count-chip');
const fetchBtn    = document.getElementById('fetch-btn');
const backBtn     = document.getElementById('back-btn');
const fType       = document.getElementById('f-type');
const fRisk       = document.getElementById('f-risk');
const fSearch     = document.getElementById('f-search');
const sTot        = document.getElementById('s-total');
const sImg        = document.getElementById('s-img');
const sTxt        = document.getElementById('s-txt');
const sHi         = document.getElementById('s-hi');
const sMed        = document.getElementById('s-med');
const sLo         = document.getElementById('s-lo');

/* ── Helpers ── */
function toParent(msg) {
  window.parent.postMessage(msg, '*');
}

function setLoading(on) {
  loadingDot.style.display  = on ? 'block' : 'none';
  loadingState.style.display = on ? 'flex'  : 'none';
  if (on) tbody.innerHTML   = '';
}

function fmtTs(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtPct(v) {
  if (v == null) return '—';
  return (v * 100).toFixed(1) + '%';
}

function fmtScore(v) {
  if (v == null) return '—';
  return Number(v).toFixed(1);
}

function riskHtml(r) {
  const map = { HIGH: 'rb-high', MEDIUM: 'rb-medium', LOW: 'rb-low' };
  const cls = map[(r||'').toUpperCase()] || 'rb-low';
  return `<span class="risk-badge ${cls}">${(r||'—').toUpperCase()}</span>`;
}

function typeHtml(t) {
  const cls = (t||'').toUpperCase() === 'IMAGE' ? 'tb-img' : 'tb-txt';
  return `<span class="type-badge ${cls}">${(t||'—').toUpperCase()}</span>`;
}

/* ── Sort + filter ── */
function sortedFiltered() {
  let rows = _allRecords.slice();

  /* local search on URL */
  if (_searchTerm) {
    const q = _searchTerm.toLowerCase();
    rows = rows.filter(r => (r.source_url||'').toLowerCase().includes(q)
                         || (r.entity_id||'').toLowerCase().includes(q));
  }

  rows.sort((a, b) => {
    let av = a[_sortCol] ?? '';
    let bv = b[_sortCol] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return -1 * _sortDir;
    if (av > bv) return  1 * _sortDir;
    return 0;
  });

  return rows;
}

/* ── Render table ── */
function renderTable() {
  const rows = sortedFiltered();
  emptyState.style.display = rows.length === 0 ? 'flex' : 'none';

  tbody.innerHTML = rows.map(r => {
    const url = r.source_url || '';
    const shortUrl = url.length > 55 ? url.slice(0, 52) + '…' : url;
    return `<tr>
      <td class="td-ts">${fmtTs(r.timestamp)}</td>
      <td class="td-id">${r.entity_id || '—'}</td>
      <td>${typeHtml(r.type)}</td>
      <td>${riskHtml(r.risk_level)}</td>
      <td class="td-source" title="${escHtml(url)}">
        <a href="#" data-url="${escHtml(url)}">${escHtml(shortUrl)}</a>
      </td>
      <td class="td-num" style="color:${probColor(r.fake_probability)}">${fmtPct(r.fake_probability)}</td>
      <td class="td-num" style="color:${scoreColor(r.trust_score_after)}">${fmtScore(r.trust_score_after)}</td>
      <td><button class="inv-btn" data-eid="${escHtml(r.entity_id)}">Investigate &#x2192;</button></td>
    </tr>`;
  }).join('');
}

function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function probColor(v) {
  if (v == null) return '#2d4a62';
  if (v >= 0.7)  return '#ff6b6b';
  if (v >= 0.4)  return '#fbbf24';
  return '#4ade80';
}

function scoreColor(v) {
  if (v == null) return '#2d4a62';
  if (v >= 70)   return '#4ade80';
  if (v >= 40)   return '#fbbf24';
  return '#ff6b6b';
}

/* ── Stats ── */
function updateStats(records) {
  sTot.textContent  = records.length;
  sImg.textContent  = records.filter(r => (r.type||'').toUpperCase() === 'IMAGE').length;
  sTxt.textContent  = records.filter(r => (r.type||'').toUpperCase() === 'TEXT').length;
  sHi.textContent   = records.filter(r => (r.risk_level||'').toUpperCase() === 'HIGH').length;
  sMed.textContent  = records.filter(r => (r.risk_level||'').toUpperCase() === 'MEDIUM').length;
  sLo.textContent   = records.filter(r => (r.risk_level||'').toUpperCase() === 'LOW').length;
  countChip.textContent = `${records.length} record${records.length !== 1 ? 's' : ''}`;
}

/* ── Request data from parent ── */
function requestData() {
  setLoading(true);
  const filters = {};
  if (fType.value) filters.type = fType.value;
  if (fRisk.value) filters.risk_level = fRisk.value;
  toParent({ type: 'hist:fetch', filters });
}

/* ── Sort header click ── */
document.querySelector('thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-col]');
  if (!th) return;
  const col = th.dataset.col;
  if (_sortCol === col) {
    _sortDir *= -1;
  } else {
    _sortCol = col;
    _sortDir = col === 'timestamp' ? -1 : 1;
  }
  /* Update arrow styles */
  document.querySelectorAll('thead th[data-col]').forEach(h => {
    const arrow = h.querySelector('.sort-arrow');
    if (h.dataset.col === _sortCol) {
      h.classList.add('sorted');
      arrow.innerHTML = _sortDir === -1 ? '&#x25BC;' : '&#x25B2;';
    } else {
      h.classList.remove('sorted');
      arrow.innerHTML = '&#x25B2;';
    }
  });
  renderTable();
});

/* ── Table body event delegation ── */
tbody.addEventListener('click', e => {
  /* Investigate button */
  const btn = e.target.closest('.inv-btn');
  if (btn) {
    const eid = btn.dataset.eid;
    toParent({ type: 'hist:open-entity', entityId: eid });
    return;
  }
  /* Source URL link */
  const link = e.target.closest('a[data-url]');
  if (link) {
    e.preventDefault();
    const url = link.dataset.url;
    if (url) toParent({ type: 'hist:open-url', url });
  }
});

/* ── Filter bar events ── */
fetchBtn.addEventListener('click', () => {
  _searchTerm = fSearch.value.trim();
  requestData();
});

fSearch.addEventListener('keydown', e => {
  if (e.key === 'Enter') { _searchTerm = fSearch.value.trim(); requestData(); }
});

/* ── Back btn ── */
backBtn.addEventListener('click', () => toParent({ type: 'hist:close' }));

/* ── Parent → iframe messages ── */
window.addEventListener('message', e => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'hist:load':
      /* Parent says "show yourself, optionally with pre-set filters" */
      if (msg.filters) {
        if (msg.filters.type)       fType.value = msg.filters.type;
        if (msg.filters.risk_level) fRisk.value = msg.filters.risk_level;
      }
      requestData();
      break;

    case 'hist:data':
      setLoading(false);
      _allRecords = Array.isArray(msg.records) ? msg.records : [];
      updateStats(_allRecords);
      renderTable();
      break;
  }
});

/* ── Init ── */
toParent({ type: 'hist:ready' });
