import { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, Trash2, CheckCircle, AlertTriangle, Bell, Camera, Mic, Type,
         Instagram, Youtube, Facebook, Twitter, Linkedin, Link2, Wifi, WifiOff } from 'lucide-react';

const CONTENT_TYPES = [
  { id: 'face',    label: 'Face / Image',   icon: Camera, desc: 'Protect your likeness from deepfakes', color: '#22d3ee' },
  { id: 'voice',   label: 'Voice / Audio',  icon: Mic,    desc: 'Detect voice cloning',                  color: '#a78bfa' },
  { id: 'writing', label: 'Writing Style',  icon: Type,   desc: 'Identify AI writing imitation',         color: '#34d399' },
  { id: 'general', label: 'General',        icon: Shield, desc: 'All-purpose protection',                color: '#fb923c' },
];

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: Instagram, color: '#E1306C', bg: 'rgba(225,48,108,0.1)',  placeholder: '@username or profile URL' },
  { id: 'youtube',   label: 'YouTube',   icon: Youtube,   color: '#FF0000', bg: 'rgba(255,0,0,0.08)',    placeholder: 'Channel URL or @handle'  },
  { id: 'facebook',  label: 'Facebook',  icon: Facebook,  color: '#1877F2', bg: 'rgba(24,119,242,0.1)',  placeholder: 'Profile URL or username' },
  { id: 'tiktok',    label: 'TikTok',    icon: Link2,     color: '#69C9D0', bg: 'rgba(105,201,208,0.1)', placeholder: '@username'               },
  { id: 'twitter',   label: 'X / Twitter',icon: Twitter,  color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', placeholder: '@username'               },
  { id: 'linkedin',  label: 'LinkedIn',  icon: Linkedin,  color: '#0A66C2', bg: 'rgba(10,102,194,0.1)',  placeholder: 'Profile URL'             },
];

const LS_KEY = 'entityx_social_accounts';

function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; }
}
function saveAccounts(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}

