import { useState, useEffect, useCallback } from 'react';
import { Rss, Plus, Trash2, RefreshCw, Globe, Zap, AlertTriangle } from 'lucide-react';

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', color: '#f87171', hint: 'Enter Channel ID (UCxxxxxx) or full channel URL — RSS connected automatically.' },
  { id: 'twitter', label: 'Twitter/X', color: '#60a5fa', hint: 'Enter handle without @ — RSS connected via Nitter automatically.' },
  { id: 'instagram', label: 'Instagram', color: '#e879f9', hint: 'Enter handle without @ or full profile URL — RSS connected via RSSHub automatically.' },
  { id: 'rss', label: 'RSS Feed', color: '#fb923c', hint: 'Enter any RSS/Atom feed URL directly.' },
];

const PLATFORM_COLORS = { youtube: '#f87171', twitter: '#60a5fa', instagram: '#e879f9', rss: '#fb923c' };

export default function SocialScanner({ onNavigate }) {
  const [feeds, setFeeds] = useState([]);
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newFeed, setNewFeed] = useState({ platform: 'youtube', handle: '', rss_url: '' });
  const [loading, setLoading] = useState(false);
  const [analyzingIdx, setAnalyzingIdx] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);

  const loadFeeds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/social/feeds');
      const data = await res.json();
      setFeeds(data.feeds || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadFeeds(); }, []);

  const addFeed = async () => {
    if (!newFeed.handle.trim()) return;
    const payload = { ...newFeed };
    if (newFeed.platform === 'rss') { payload.rss_url = newFeed.handle; }
    await fetch('http://127.0.0.1:8000/api/social/feeds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    setAdding(false);
    setNewFeed({ platform: 'youtube', handle: '', rss_url: '' });
    await loadFeeds();
  };

  const removeFeed = async (id) => {
    await fetch(`http://127.0.0.1:8000/api/social/feeds/${id}`, { method: 'DELETE' });
    await loadFeeds();
  };

  const scanFeeds = async () => {
    setScanning(true);
    setScanResults([]);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/social/scan');
      const data = await res.json();
      setScanResults(data.results || []);
    } catch (e) { console.error(e); } finally { setScanning(false); }
  };

  const analyzePost = async (post, idx) => {
    setAnalyzingIdx(idx);
    setAnalyzeError(null);
    try {
      // We already have the caption text — send it directly for analysis.
      // Trying to re-fetch the post URL requires login and returns nothing.
      const text = post.title || '';
      const title = `${post.platform} @${post.handle}`;

      let result;
      if (text.trim().length >= 20) {
        result = await window.entityX.analyzeText({ text, title });
      } else if (post.url) {
        result = await window.entityX.analyzeUrl(post.url);
      }

      if (result?.success && result?.entity) {
        if (onNavigate) onNavigate('investigation', result.entity);
      } else {
        setAnalyzeError(result?.error || 'Analysis failed — post may be too short or inaccessible.');
        setTimeout(() => setAnalyzeError(null), 5000);
      }
    } catch (e) {
      setAnalyzeError(e.message);
      setTimeout(() => setAnalyzeError(null), 5000);
    } finally {
      setAnalyzingIdx(null);
    }
  };

  const activePlatform = PLATFORMS.find(p => p.id === newFeed.platform);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Rss size={20} color="#8b5cf6" /></div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#f1f5f9' }}>Social Media Scanner</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Monitor feeds for AI-generated content</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setAdding(!adding)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 10, padding: '10px 16px', color: '#a78bfa', fontSize: 13, cursor: 'pointer' }}>
            <Plus size={15} /> Add Feed
          </button>
          <button onClick={scanFeeds} disabled={scanning || feeds.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: scanning ? '#334155' : '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: scanning || feeds.length === 0 ? 'not-allowed' : 'pointer' }}>
            <RefreshCw size={15} /> {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {adding && (
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#a78bfa', marginBottom: 16 }}>Add Social Feed</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {PLATFORMS.map(p => (
              <button key={p.id} onClick={() => setNewFeed({ ...newFeed, platform: p.id })}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, border: `1px solid ${newFeed.platform === p.id ? p.color : 'var(--border)'}`, background: newFeed.platform === p.id ? `${p.color}1a` : 'var(--surface)', color: newFeed.platform === p.id ? p.color : '#64748b', fontSize: 13, cursor: 'pointer', fontWeight: newFeed.platform === p.id ? 700 : 400 }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{activePlatform?.hint}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              placeholder={newFeed.platform === 'youtube' ? 'Channel ID (UCxxxxxx...)' : newFeed.platform === 'rss' ? 'https://feed.url/rss.xml' : 'handle'}
              value={newFeed.handle} onChange={e => setNewFeed({ ...newFeed, handle: e.target.value })}
              style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#f1f5f9', fontSize: 13 }}
            />
            <button onClick={addFeed} style={{ background: '#8b5cf6', border: 'none', borderRadius: 10, padding: '10px 20px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
            <button onClick={() => setAdding(false)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 16px', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 16 }}>Monitored Feeds ({feeds.length})</div>
        {feeds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#475569', fontSize: 13 }}>
            <Rss size={32} color="#334155" style={{ marginBottom: 12 }} />
            <div>No feeds monitored. Add a YouTube channel ID or RSS feed URL.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {feeds.map(feed => {
              const color = PLATFORM_COLORS[feed.platform] || '#8b5cf6';
              return (
                <div key={feed.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Globe size={16} color={color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{feed.handle}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', background: `${color}1a`, padding: '2px 8px', borderRadius: 4 }}>{feed.platform}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                      <span style={{ color: feed.rss_url ? '#34d399' : '#fbbf24' }}>
                        {feed.rss_url ? '● Connected' : '● Pending connection'}
                      </span>
                      {' · '}
                      {feed.last_checked ? `Last scanned ${new Date(feed.last_checked).toLocaleTimeString()}` : 'Not yet scanned'}
                    </div>
                  </div>
                  <button onClick={() => removeFeed(feed.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {analyzeError && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#f87171' }}>{analyzeError}</span>
        </div>
      )}

      {scanResults.length > 0 && (
        <div style={{ background: 'var(--card)', borderRadius: 14, padding: '20px 24px', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', marginBottom: 16 }}>Latest Posts — {scanResults.length} items</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scanResults.map((r, i) => {
              const color = PLATFORM_COLORS[r.platform] || '#8b5cf6';
              if (r.error) {
                const isPlatformBlock = r.error.includes('403') || r.error.includes('401');
                return (
                  <div key={i} style={{ padding: '12px 16px', borderRadius: 10, background: isPlatformBlock ? 'rgba(251,191,36,0.06)' : 'rgba(248,113,113,0.06)', border: `1px solid ${isPlatformBlock ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.2)'}`, fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <AlertTriangle size={13} style={{ color: isPlatformBlock ? '#fbbf24' : '#f87171', flexShrink: 0, marginTop: 1 }} />
                      <div>
                        <div style={{ color: isPlatformBlock ? '#fbbf24' : '#f87171', fontWeight: 600, marginBottom: 2 }}>{r.handle} ({r.platform})</div>
                        <div style={{ color: '#64748b' }}>
                          {isPlatformBlock
                            ? `${r.platform === 'instagram' ? 'Instagram' : 'Twitter'} blocks public RSS access. Add a custom RSS bridge URL via "Add Feed" → RSS Feed option.`
                            : r.error}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)' }}>
                  {r.thumbnail
                    ? <img src={r.thumbnail} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} onError={e => { e.target.style.display='none' }} />
                    : <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 6 }} />
                  }
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', marginBottom: 4, lineHeight: 1.4 }}>{r.title || 'Untitled'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: '#64748b' }}>
                      <span style={{ color, fontWeight: 700, textTransform: 'uppercase' }}>{r.platform}</span>
                      <span>@{r.handle}</span>
                      {r.published && <span>· {new Date(r.published).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => analyzePost(r, i)}
                    disabled={analyzingIdx !== null}
                    style={{
                      background: analyzingIdx === i ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.15)',
                      border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8,
                      padding: '6px 12px', color: '#a78bfa', fontSize: 11,
                      cursor: analyzingIdx !== null ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                      opacity: analyzingIdx !== null && analyzingIdx !== i ? 0.5 : 1,
                    }}>
                    {analyzingIdx === i
                      ? <><span style={{ width: 10, height: 10, border: '2px solid rgba(167,139,250,0.3)', borderTopColor: '#a78bfa', borderRadius: '50%', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} /> Analyzing…</>
                      : <><Zap size={11} /> Analyze</>
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
