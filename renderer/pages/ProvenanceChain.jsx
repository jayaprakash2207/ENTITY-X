import { useState } from 'react';

const API = 'http://127.0.0.1:8000';

function ts(ms) {
  if (!ms) return 'N/A';
  return new Date(ms).toLocaleString();
}

function ProvBadge({ standard }) {
  const map = {
    'C2PA':                { color: '#34d399', label: 'C2PA Certified' },
    'Content Credentials': { color: '#8b5cf6', label: 'Content Credentials' },
    'XMP':                 { color: '#fbbf24', label: 'XMP Metadata' },
  };
  const s = map[standard] || { color: '#f87171', label: 'No Provenance' };
  return (
    <span style={{ background: s.color + '22', color: s.color, border: `1px solid ${s.color}44`,
                   borderRadius: '99px', padding: '2px 10px', fontSize: '12px', fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

export default function ProvenanceChain() {
  const [url, setUrl]         = useState('');
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function track() {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await fetch(`${API}/api/provenance/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) throw new Error(await r.text());
      setResult(await r.json());
    } catch (err) {
      setError(err.message || 'Failed to track provenance');
    } finally {
      setLoading(false);
    }
  }

  const chain = result?.chain || [];

  return (
    <div style={{ padding: '24px', maxWidth: '860px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>Provenance & Spread Chain</h1>
      <p style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
        Fingerprint an image URL and trace every domain it has appeared on
      </p>

      {/* Input */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && track()}
          placeholder="https://example.com/image.jpg"
          style={{ flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: '8px',
                   padding: '10px 14px', color: '#e2e8f0', fontSize: '13px' }}
        />
        <button onClick={track} disabled={loading || !url.trim()}
          style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '8px',
                   padding: '10px 22px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
          {loading ? 'Tracking…' : 'Track'}
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: '8px',
                      padding: '10px 14px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '32px', color: '#7c3aed', fontSize: '14px' }}>
          Fetching and fingerprinting image…
        </div>
      )}

      {result && !loading && (
        <>
          {/* Summary */}
          <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
              <ProvBadge standard={result.provenance?.standard} />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                {result.provenance?.note}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 18px' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#818cf8' }}>{chain.length}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Unique Domains</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 18px' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: '#f59e0b' }}>{result.spread_count}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Total Appearances</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px 18px', flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {result.content_hash}
                </div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>Content Fingerprint (dHash)</div>
              </div>
            </div>
          </div>

          {/* Chain timeline */}
          {chain.length === 0 ? (
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '24px', textAlign: 'center', color: '#475569' }}>
              This is the first time we've seen this content. Spread chain started.
            </div>
          ) : (
            <div style={{ background: '#1e293b', borderRadius: '10px', padding: '20px' }}>
              <h3 style={{ fontSize: '13px', color: '#7c3aed', textTransform: 'uppercase',
                           letterSpacing: '.06em', marginBottom: '16px' }}>
                Spread Chain ({chain.length} domain{chain.length !== 1 ? 's' : ''})
              </h3>
              <div style={{ position: 'relative' }}>
                {chain.map((entry, i) => (
                  <div key={entry.id} style={{ display: 'flex', gap: '14px', marginBottom: '16px' }}>
                    {/* Timeline dot */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#7c3aed',
                                    border: '2px solid #4c1d95', flexShrink: 0, marginTop: '3px' }} />
                      {i < chain.length - 1 && (
                        <div style={{ width: '2px', flex: 1, background: '#334155', marginTop: '4px' }} />
                      )}
                    </div>
                    <div style={{ flex: 1, paddingBottom: '8px' }}>
                      <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '14px' }}>{entry.domain}</div>
                      <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                        First seen: {ts(entry.first_seen)}
                        {entry.seen_count > 1 && ` · Seen ${entry.seen_count}× times`}
                        {entry.provenance_standard && ` · ${entry.provenance_standard}`}
                      </div>
                      {entry.source_url && (
                        <div style={{ fontSize: '11px', color: '#475569', marginTop: '3px',
                                      wordBreak: 'break-all', maxWidth: '600px' }}>
                          {entry.source_url}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
