import { useState, useEffect, useCallback } from 'react';
import { Globe, AlertTriangle, Shield, BarChart2, Clock, RefreshCw } from 'lucide-react';

export default function ThreatMap() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/threat-map');
      setData(await res.json());
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, []);

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';
  const fmt = (ts) => ts ? new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';

  const filteredDomains = (data?.domains || []).filter(d => {
    if (filter === 'high') return d.high > 0;
    if (filter === 'image') return d.types?.IMAGE > 0;
    if (filter === 'text') return d.types?.TEXT > 0;
    return true;
  });

  const totalDetections = (data?.domains || []).reduce((s, d) => s + d.total, 0);
  const totalHigh = (data?.domains || []).reduce((s, d) => s + (d.high || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Globe size={20} color="#8b5cf6" /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>Threat Intelligence Map</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Domain reputation based on your scan history</div>
          </div>
        </div>
        <button onClick={loadData} disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Domains Tracked', value: filteredDomains.length, icon: Globe, color: '#8b5cf6' },
          { label: 'Total Detections', value: totalDetections, icon: BarChart2, color: '#22d3ee' },
          { label: 'High Risk', value: totalHigh, icon: AlertTriangle, color: '#f87171' },
          { label: 'Community Hashes', value: data?.community_hashes || 0, icon: Shield, color: '#34d399' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'var(--card)', borderRadius: 12, padding: 18, border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${s.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><s.icon size={13} color={s.color} /></div>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9' }}>{s.value?.toLocaleString() || '0'}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 2, background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Domain Leaderboard</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['all','All'],['high','High Risk'],['image','Images'],['text','Text']].map(([f, l]) => (
                <button key={f} onClick={() => setFilter(f)}
                  style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, cursor: 'pointer', border: `1px solid ${filter === f ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`, background: filter === f ? 'rgba(139,92,246,0.12)' : 'transparent', color: filter === f ? '#a78bfa' : '#64748b', fontWeight: filter === f ? 700 : 400 }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>Loading threat data...</div>
          ) : filteredDomains.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Globe size={32} color="#334155" style={{ marginBottom: 12 }} />
              <div style={{ color: '#475569', fontSize: 13 }}>No domains tracked yet.<br />Browse with Live Monitor active to populate this map.</div>
            </div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px 80px', gap: 12, padding: '8px 12px', fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                <span>Domain</span>
                <span style={{ textAlign: 'center' }}>HIGH</span>
                <span style={{ textAlign: 'center' }}>MED</span>
                <span style={{ textAlign: 'center' }}>TOTAL</span>
                <span style={{ textAlign: 'right' }}>AVG PROB</span>
              </div>
              {filteredDomains.map((d, i) => {
                const maxRisk = d.high > 0 ? 'HIGH' : d.medium > 0 ? 'MEDIUM' : 'LOW';
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 60px 80px', gap: 12, padding: '10px 12px', borderRadius: 8, marginBottom: 4, background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: riskColor(maxRisk), flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.domain}</span>
                    </div>
                    <span style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: d.high > 0 ? '#f87171' : '#334155' }}>{d.high || 0}</span>
                    <span style={{ textAlign: 'center', fontSize: 12, color: d.medium > 0 ? '#fbbf24' : '#334155' }}>{d.medium || 0}</span>
                    <span style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>{d.total}</span>
                    <span style={{ textAlign: 'right', fontSize: 12, color: d.avg_prob > 0.6 ? '#f87171' : '#94a3b8' }}>{((d.avg_prob || 0) * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ flex: 1, background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Clock size={15} color="#8b5cf6" />
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Recent Threats</div>
          </div>
          {(data?.timeline || []).length === 0 ? (
            <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>No threat history yet</div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(data?.timeline || []).map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: riskColor(t.risk_level), flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: riskColor(t.risk_level), minWidth: 40 }}>{t.risk_level}</span>
                  <span style={{ fontSize: 11, color: '#64748b', minWidth: 40 }}>{t.type}</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{fmt(t.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
