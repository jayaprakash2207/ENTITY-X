import { useState, useEffect, useCallback } from 'react';
import { Database, Hash, Upload, CheckCircle, Shield, Globe, TrendingUp, AlertTriangle } from 'lucide-react';

export default function CommunityDB() {
  const [stats, setStats] = useState(null);
  const [optIn, setOptIn] = useState(true);
  const [reportHash, setReportHash] = useState('');
  const [reportType, setReportType] = useState('IMAGE');
  const [reportRisk, setReportRisk] = useState('HIGH');
  const [reportDomain, setReportDomain] = useState('');
  const [checkHash, setCheckHash] = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [reportResult, setReportResult] = useState('');
  const [checking, setChecking] = useState(false);
  const [reporting, setReporting] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/community/stats');
      setStats(await res.json());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadStats(); }, []);

  const checkHashFn = async () => {
    if (!checkHash.trim()) return;
    setChecking(true); setCheckResult(null);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/community/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: checkHash, content_type: reportType }),
      });
      setCheckResult(await res.json());
    } catch { setCheckResult({ error: 'Check failed' }); } finally { setChecking(false); }
  };

  const reportFn = async () => {
    if (!reportHash.trim()) return;
    setReporting(true); setReportResult('');
    try {
      const res = await fetch('http://127.0.0.1:8000/api/community/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: reportHash, content_type: reportType, risk_level: reportRisk, source_domain: reportDomain }),
      });
      const data = await res.json();
      setReportResult(data.status === 'added' ? '✓ Hash added to community database' : '✓ Confirmation count updated');
      await loadStats();
    } catch { setReportResult('Failed to report hash'); } finally { setReporting(false); }
    setTimeout(() => setReportResult(''), 4000);
  };

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Database size={20} color="#8b5cf6" /></div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>Community Verified Database</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Opt-in hash registry — like VirusTotal for AI content</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--card)', padding: '10px 16px', borderRadius: 10, border: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Contribute</span>
          <div onClick={() => setOptIn(!optIn)} style={{ width: 40, height: 22, borderRadius: 11, background: optIn ? '#8b5cf6' : '#334155', cursor: 'pointer', position: 'relative', transition: 'background 0.2s' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: optIn ? 20 : 2, transition: 'left 0.2s' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: optIn ? '#8b5cf6' : '#475569' }}>{optIn ? 'ON' : 'OFF'}</span>
        </div>
      </div>

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Total Hashes', value: stats.total?.toLocaleString() || '0', icon: Hash, color: '#8b5cf6' },
            { label: 'High Risk', value: stats.high_risk?.toLocaleString() || '0', icon: AlertTriangle, color: '#f87171' },
            { label: 'Image Fakes', value: (stats.by_type?.IMAGE || 0).toString(), icon: Shield, color: '#22d3ee' },
            { label: 'Top Domains', value: (stats.top_domains?.length || 0).toString(), icon: Globe, color: '#34d399' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--card)', borderRadius: 12, padding: 18, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${s.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><s.icon size={14} color={s.color} /></div>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9' }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1, background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <CheckCircle size={16} color="#8b5cf6" />
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Check Hash</div>
          </div>
          <textarea placeholder="SHA-256 hash to check against community database..." value={checkHash} onChange={e => setCheckHash(e.target.value)} rows={3}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace', resize: 'none', marginBottom: 12, boxSizing: 'border-box' }} />
          <button onClick={checkHashFn} disabled={checking}
            style={{ background: checking ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 24px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: checking ? 'not-allowed' : 'pointer' }}>
            {checking ? 'Checking...' : 'Check Database'}
          </button>
          {checkResult && (
            <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: checkResult.found ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.06)', border: `1px solid ${checkResult.found ? 'rgba(248,113,113,0.2)' : 'rgba(52,211,153,0.2)'}` }}>
              {checkResult.found ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertTriangle size={16} color="#f87171" />
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#f87171' }}>HASH FOUND</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Risk: <span style={{ color: riskColor(checkResult.record?.risk_level), fontWeight: 700 }}>{checkResult.record?.risk_level}</span> · Confirmed {checkResult.record?.confirmed_count}× · {checkResult.record?.content_type}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle size={16} color="#34d399" />
                  <span style={{ color: '#34d399', fontWeight: 600, fontSize: 13 }}>Not found — hash is clean</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Upload size={16} color="#8b5cf6" />
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Report Confirmed Fake</div>
          </div>
          <textarea placeholder="SHA-256 hash of confirmed AI-generated content..." value={reportHash} onChange={e => setReportHash(e.target.value)} rows={3}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace', resize: 'none', marginBottom: 12, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={reportType} onChange={e => setReportType(e.target.value)}
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: '#f1f5f9', fontSize: 12 }}>
              {['IMAGE','TEXT','VIDEO','AUDIO'].map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={reportRisk} onChange={e => setReportRisk(e.target.value)}
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: '#f1f5f9', fontSize: 12 }}>
              {['HIGH','MEDIUM','LOW'].map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <input placeholder="Source domain (optional)" value={reportDomain} onChange={e => setReportDomain(e.target.value)}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: '#f1f5f9', fontSize: 12, marginBottom: 12, boxSizing: 'border-box' }} />
          {!optIn && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8 }}>Enable "Contribute" toggle to submit hashes.</div>}
          <button onClick={optIn ? reportFn : undefined} disabled={reporting || !optIn}
            style={{ background: reporting || !optIn ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 24px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: reporting || !optIn ? 'not-allowed' : 'pointer' }}>
            {reporting ? 'Submitting...' : 'Submit to Community DB'}
          </button>
          {reportResult && <div style={{ marginTop: 12, fontSize: 13, color: reportResult.startsWith('✓') ? '#34d399' : '#f87171' }}>{reportResult}</div>}
        </div>
      </div>

      {stats?.top_domains?.length > 0 && (
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <TrendingUp size={16} color="#8b5cf6" />
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Top Flagged Domains</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stats.top_domains.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 12, color: '#475569', minWidth: 24, textAlign: 'right' }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, color: '#f1f5f9', fontFamily: 'monospace' }}>{d.domain}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#f87171' }}>{d.count} reports</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
