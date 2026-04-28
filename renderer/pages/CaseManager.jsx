import { useState, useEffect, useCallback } from 'react';
import { Briefcase, Plus, Trash2, FileText, Shield, Clock, Download, Hash } from 'lucide-react';

const STATUS_COLOR = { open: '#8b5cf6', closed: '#34d399', archived: '#64748b' };

export default function CaseManager() {
  const [cases, setCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newCase, setNewCase] = useState({ title: '', description: '' });
  const [addEvidenceOpen, setAddEvidenceOpen] = useState(false);
  const [newEvidence, setNewEvidence] = useState({ source_url: '', detection_type: 'IMAGE', risk_level: 'HIGH', fake_probability: 0.85, note: '' });
  const [exportMsg, setExportMsg] = useState('');
  const [history, setHistory] = useState([]);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/cases');
      const data = await res.json();
      setCases(data.cases || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  const loadEvidence = useCallback(async (caseId) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/cases/${caseId}/evidence`);
      const data = await res.json();
      setEvidence(data.evidence || []);
    } catch (e) { console.error(e); }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await window.entityX.getHistory({ limit: 50 });
      setHistory((data?.records || []).slice(0, 50));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { loadCases(); loadHistory(); }, []);
  useEffect(() => { if (selectedCase) loadEvidence(selectedCase.id); }, [selectedCase]);

  const createCase = async () => {
    if (!newCase.title.trim()) return;
    try {
      const res = await fetch('http://127.0.0.1:8000/api/cases', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newCase),
      });
      const created = await res.json();
      setCreating(false);
      setNewCase({ title: '', description: '' });
      await loadCases();
      setSelectedCase(created);
    } catch (e) { console.error(e); }
  };

  const deleteCase = async (caseId, e) => {
    e.stopPropagation();
    await fetch(`http://127.0.0.1:8000/api/cases/${caseId}`, { method: 'DELETE' });
    if (selectedCase?.id === caseId) setSelectedCase(null);
    await loadCases();
  };

  const updateStatus = async (status) => {
    if (!selectedCase) return;
    await fetch(`http://127.0.0.1:8000/api/cases/${selectedCase.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    });
    setSelectedCase({ ...selectedCase, status });
    await loadCases();
  };

  const addEvidence = async () => {
    if (!selectedCase || !newEvidence.source_url.trim()) return;
    await fetch(`http://127.0.0.1:8000/api/cases/${selectedCase.id}/evidence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newEvidence),
    });
    setAddEvidenceOpen(false);
    setNewEvidence({ source_url: '', detection_type: 'IMAGE', risk_level: 'HIGH', fake_probability: 0.85, note: '' });
    await loadEvidence(selectedCase.id);
  };

  const addFromHistory = async (item) => {
    if (!selectedCase) return;
    await fetch(`http://127.0.0.1:8000/api/cases/${selectedCase.id}/evidence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: item.entity_id, detection_type: item.type, source_url: item.source_url, risk_level: item.risk_level, fake_probability: item.fake_probability, note: 'Added from audit history' }),
    });
    await loadEvidence(selectedCase.id);
  };

  const exportEDRM = async () => {
    if (!selectedCase) return;
    setExportMsg('Generating EDRM export...');
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/cases/${selectedCase.id}/export/edrm`);
      const xml = await res.text();
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `case_${selectedCase.id}.xml`; a.click();
      URL.revokeObjectURL(url);
      setExportMsg('EDRM export downloaded.');
    } catch { setExportMsg('Export failed.'); }
    setTimeout(() => setExportMsg(''), 3000);
  };

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', minHeight: 0 }}>
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase size={18} color="#8b5cf6" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Case Manager</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Legal & Enterprise</div>
            </div>
          </div>
          <button onClick={() => setCreating(true)} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#a78bfa', fontSize: 12 }}>
            <Plus size={14} /> New
          </button>
        </div>

        {creating && (
          <div style={{ background: 'var(--card)', borderRadius: 12, padding: 16, border: '1px solid rgba(139,92,246,0.3)' }}>
            <input placeholder="Case title" value={newCase.title} onChange={e => setNewCase({ ...newCase, title: e.target.value })}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }} />
            <textarea placeholder="Description (optional)" value={newCase.description} onChange={e => setNewCase({ ...newCase, description: e.target.value })} rows={2}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, resize: 'none', marginBottom: 8, boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={createCase} style={{ flex: 1, background: '#8b5cf6', border: 'none', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Create</button>
              <button onClick={() => setCreating(false)} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: 20 }}>Loading...</div>}
          {!loading && cases.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <Briefcase size={32} color="#334155" style={{ marginBottom: 12 }} />
              <div style={{ color: '#475569', fontSize: 13 }}>No cases yet. Create your first investigation case.</div>
            </div>
          )}
          {cases.map(c => (
            <div key={c.id} onClick={() => setSelectedCase(c)}
              style={{ background: selectedCase?.id === c.id ? 'rgba(139,92,246,0.1)' : 'var(--card)', border: `1px solid ${selectedCase?.id === c.id ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_COLOR[c.status] || '#64748b', textTransform: 'uppercase' }}>{c.status}</span>
                  <span style={{ fontSize: 10, color: '#475569' }}>{c.evidence_count || 0} items</span>
                </div>
              </div>
              <button onClick={(e) => deleteCase(c.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#475569', marginLeft: 8 }}><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      </div>

      {!selectedCase ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Briefcase size={28} color="#334155" /></div>
          <div style={{ color: '#475569', fontSize: 14, textAlign: 'center' }}>Select a case to view details<br />or create a new case</div>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9', marginBottom: 4 }}>{selectedCase.title}</div>
                {selectedCase.description && <div style={{ color: '#64748b', fontSize: 13 }}>{selectedCase.description}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {['open', 'closed'].map(s => (
                  <button key={s} onClick={() => updateStatus(s)}
                    style={{ padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', border: `1px solid ${selectedCase.status === s ? STATUS_COLOR[s] : 'var(--border)'}`, background: selectedCase.status === s ? `${STATUS_COLOR[s]}22` : 'transparent', color: selectedCase.status === s ? STATUS_COLOR[s] : '#64748b' }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 24, fontSize: 12, color: '#475569' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={12} /> {fmt(selectedCase.created_at)}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Hash size={12} /> {selectedCase.id}</span>
              {selectedCase.signature && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Shield size={12} /> Signed</span>}
            </div>
            {exportMsg && <div style={{ marginTop: 10, fontSize: 12, color: '#a78bfa' }}>{exportMsg}</div>}
          </div>

          {selectedCase.signature && (
            <div style={{ background: 'rgba(139,92,246,0.05)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Shield size={14} color="#8b5cf6" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600, marginBottom: 2 }}>CHAIN OF CUSTODY — CRYPTOGRAPHIC SIGNATURE</div>
                <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedCase.signature}</div>
              </div>
            </div>
          )}

          <div style={{ flex: 1, background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Evidence ({evidence.length})</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setAddEvidenceOpen(!addEvidenceOpen)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 8, padding: '6px 12px', color: '#a78bfa', fontSize: 12, cursor: 'pointer' }}>
                  <Plus size={13} /> Add
                </button>
                <button onClick={exportEDRM}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 8, padding: '6px 12px', color: '#34d399', fontSize: 12, cursor: 'pointer' }}>
                  <Download size={13} /> EDRM
                </button>
              </div>
            </div>

            {addEvidenceOpen && (
              <div style={{ background: 'var(--surface)', borderRadius: 10, padding: 16, border: '1px solid rgba(139,92,246,0.25)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input placeholder="Source URL" value={newEvidence.source_url} onChange={e => setNewEvidence({ ...newEvidence, source_url: e.target.value })}
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, boxSizing: 'border-box', width: '100%' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={newEvidence.detection_type} onChange={e => setNewEvidence({ ...newEvidence, detection_type: e.target.value })}
                    style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13 }}>
                    {['IMAGE','TEXT','VIDEO','AUDIO'].map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select value={newEvidence.risk_level} onChange={e => setNewEvidence({ ...newEvidence, risk_level: e.target.value })}
                    style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13 }}>
                    {['HIGH','MEDIUM','LOW'].map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <input placeholder="Note (optional)" value={newEvidence.note} onChange={e => setNewEvidence({ ...newEvidence, note: e.target.value })}
                  style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: '#f1f5f9', fontSize: 13, boxSizing: 'border-box', width: '100%' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={addEvidence} style={{ flex: 1, background: '#8b5cf6', border: 'none', borderRadius: 8, padding: 8, color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                  <button onClick={() => setAddEvidenceOpen(false)} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                </div>
                {history.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Add from Detection History</div>
                    <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {history.map((item, i) => (
                        <div key={i} onClick={() => addFromHistory(item)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', cursor: 'pointer', border: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: riskColor(item.risk_level), minWidth: 36 }}>{item.risk_level}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.source_url || item.title || 'Unknown'}</span>
                          <Plus size={12} color="#8b5cf6" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {evidence.length === 0 && !addEvidenceOpen && (
              <div style={{ textAlign: 'center', padding: '30px 0', color: '#475569', fontSize: 13 }}>No evidence yet. Click Add to link detections.</div>
            )}

            {evidence.map((ev, i) => (
              <div key={i} style={{ background: 'var(--surface)', borderRadius: 10, padding: '12px 16px', border: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `${riskColor(ev.risk_level)}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FileText size={16} color={riskColor(ev.risk_level)} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: riskColor(ev.risk_level) }}>{ev.risk_level}</span>
                    <span style={{ fontSize: 11, color: '#64748b' }}>{ev.detection_type}</span>
                    <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>{fmt(ev.added_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.source_url || '—'}</div>
                  {ev.note && <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>{ev.note}</div>}
                  <div style={{ fontSize: 10, color: '#334155', fontFamily: 'monospace', marginTop: 4 }}>SHA-256: {ev.content_hash}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
