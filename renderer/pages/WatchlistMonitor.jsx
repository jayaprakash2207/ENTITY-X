import { useState, useEffect, useCallback } from 'react';

const API = 'http://127.0.0.1:8000';

function riskColor(level) {
  return level === 'HIGH' ? '#dc2626' : level === 'MEDIUM' ? '#d97706' : '#16a34a';
}

export default function WatchlistMonitor() {
  const [items, setItems]       = useState([]);
  const [alerts, setAlerts]     = useState([]);
  const [form, setForm]         = useState({ name: '', keyword: '', url: '', watch_type: 'keyword', threshold: 0.4 });
  const [loading, setLoading]   = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState('items');

  const loadItems = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/watchlist`);
      setItems(await r.json());
    } catch { setError('Failed to load watchlist'); }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/watchlist/alerts`);
      setAlerts(await r.json());
    } catch { setError('Failed to load alerts'); }
  }, []);

  useEffect(() => { loadItems(); loadAlerts(); }, [loadItems, loadAlerts]);

  async function addItem(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/watchlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      setForm({ name: '', keyword: '', url: '', watch_type: 'keyword', threshold: 0.4 });
      await loadItems();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function deleteItem(id) {
    await fetch(`${API}/api/watchlist/${id}`, { method: 'DELETE' });
    loadItems();
  }

  async function markRead(id) {
    await fetch(`${API}/api/watchlist/alerts/${id}/read`, { method: 'PUT' });
    loadAlerts();
  }

  async function triggerScan() {
    setScanning(true);
    try {
      await fetch(`${API}/api/watchlist/scan`, { method: 'POST' });
      setTimeout(() => { loadAlerts(); setScanning(false); }, 3000);
    } catch { setScanning(false); }
  }

  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>Watchlist Monitor</h1>
          <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
            Auto-scan keywords and URLs for suspicious content every 15 minutes
          </p>
        </div>
        <button
          onClick={triggerScan}
          disabled={scanning}
          style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '8px',
                   padding: '8px 18px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
        >
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '8px',
                      padding: '10px 14px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
        {['items', 'alerts'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', cursor: 'pointer',
                     fontSize: '13px', fontWeight: 600,
                     background: tab === t ? '#7c3aed' : '#1e293b',
                     color: tab === t ? '#fff' : '#94a3b8' }}>
            {t === 'alerts' ? `Alerts${unreadCount ? ` (${unreadCount})` : ''}` : 'Watch Items'}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <>
          {/* Add form */}
          <form onSubmit={addItem} style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '13px', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px' }}>
              Add Watch Item
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. COVID misinformation"
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px',
                           padding: '8px 10px', color: '#e2e8f0', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Type</label>
                <select value={form.watch_type} onChange={e => setForm(f => ({ ...f, watch_type: e.target.value }))}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px',
                           padding: '8px 10px', color: '#e2e8f0', fontSize: '13px' }}>
                  <option value="keyword">Keyword (RSS search)</option>
                  <option value="url">URL (re-fetch & score)</option>
                </select>
              </div>
              {form.watch_type === 'keyword' ? (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Keyword</label>
                  <input value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                    placeholder="e.g. deepfake election"
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px',
                             padding: '8px 10px', color: '#e2e8f0', fontSize: '13px' }} />
                </div>
              ) : (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>URL</label>
                  <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder="https://example.com/article"
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px',
                             padding: '8px 10px', color: '#e2e8f0', fontSize: '13px' }} />
                </div>
              )}
              <div>
                <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>
                  Alert Threshold ({(form.threshold * 100).toFixed(0)}%)
                </label>
                <input type="range" min="0" max="1" step="0.05" value={form.threshold}
                  onChange={e => setForm(f => ({ ...f, threshold: parseFloat(e.target.value) }))}
                  style={{ width: '100%' }} />
              </div>
            </div>
            <button type="submit" disabled={loading || !form.name.trim()}
              style={{ marginTop: '14px', background: '#7c3aed', color: '#fff', border: 'none',
                       borderRadius: '8px', padding: '8px 20px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              {loading ? 'Adding…' : '+ Add to Watchlist'}
            </button>
          </form>

          {/* Items list */}
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#475569' }}>
              No watch items yet. Add one above.
            </div>
          ) : items.map(item => (
            <div key={item.id} style={{ background: '#1e293b', borderRadius: '8px', padding: '14px 18px',
                                        marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '14px' }}>{item.name}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                  {item.watch_type === 'keyword' ? `Keyword: "${item.keyword}"` : `URL: ${item.url}`}
                  &nbsp;·&nbsp;Threshold: {(item.threshold * 100).toFixed(0)}%
                </div>
              </div>
              <button onClick={() => deleteItem(item.id)}
                style={{ background: '#450a0a', color: '#fca5a5', border: 'none', borderRadius: '6px',
                         padding: '5px 12px', cursor: 'pointer', fontSize: '12px' }}>
                Remove
              </button>
            </div>
          ))}
        </>
      )}

      {tab === 'alerts' && (
        <>
          {alerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#475569' }}>
              No alerts yet. Run a scan or wait for the automatic 15-minute scan.
            </div>
          ) : alerts.map(alert => (
            <div key={alert.id}
              style={{ background: alert.read ? '#1e293b' : '#1e1b4b', borderRadius: '8px',
                       padding: '14px 18px', marginBottom: '10px', borderLeft: `3px solid ${riskColor(alert.risk_level)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, marginRight: '12px' }}>
                  <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '14px' }}>{alert.title}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                    Watchlist: <span style={{ color: '#a78bfa' }}>{alert.watchlist_name}</span>
                    &nbsp;·&nbsp;
                    <span style={{ color: riskColor(alert.risk_level), fontWeight: 600 }}>{alert.risk_level}</span>
                    &nbsp;·&nbsp;
                    {(alert.fake_probability * 100).toFixed(0)}% risk score
                  </div>
                  {alert.source_url && (
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px', wordBreak: 'break-all' }}>
                      {alert.source_url}
                    </div>
                  )}
                </div>
                {!alert.read && (
                  <button onClick={() => markRead(alert.id)}
                    style={{ background: '#0f172a', color: '#94a3b8', border: '1px solid #334155',
                             borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}>
                    Mark Read
                  </button>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
