'use strict';

/**
 * dashboard.js — Entity X Dashboard
 * Displays analytics, protected persons, and impersonation alerts.
 * 
 * Communicates via postMessage with parent window:
 *   → parent: { type: 'dash:fetch-history' }  - Request detection history
 *   → parent: { type: 'dash:fetch-persons' }  - Request protected persons
 *   → parent: { type: 'dash:fetch-alerts' }   - Request impersonation alerts
 *   → parent: { type: 'dash:add-person', name, category }
 *   → parent: { type: 'dash:update-alert', alertId, status }
 *   → parent: { type: 'dash:close' }
 *   ← parent: { type: 'dash:history-data', records }
 *   ← parent: { type: 'dash:persons-data', persons }
 *   ← parent: { type: 'dash:alerts-data', alerts, stats }
 *   ← parent: { type: 'dash:face-status', available, backend }
 */

const API_BASE = 'http://127.0.0.1:8000/api';

// ─── State ───
let historyData = [];
let personsData = [];
let alertsData = [];
let alertStats = {};
let currentPersonTab = 'all';
let currentAlertTab = 'pending';

// ─── Charts ───
let timelineChart = null;
let riskChart = null;
let typeChart = null;
let alertChart = null;

// ─── DOM ───
const backBtn = document.getElementById('back-btn');
const refreshBtn = document.getElementById('refresh-btn');
const faceStatus = document.getElementById('face-status');
const faceStatusText = document.getElementById('face-status-text');
const personList = document.getElementById('person-list');
const alertList = document.getElementById('alert-list');
const addNameInput = document.getElementById('add-name');
const addCategorySelect = document.getElementById('add-category');
const addPersonBtn = document.getElementById('add-person-btn');

// Stats elements
const statTotal = document.getElementById('stat-total');
const statHigh = document.getElementById('stat-high');
const statMedium = document.getElementById('stat-medium');
const statLow = document.getElementById('stat-low');
const statPersons = document.getElementById('stat-persons');
const statAlerts = document.getElementById('stat-alerts');

// ─── API Calls ───
async function fetchHistory() {
  try {
    const res = await fetch(`${API_BASE}/history?limit=500`);
    const data = await res.json();
    historyData = data.records || [];
    updateHistoryStats();
    renderCharts();
  } catch (err) {
    console.error('Failed to fetch history:', err);
  }
}

async function fetchPersons() {
  try {
    const res = await fetch(`${API_BASE}/persons`);
    personsData = await res.json();
    statPersons.textContent = personsData.length;
    renderPersonList();
  } catch (err) {
    console.error('Failed to fetch persons:', err);
    personList.innerHTML = '<div class="empty-list">Failed to load persons</div>';
  }
}

async function fetchAlerts() {
  try {
    const [alertsRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/alerts?limit=100`),
      fetch(`${API_BASE}/alerts/stats`)
    ]);
    alertsData = await alertsRes.json();
    alertStats = await statsRes.json();
    statAlerts.textContent = alertStats.pending_alerts || 0;
    renderAlertList();
    renderAlertChart();
  } catch (err) {
    console.error('Failed to fetch alerts:', err);
    alertList.innerHTML = '<div class="empty-list">Failed to load alerts</div>';
  }
}

async function fetchFaceStatus() {
  try {
    const res = await fetch(`${API_BASE}/face-recognizer/status`);
    const data = await res.json();
    const dot = faceStatus.querySelector('.status-dot');
    if (data.available) {
      faceStatus.className = 'status-indicator online';
      dot.className = 'status-dot online';
      faceStatusText.textContent = `Face Recognition: ${data.backend}`;
    } else {
      faceStatus.className = 'status-indicator offline';
      dot.className = 'status-dot offline';
      faceStatusText.textContent = 'Face Recognition: Unavailable';
    }
  } catch (err) {
    faceStatus.className = 'status-indicator offline';
    faceStatusText.textContent = 'API Offline';
  }
}

async function addPerson(name, category) {
  try {
    const res = await fetch(`${API_BASE}/persons/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, description: '' })
    });
    if (res.ok) {
      addNameInput.value = '';
      await fetchPersons();
    }
  } catch (err) {
    console.error('Failed to add person:', err);
  }
}

async function updateAlertStatus(alertId, status) {
  try {
    const res = await fetch(`${API_BASE}/alerts/${alertId}/status?status=${status}`, {
      method: 'PUT'
    });
    if (res.ok) {
      await fetchAlerts();
    }
  } catch (err) {
    console.error('Failed to update alert:', err);
  }
}