export default function CreatorShield() {
  const [profiles, setProfiles]     = useState([]);
  const [creating, setCreating]     = useState(false);
  const [newProfile, setNewProfile] = useState({ name: '', content_type: 'face', description: '' });
  const [loading, setLoading]       = useState(false);
  const [checkUrl, setCheckUrl]     = useState('');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking]     = useState(false);
  const [alerts] = useState([
    { id: 1, profile: 'Demo Profile', message: 'Potential face match detected on example.com', time: '2 hours ago', risk: 'HIGH' },
    { id: 2, profile: 'Demo Profile', message: 'Voice pattern similarity in a video',            time: '1 day ago',   risk: 'MEDIUM' },
  ]);

  // Social accounts state
  const [accounts, setAccounts]           = useState(loadAccounts);
  const [connecting, setConnecting]       = useState(null);   // platform id being connected
  const [pendingHandle, setPendingHandle] = useState('');

  const saveAndSet = (updated) => { saveAccounts(updated); setAccounts(updated); };

  const handleConnect = (platformId) => {
    if (connecting === platformId) { setConnecting(null); setPendingHandle(''); return; }
    setConnecting(platformId);
    setPendingHandle(accounts[platformId]?.handle || '');
  };

  const confirmConnect = (platformId) => {
    if (!pendingHandle.trim()) return;
    const updated = { ...accounts, [platformId]: { handle: pendingHandle.trim(), since: Date.now() } };
    saveAndSet(updated);
    setConnecting(null);
    setPendingHandle('');
  };

  const disconnectPlatform = (platformId) => {
    const updated = { ...accounts };
    delete updated[platformId];
    saveAndSet(updated);
  };

  const connectedCount = Object.keys(accounts).length;

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/creator/profiles');
      const data = await res.json();
      setProfiles(data.profiles || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadProfiles(); }, []);

  const createProfile = async () => {
    if (!newProfile.name.trim()) return;
    await fetch('http://127.0.0.1:8000/api/creator/profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newProfile),
    });
    setCreating(false);
    setNewProfile({ name: '', content_type: 'face', description: '' });
    await loadProfiles();
  };

  const deleteProfile = async (id) => {
    await fetch(`http://127.0.0.1:8000/api/creator/profiles/${id}`, { method: 'DELETE' });
    await loadProfiles();
  };

  const checkContent = async () => {
    if (!checkUrl.trim()) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await window.entityX.analyzeUrl(checkUrl);
      setCheckResult(res);
    } catch { setCheckResult({ error: 'Analysis failed' }); } finally { setChecking(false); }
  };

  const riskColor = (r) => r === 'HIGH' ? '#f87171' : r === 'MEDIUM' ? '#fbbf24' : '#34d399';
  const fmt = (ts) => ts ? new Date(ts).toLocaleDateString() : '—';

  const S = {
    card: { background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={20} color="#8b5cf6" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>Creator Shield</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Protect your identity from deepfake impersonation</div>
          </div>
        </div>
        <button onClick={() => setCreating(!creating)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={15} /> Register Profile
        </button>
      </div>

      {/* ── Social Account Connections ─────────────────────────────────── */}
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Wifi size={15} color="#34d399" />
          <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9' }}>Connected Accounts</div>
          {connectedCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(52,211,153,0.15)', color: '#34d399', padding: '2px 8px', borderRadius: 20, marginLeft: 4 }}>
              {connectedCount} ACTIVE
            </span>
          )}
          <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>
            Entity X monitors these accounts for impersonation & deepfakes
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {PLATFORMS.map(p => {
            const acct = accounts[p.id];
            const isConnected = !!acct;
            const isConnecting = connecting === p.id;

            return (
              <div key={p.id} style={{
                borderRadius: 12,
                border: `1px solid ${isConnected ? p.color + '44' : 'var(--border)'}`,
                background: isConnected ? p.bg : 'var(--surface)',
                padding: '14px 16px',
                transition: 'border-color 0.2s',
              }}>
                {/* Platform row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isConnecting ? 10 : 0 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: p.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <p.icon size={16} color={p.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{p.label}</div>
                    {isConnected && (
                      <div style={{ fontSize: 11, color: p.color, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {acct.handle}
                      </div>
                    )}
                  </div>
                  {isConnected ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleConnect(p.id)} title="Edit"
                        style={{ background: 'none', border: '1px solid ' + p.color + '44', borderRadius: 6, padding: '3px 8px', color: p.color, fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => disconnectPlatform(p.id)} title="Disconnect"
                        style={{ background: 'none', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, padding: '3px 6px', cursor: 'pointer', color: '#f87171', display: 'flex', alignItems: 'center' }}>
                        <WifiOff size={11} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => handleConnect(p.id)}
                      style={{ background: isConnecting ? 'rgba(139,92,246,0.15)' : p.bg, border: `1px solid ${p.color}44`, borderRadius: 8, padding: '5px 12px', color: p.color, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      {isConnecting ? 'Cancel' : 'Connect'}
                    </button>
                  )}
                </div>

                {/* Inline input when connecting */}
                {isConnecting && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input
                      autoFocus
                      placeholder={p.placeholder}
                      value={pendingHandle}
                      onChange={e => setPendingHandle(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && confirmConnect(p.id)}
                      style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: `1px solid ${p.color}44`, borderRadius: 8, padding: '7px 10px', color: '#f1f5f9', fontSize: 12, outline: 'none' }}
                    />
                    <button onClick={() => confirmConnect(p.id)}
                      style={{ background: p.color, border: 'none', borderRadius: 8, padding: '7px 12px', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Save
                    </button>
                  </div>
                )}

                {/* Connected status bar */}
                {isConnected && !isConnecting && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '6px 8px', borderRadius: 7, background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #34d399' }} />
                    <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>MONITORING ACTIVE</span>
                    <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>since {new Date(acct.since).toLocaleDateString()}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {connectedCount === 0 && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)', fontSize: 12, color: '#64748b' }}>
            Connect your social accounts so Entity X can watch for deepfakes, impersonation, and unauthorized use of your identity across platforms.
          </div>
        )}
      </div>

      {/* Protection type tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {CONTENT_TYPES.map(t => (
          <div key={t.id} style={{ background: 'var(--card)', borderRadius: 12, padding: 16, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `${t.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><t.icon size={16} color={t.color} /></div>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>{t.label}</div>
            <div style={{ fontSize: 12, color: '#64748b', flex: 1 }}>{t.desc}</div>
            <div style={{ fontSize: 11, color: t.color, fontWeight: 700 }}>{profiles.filter(p => p.content_type === t.id).length} profiles</div>
          </div>
        ))}
      </div>

      {/* Register profile form */}
      {creating && (
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#a78bfa', marginBottom: 16 }}>Register New Profile</div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <input placeholder="Creator name / identity" value={newProfile.name} onChange={e => setNewProfile({ ...newProfile, name: e.target.value })}
              style={{ flex: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13 }} />
            <select value={newProfile.content_type} onChange={e => setNewProfile({ ...newProfile, content_type: e.target.value })}
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13 }}>
              {CONTENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <input placeholder="Description (optional)" value={newProfile.description} onChange={e => setNewProfile({ ...newProfile, description: e.target.value })}
            style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }} />
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12, padding: '10px 14px', background: 'rgba(139,92,246,0.05)', borderRadius: 8, border: '1px solid rgba(139,92,246,0.1)' }}>
            After registration, Entity X will flag content matching this profile when scanning.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={createProfile} style={{ background: '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 24px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Register</button>
            <button onClick={() => setCreating(false)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Profiles + sidebar */}
      <div style={{ display: 'flex', gap: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 16 }}>Registered Profiles ({profiles.length})</div>
            {profiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 0' }}>
                <Shield size={32} color="#334155" style={{ marginBottom: 12 }} />
                <div style={{ color: '#475569', fontSize: 13 }}>No profiles yet. Register your identity to start protection.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {profiles.map(p => {
                  const type = CONTENT_TYPES.find(t => t.id === p.content_type) || CONTENT_TYPES[3];
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                      <div style={{ width: 38, height: 38, borderRadius: 10, background: `${type.color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><type.icon size={16} color={type.color} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9' }}>{p.name}</div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                          <span style={{ fontSize: 11, color: type.color, fontWeight: 700 }}>{type.label}</span>
                          {p.description && <span style={{ fontSize: 11, color: '#64748b' }}>{p.description}</span>}
                          <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{fmt(p.created_at)}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CheckCircle size={13} color="#34d399" />
                        <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>PROTECTED</span>
                      </div>
                      <button onClick={() => deleteProfile(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4, marginLeft: 4 }}><Trash2 size={14} /></button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 16, flexShrink: 0 }}>
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9', marginBottom: 12 }}>Check Content</div>
            <input placeholder="URL to check against profiles" value={checkUrl} onChange={e => setCheckUrl(e.target.value)}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: '#f1f5f9', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
            <button onClick={checkContent} disabled={checking}
              style={{ width: '100%', background: checking ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 8, padding: 10, color: '#fff', fontSize: 13, fontWeight: 600, cursor: checking ? 'not-allowed' : 'pointer' }}>
              {checking ? 'Checking...' : 'Check Now'}
            </button>
            {checkResult && !checkResult.error && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: `${riskColor(checkResult.risk_level)}0f`, border: `1px solid ${riskColor(checkResult.risk_level)}33` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: riskColor(checkResult.risk_level) }}>{checkResult.risk_level} RISK</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>AI Probability: {((checkResult.fake_probability || 0) * 100).toFixed(1)}%</div>
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Bell size={14} color="#8b5cf6" />
              <div style={{ fontWeight: 700, fontSize: 13, color: '#f1f5f9' }}>Alert Feed</div>
              <span style={{ fontSize: 10, color: '#8b5cf6', background: 'rgba(139,92,246,0.15)', padding: '2px 6px', borderRadius: 4, marginLeft: 'auto' }}>{alerts.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map(a => (
                <div key={a.id} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--surface)', border: `1px solid ${riskColor(a.risk)}22` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <AlertTriangle size={11} color={riskColor(a.risk)} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: riskColor(a.risk) }}>{a.risk}</span>
                    <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>{a.time}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{a.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
