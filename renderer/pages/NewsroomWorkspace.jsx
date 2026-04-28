import { useState, useEffect, useCallback } from 'react';
import { Newspaper, Plus, Trash2, FolderOpen, Globe, FileText, Download, Shield } from 'lucide-react';

export default function NewsroomWorkspace() {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWs, setSelectedWs] = useState(null);
  const [wsCases, setWsCases] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newWs, setNewWs] = useState({ name: '', description: '' });
  const [verifyUrl, setVerifyUrl] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/newsroom/workspaces');
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  const loadWsCases = useCallback(async (wsId) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/cases?workspace_id=${wsId}`);
      const data = await res.json();
      setWsCases(data.cases || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadWorkspaces(); }, []);
  useEffect(() => { if (selectedWs) loadWsCases(selectedWs.id); }, [selectedWs]);

  const createWorkspace = async () => {
    if (!newWs.name.trim()) return;
    const res = await fetch('http://127.0.0.1:8000/api/newsroom/workspaces', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newWs),
    });
    const created = await res.json();
    setCreating(false);
    setNewWs({ name: '', description: '' });
    await loadWorkspaces();
    setSelectedWs(created);
  };

  const deleteWorkspace = async (id, e) => {
    e.stopPropagation();
    await fetch(`http://127.0.0.1:8000/api/newsroom/workspaces/${id}`, { method: 'DELETE' });
    if (selectedWs?.id === id) setSelectedWs(null);
    await loadWorkspaces();
  };

  const verifySource = async () => {
    if (!verifyUrl.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Analysis timed out after 60s. Try a shorter article or check your connection.')), 60000)
      );
      const res = await Promise.race([window.entityX.analyzeUrl(verifyUrl), timeout]);
      // analyzeUrl returns { success, entity } — unwrap for display
      if (res?.success && res?.entity) {
        setVerifyResult(res.entity);
      } else {
        setVerifyResult({ error: res?.error || 'Could not extract article content. The page may require a login or paywall.' });
      }
    } catch (e) {
      setVerifyResult({ error: e.message || 'Failed to analyze URL' });
    } finally {
      setVerifying(false);
    }
  };

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString() : '—';

  const cmsPlugins = [
    { name: 'WordPress Plugin', desc: 'Adds Entity X verification badge to posts', icon: '📝', lang: 'PHP' },
    { name: 'Ghost Integration', desc: 'Webhook-based content scanning on publish', icon: '👻', lang: 'JS' },
    { name: 'Strapi Plugin', desc: 'Scan content before it goes live', icon: '🚀', lang: 'JS' },
  ];

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
      <div style={{ width: 280, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Newspaper size={18} color="#8b5cf6" /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Newsroom</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Journalist Mode</div>
            </div>
          </div>
          <button onClick={() => setCreating(true)} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: '#a78bfa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={14} /> New
          </button>
        </div>

        {creating && (
          <div style={{ background: 'var(--card)', borderRadius: 12, padding: 16, border: '1px solid rgba(139,92,246,0.3)' }}>
            <input placeholder="Workspace name" value={newWs.name} onChange={e => setNewWs({ ...newWs, name: e.target.value })}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <input placeholder="Description" value={newWs.description} onChange={e => setNewWs({ ...newWs, description: e.target.value })}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={createWorkspace} style={{ flex: 1, background: '#8b5cf6', border: 'none', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Create</button>
              <button onClick={() => setCreating(false)} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!loading && workspaces.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <Newspaper size={32} color="#334155" style={{ marginBottom: 12 }} />
              <div style={{ color: '#475569', fontSize: 13 }}>No workspaces. Create one to get started.</div>
            </div>
          )}
          {workspaces.map(ws => (
            <div key={ws.id} onClick={() => setSelectedWs(ws)}
              style={{ background: selectedWs?.id === ws.id ? 'rgba(139,92,246,0.1)' : 'var(--card)', border: `1px solid ${selectedWs?.id === ws.id ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{ws.case_count || 0} cases · {fmt(ws.created_at)}</div>
              </div>
              <button onClick={(e) => deleteWorkspace(ws.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, overflowY: 'auto' }}>
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={15} color="#8b5cf6" /></div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Source Verification</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Verify before publishing</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input placeholder="https://example.com/article-to-verify" value={verifyUrl} onChange={e => setVerifyUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && verifySource()}
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13 }} />
            <button onClick={verifySource} disabled={verifying}
              style={{ background: verifying ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: verifying ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={14} /> {verifying ? 'Checking...' : 'Verify'}
            </button>
          </div>
          {verifyResult && !verifyResult.error && (() => {
            const risk = verifyResult.risk_level || 'LOW';
            const prob = verifyResult.ai_generated_probability ?? verifyResult.fake_probability ?? 0;
            const color = riskColor(risk);
            return (
              <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, background: `${color}0f`, border: `1px solid ${color}33` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ fontWeight: 800, fontSize: 22, color, lineHeight: 1 }}>{risk}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#f1f5f9', fontWeight: 600, marginBottom: 2 }}>
                      AI Probability: {(prob * 100).toFixed(1)}%
                      {verifyResult.credibility_score != null && ` · Credibility: ${(verifyResult.credibility_score * 100).toFixed(0)}%`}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {risk === 'HIGH' ? '⚠ Do not publish without independent verification' : risk === 'MEDIUM' ? '⚡ Review claims carefully before publishing' : '✓ No strong AI signals — safe to reference'}
                    </div>
                    {verifyResult.ai_summary && (
                      <div style={{ marginTop: 8, fontSize: 12, color: '#94a3b8', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                        {verifyResult.ai_summary}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
          {verifyResult?.error && <div style={{ marginTop: 12, color: '#f87171', fontSize: 13 }}>{verifyResult.error}</div>}
        </div>

        {selectedWs && (
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <FolderOpen size={16} color="#8b5cf6" />
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>{selectedWs.name} — Cases</div>
              <span style={{ fontSize: 11, color: '#64748b' }}>{wsCases.length} cases</span>
            </div>
            {wsCases.length === 0 ? (
              <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No cases in this workspace yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {wsCases.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <FileText size={15} color="#8b5cf6" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{c.title}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{c.evidence_count || 0} evidence items · {c.status}</div>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: c.status === 'open' ? '#8b5cf6' : '#34d399', textTransform: 'uppercase' }}>{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileText size={15} color="#8b5cf6" /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>CMS Integrations</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Flag AI content before publishing</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {cmsPlugins.map((p, i) => (
              <div key={i} style={{ flex: 1, background: 'var(--surface)', borderRadius: 12, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 24 }}>{p.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{p.name}</div>
                <div style={{ fontSize: 12, color: '#64748b', flex: 1 }}>{p.desc}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: '#8b5cf6', background: 'rgba(139,92,246,0.1)', padding: '2px 8px', borderRadius: 4 }}>{p.lang}</span>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 6, padding: '4px 10px', color: '#a78bfa', fontSize: 11, cursor: 'pointer' }}>
                    <Download size={11} /> Export
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