// ─── Stats Update ───
function updateHistoryStats() {
  const total = historyData.length;
  const high = historyData.filter(r => r.risk_level === 'HIGH').length;
  const medium = historyData.filter(r => r.risk_level === 'MEDIUM').length;
  const low = historyData.filter(r => r.risk_level === 'LOW').length;
  
  statTotal.textContent = total;
  statHigh.textContent = high;
  statMedium.textContent = medium;
  statLow.textContent = low;
}

// ─── Charts ───
function renderCharts() {
  renderTimelineChart();
  renderRiskChart();
  renderTypeChart();
}

function renderTimelineChart() {
  const ctx = document.getElementById('timeline-chart').getContext('2d');
  
  // Group by day
  const dayMap = new Map();
  historyData.forEach(r => {
    const date = new Date(r.timestamp).toLocaleDateString();
    if (!dayMap.has(date)) {
      dayMap.set(date, { total: 0, high: 0, medium: 0, low: 0 });
    }
    const d = dayMap.get(date);
    d.total++;
    if (r.risk_level === 'HIGH') d.high++;
    else if (r.risk_level === 'MEDIUM') d.medium++;
    else d.low++;
  });
  
  // Get last 14 days
  const labels = [];
  const totalData = [];
  const highData = [];
  const days = Array.from(dayMap.entries()).slice(-14);
  
  days.forEach(([date, counts]) => {
    labels.push(date);
    totalData.push(counts.total);
    highData.push(counts.high);
  });
  
  if (timelineChart) timelineChart.destroy();
  
  timelineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total',
          data: totalData,
          borderColor: '#4facfe',
          backgroundColor: 'rgba(79, 172, 254, 0.1)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'High Risk',
          data: highData,
          borderColor: '#ff6b6b',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#4a6a85', font: { size: 10 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#2d4a62', font: { size: 9 } },
          grid: { color: 'rgba(42, 77, 98, 0.2)' }
        },
        y: {
          ticks: { color: '#2d4a62', font: { size: 9 } },
          grid: { color: 'rgba(42, 77, 98, 0.2)' }
        }
      }
    }
  });
}

function renderRiskChart() {
  const ctx = document.getElementById('risk-chart').getContext('2d');
  
  const high = historyData.filter(r => r.risk_level === 'HIGH').length;
  const medium = historyData.filter(r => r.risk_level === 'MEDIUM').length;
  const low = historyData.filter(r => r.risk_level === 'LOW').length;
  
  if (riskChart) riskChart.destroy();
  
  riskChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['High Risk', 'Medium Risk', 'Low Risk'],
      datasets: [{
        data: [high, medium, low],
        backgroundColor: [
          'rgba(255, 107, 107, 0.8)',
          'rgba(251, 191, 36, 0.8)',
          'rgba(74, 222, 128, 0.8)'
        ],
        borderColor: [
          'rgba(255, 107, 107, 1)',
          'rgba(251, 191, 36, 1)',
          'rgba(74, 222, 128, 1)'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#4a6a85', font: { size: 10 } }
        }
      }
    }
  });
}

function renderTypeChart() {
  const ctx = document.getElementById('type-chart').getContext('2d');
  
  const images = historyData.filter(r => r.type === 'IMAGE').length;
  const text = historyData.filter(r => r.type === 'TEXT').length;
  const video = historyData.filter(r => r.type === 'VIDEO').length;
  const audio = historyData.filter(r => r.type === 'AUDIO').length;
  
  if (typeChart) typeChart.destroy();
  
  typeChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Image', 'Text', 'Video', 'Audio'],
      datasets: [{
        label: 'Scans',
        data: [images, text, video, audio],
        backgroundColor: [
          'rgba(79, 172, 254, 0.7)',
          'rgba(192, 132, 252, 0.7)',
          'rgba(74, 222, 128, 0.7)',
          'rgba(251, 191, 36, 0.7)'
        ],
        borderColor: [
          '#4facfe',
          '#c084fc',
          '#4ade80',
          '#fbbf24'
        ],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: '#2d4a62', font: { size: 9 } },
          grid: { display: false }
        },
        y: {
          ticks: { color: '#2d4a62', font: { size: 9 } },
          grid: { color: 'rgba(42, 77, 98, 0.2)' }
        }
      }
    }
  });
}

function renderAlertChart() {
  const ctx = document.getElementById('alert-chart').getContext('2d');
  
  const pending = alertStats.pending_alerts || 0;
  const confirmed = alertStats.confirmed_alerts || 0;
  const dismissed = alertStats.dismissed_alerts || 0;
  
  if (alertChart) alertChart.destroy();
  
  alertChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Pending', 'Confirmed', 'Dismissed'],
      datasets: [{
        data: [pending, confirmed, dismissed],
        backgroundColor: [
          'rgba(251, 191, 36, 0.8)',
          'rgba(255, 107, 107, 0.8)',
          'rgba(74, 222, 128, 0.8)'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#4a6a85', font: { size: 10 } }
        }
      }
    }
  });
}

// ─── Person List ───
function renderPersonList() {
  const filtered = currentPersonTab === 'all'
    ? personsData
    : personsData.filter(p => p.category === currentPersonTab);
  
  if (filtered.length === 0) {
    personList.innerHTML = '<div class="empty-list">No protected persons registered</div>';
    return;
  }
  
  personList.innerHTML = filtered.map(p => {
    const initials = p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const badgeClass = p.category === 'client' ? 'person-badge client' : 'person-badge';
    return `
      <div class="person-item" data-id="${p.person_id}">
        <div class="person-avatar">${initials}</div>
        <div class="person-info">
          <div class="person-name">${escHtml(p.name)}</div>
          <div class="person-meta">${p.embeddings_count} embeddings · ${p.category}</div>
        </div>
        <div class="${badgeClass}">${p.category}</div>
      </div>
    `;
  }).join('');
}

// ─── Alert List ───
function renderAlertList() {
  let filtered = alertsData;
  if (currentAlertTab === 'pending') {
    filtered = alertsData.filter(a => a.status === 'pending');
  } else if (currentAlertTab === 'confirmed') {
    filtered = alertsData.filter(a => a.status === 'confirmed');
  }
  
  if (filtered.length === 0) {
    alertList.innerHTML = '<div class="empty-list">No alerts</div>';
    return;
  }
  
  alertList.innerHTML = filtered.map(a => {
    const time = new Date(a.created_at).toLocaleString();
    const similarity = (a.similarity_score * 100).toFixed(1);
    const showActions = a.status === 'pending';
    
    return `
      <div class="alert-item ${a.status}" data-id="${a.alert_id}">
        <div class="alert-header">
          <div class="alert-person">${escHtml(a.person_name)}</div>
          <div class="alert-time">${time}</div>
        </div>
        <div class="alert-url">
          <a href="${escHtml(a.content_url)}" title="${escHtml(a.content_url)}">${truncateUrl(a.content_url)}</a>
        </div>
        <div class="alert-footer">
          <div class="alert-similarity">${similarity}% match · ${a.content_type}</div>
          ${showActions ? `
            <div class="alert-actions">
              <button class="alert-btn confirm" data-action="confirmed">Confirm</button>
              <button class="alert-btn dismiss" data-action="dismissed">Dismiss</button>
            </div>
          ` : `
            <span class="alert-status-badge ${a.status}">${a.status}</span>
          `}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Helpers ───
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncateUrl(url) {
  if (!url) return '—';
  return url.length > 50 ? url.slice(0, 47) + '...' : url;
}

function toParent(msg) {
  window.parent.postMessage(msg, '*');
}

// ─── Event Handlers ───
backBtn.addEventListener('click', () => {
  toParent({ type: 'dash:close' });
});

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '⟳ Loading...';
  await Promise.all([fetchHistory(), fetchPersons(), fetchAlerts(), fetchFaceStatus()]);
  refreshBtn.disabled = false;
  refreshBtn.textContent = '⟳ Refresh';
});

addPersonBtn.addEventListener('click', async () => {
  const name = addNameInput.value.trim();
  const category = addCategorySelect.value;
  if (name) {
    await addPerson(name, category);
  }
});

addNameInput.addEventListener('keypress', async (e) => {
  if (e.key === 'Enter') {
    const name = addNameInput.value.trim();
    const category = addCategorySelect.value;
    if (name) {
      await addPerson(name, category);
    }
  }
});

// Person tabs
document.querySelectorAll('.card:has(#person-list) .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.card:has(#person-list) .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentPersonTab = tab.dataset.tab;
    renderPersonList();
  });
});

// Alert tabs
document.querySelectorAll('.card:has(#alert-list) .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.card:has(#alert-list) .tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentAlertTab = tab.dataset.tab;
    renderAlertList();
  });
});

// Alert actions (delegation)
alertList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.alert-btn');
  if (btn) {
    const alertItem = btn.closest('.alert-item');
    const alertId = alertItem.dataset.id;
    const action = btn.dataset.action;
    await updateAlertStatus(alertId, action);
  }
});

// ─── Initialize ───
async function init() {
  await Promise.all([
    fetchHistory(),
    fetchPersons(),
    fetchAlerts(),
    fetchFaceStatus()
  ]);
}

init();
