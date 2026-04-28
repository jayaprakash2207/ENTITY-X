import { useState } from 'react'
import { Mic, Search, Loader, AlertTriangle, ChevronRight, Activity, Music } from 'lucide-react'

const S = {
  page: { minHeight: '100%', color: '#c8d8e8' },

  header: {
    marginBottom: 24, paddingBottom: 16,
    borderBottom: '1px solid rgba(0,204,136,0.15)',
    display: 'flex', alignItems: 'center', gap: 14,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 8,
    background: 'rgba(0,204,136,0.1)',
    border: '1px solid rgba(0,204,136,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 18px rgba(0,204,136,0.2)',
  },
  title: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' },
  sub:   { fontSize: 11, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },

  panel: {
    background: 'rgba(17,17,32,0.9)',
    border: '1px solid rgba(0,204,136,0.12)',
    borderRadius: 10, padding: '18px 20px', marginBottom: 16,
  },
  panelTitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: '#00cc88',
    marginBottom: 14, borderBottom: '1px solid rgba(0,204,136,0.1)',
    paddingBottom: 8,
  },

  label: {
    fontSize: 10, fontWeight: 700, color: '#3d7aaa',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    marginBottom: 5, display: 'block',
  },
  input: {
    width: '100%', background: 'rgba(0,204,136,0.04)',
    border: '1px solid rgba(0,204,136,0.2)', borderRadius: 7,
    padding: '10px 12px', color: '#c8d8e8', fontSize: 13,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  },

  btn: (disabled = false) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '9px 20px', borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${disabled ? 'rgba(100,120,150,0.2)' : 'rgba(0,204,136,0.4)'}`,
    background: disabled ? 'rgba(100,120,150,0.06)' : 'rgba(0,204,136,0.1)',
    color: disabled ? '#475569' : '#00cc88',
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    transition: 'all 0.18s', opacity: disabled ? 0.6 : 1,
  }),

  btnSecondary: (color) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '8px 16px', borderRadius: 7,
    cursor: 'pointer',
    border: `1px solid rgba(${color},0.3)`,
    background: `rgba(${color},0.08)`,
    color: `rgb(${color})`,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    transition: 'all 0.18s',
  }),

  errorBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderRadius: 7,
    background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.25)',
    color: '#ff6680', fontSize: 12, marginTop: 14,
  },

  badge: (risk) => {
    const map = {
      HIGH:   ['rgba(255,45,85,0.15)',  '#f87171', 'rgba(255,45,85,0.35)'],
      MEDIUM: ['rgba(255,170,0,0.12)',  '#fbbf24', 'rgba(255,170,0,0.3)'],
      LOW:    ['rgba(0,255,149,0.08)',  '#34d399', 'rgba(0,255,149,0.25)'],
    }
    const [bg, text, border] = map[risk] || map.LOW
    return {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 12px', borderRadius: 4,
      background: bg, border: `1px solid ${border}`,
      color: text, fontSize: 11, fontWeight: 800,
      letterSpacing: '0.14em', textTransform: 'uppercase',
    }
  },

  scoreCard: {
    background: 'rgba(4,15,35,0.98)',
    border: '1px solid rgba(0,204,136,0.1)',
    borderRadius: 8, padding: '14px 16px',
  },
  scoreLabel: { fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 },
  scoreValue: (color) => ({ fontSize: 26, fontWeight: 900, color, letterSpacing: '0.04em', lineHeight: 1 }),

  track: { height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  fill:  (pct, color) => ({ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }),

  findingItem: {
    display: 'flex', gap: 10, padding: '8px 12px',
    background: 'rgba(0,204,136,0.04)', borderLeft: '2px solid rgba(0,204,136,0.3)',
    borderRadius: '0 5px 5px 0', marginBottom: 6, fontSize: 12, color: '#8ab8d8', lineHeight: 1.5,
  },
  findingNum: { fontSize: 10, fontWeight: 700, color: '#00cc88', flexShrink: 0, marginTop: 2, minWidth: 16 },

  loadingOverlay: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 12, padding: '48px 20px',
    color: '#3d7aaa', fontSize: 13,
  },
}

function probColor(p) {
  if (p >= 0.65) return '#f87171'
  if (p >= 0.35) return '#fbbf24'
  return '#34d399'
}

export default function AudioAnalyzer({ onSelectEntity }) {
  const [url, setUrl]         = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [result, setResult]   = useState(null)

  const canScan = url.trim().startsWith('http') && !loading

  const handleScan = async () => {
    setError(null)
    setResult(null)
    setLoading(true)
    try {
      const res = await window.entityX.scanAudio(url.trim())
      if (res?.success && res.entity) {
        setResult(res.entity)
      } else {
        setError(res?.error || 'Analysis failed. Make sure the backend is running.')
      }
    } catch (e) {
      setError(e.message || 'Unexpected error during audio analysis.')
    } finally {
      setLoading(false)
    }
  }

  const entity      = result
  const fakeProb    = entity?.fake_probability ?? 0
  const risk        = (entity?.risk_level || 'LOW').toUpperCase()
  const duration    = entity?.duration_seconds ?? null
  const analysisType = entity?.analysis_type ?? 'ML'
  const findings    = entity?.forensic_explanation ?? []

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerIcon}>
          <Mic size={18} color="#00cc88" />
        </div>
        <div>
          <div style={S.title}>Audio Analyzer</div>
          <div style={S.sub}>Synthetic voice &amp; deepfake audio detection — paste an audio URL</div>
        </div>
      </div>

      {/* Input Panel */}
      <div style={S.panel}>
        <div style={S.panelTitle}>Audio URL</div>
        <label style={S.label}>Direct Audio Link (.mp3, .wav, .ogg, .flac, .m4a, etc.)</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="https://example.com/audio.mp3"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canScan && handleScan()}
          />
          <button style={S.btn(!canScan)} onClick={handleScan} disabled={!canScan}>
            {loading ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
            {loading ? 'Scanning…' : 'Scan Audio'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
          Entity X will download the audio, run WavLM + spectral analysis, and detect synthetic voice / TTS / deepfake audio signals.
        </div>
        {error && (
          <div style={S.errorBox}>
            <AlertTriangle size={14} />
            {error}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={S.panel}>
          <div style={S.loadingOverlay}>
            <Music size={32} color="#00cc88" style={{ animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ fontWeight: 700, color: '#00cc88', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 11 }}>
              Analyzing Audio
            </div>
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
              Downloading → spectral analysis → WavLM deepfake detection → fusion scoring.
              <br />This may take 15–60 seconds depending on audio length.
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {entity && !loading && (
        <>
          {/* Score Panel */}
          <div style={S.panel}>
            <div style={S.panelTitle}>Detection Results</div>

            {/* Risk + meta */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={S.badge(risk)}>
                <AlertTriangle size={9} />
                {risk} Risk
              </div>
              {duration != null && (
                <div style={{
                  fontSize: 10, color: '#3d7aaa',
                  background: 'rgba(0,204,136,0.06)', border: '1px solid rgba(0,204,136,0.15)',
                  borderRadius: 4, padding: '2px 10px', letterSpacing: '0.08em',
                }}>
                  <Mic size={9} style={{ display: 'inline', marginRight: 4 }} />
                  {duration.toFixed(1)}s
                </div>
              )}
              <div style={{
                fontSize: 10, color: '#3d7aaa',
                background: 'rgba(0,204,136,0.06)', border: '1px solid rgba(0,204,136,0.15)',
                borderRadius: 4, padding: '2px 10px', letterSpacing: '0.08em',
              }}>
                {analysisType}
              </div>
              <div style={{ fontSize: 10, color: '#2a4a65', marginLeft: 'auto', fontFamily: 'monospace' }}>
                ID: <span style={{ color: '#475569' }}>{entity.entity_id}</span>
              </div>
            </div>

            {/* Score cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              {/* Fake probability */}
              <div style={{ ...S.scoreCard, gridColumn: '1 / -1' }}>
                <div style={S.scoreLabel}>AI / Synthetic Voice Probability</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={S.scoreValue(probColor(fakeProb))}>
                    {(fakeProb * 100).toFixed(1)}%
                  </div>
                  <span style={{ fontSize: 11, color: '#475569' }}>confidence this audio is AI-generated or deepfaked</span>
                </div>
                <div style={S.track}>
                  <div style={S.fill(fakeProb * 100, probColor(fakeProb))} />
                </div>
              </div>

              {/* Authenticity */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>Authenticity Score</div>
                <div style={S.scoreValue(probColor(1 - fakeProb))}>
                  {((1 - fakeProb) * 100).toFixed(1)}%
                </div>
                <div style={S.track}>
                  <div style={S.fill((1 - fakeProb) * 100, probColor(1 - fakeProb))} />
                </div>
              </div>

              {/* Duration */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>Duration</div>
                <div style={S.scoreValue('#00cc88')}>
                  {duration != null ? `${duration.toFixed(1)}s` : '—'}
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                  {analysisType} analysis
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid rgba(0,204,136,0.08)' }}>
              <button
                style={S.btnSecondary('0,212,255')}
                onClick={() => entity && onSelectEntity && onSelectEntity({
                  ...entity,
                  entity_type: 'AUDIO',
                  ai_generated_probability: entity.fake_probability,
                  misinformation_risk: entity.risk_level,
                  credibility_score: 1 - entity.fake_probability,
                  explanation: entity.forensic_explanation,
                  content_title: entity.audio_url,
                })}
              >
                <ChevronRight size={12} />
                Investigation View
              </button>
              <button
                style={S.btnSecondary('123,47,255')}
                onClick={() => { setResult(null); setUrl('') }}
              >
                <Activity size={12} />
                Scan Another
              </button>
            </div>
          </div>

          {/* Forensic findings */}
          {findings.length > 0 && (
            <div style={S.panel}>
              <div style={S.panelTitle}>Forensic Findings ({findings.length})</div>
              {findings.map((f, i) => (
                <div key={i} style={S.findingItem}>
                  <span style={S.findingNum}>{i + 1}</span>
                  <span>{String(f)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!entity && !loading && (
        <div style={{ ...S.panel, textAlign: 'center', padding: '36px 20px' }}>
          <Mic size={36} color="rgba(0,204,136,0.2)" style={{ margin: '0 auto 14px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
            Paste an audio URL to start
          </div>
          <div style={{ fontSize: 11, color: '#2a4a65', lineHeight: 1.8, maxWidth: 440, margin: '0 auto' }}>
            Entity X uses WavLM spectral analysis, MFCC feature extraction, and ML fusion
            to detect synthetic voices, TTS, and AI-generated audio.
          </div>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            {[
              { label: 'WavLM',         sub: 'Microsoft wav2vec deepfake detector', color: '#00cc88', status: 'ACTIVE' },
              { label: 'Spectral',      sub: 'MFCC + mel-spectrogram analysis',     color: '#8b5cf6', status: 'ACTIVE' },
              { label: 'Pitch/Prosody', sub: 'Unnatural prosody detection',         color: '#fbbf24', status: 'ACTIVE' },
              { label: 'Fusion',        sub: 'Ensemble score combination',          color: '#8b5cf6', status: 'ACTIVE' },
            ].map(m => {
              const rgb = m.color === '#00cc88' ? '0,204,136' : m.color === '#8b5cf6' ? '0,212,255' : m.color === '#fbbf24' ? '255,170,0' : '123,47,255'
              return (
                <div key={m.label} style={{ padding: '10px 14px', borderRadius: 6, background: `rgba(${rgb},0.06)`, border: `1px solid ${m.color}22`, minWidth: 120, textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: m.color }}>{m.label}</div>
                    <div style={{ fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 2, background: 'rgba(0,255,149,0.1)', color: '#34d399', border: '1px solid rgba(0,255,149,0.2)', letterSpacing: '0.1em' }}>
                      {m.status}
                    </div>
                  </div>
                  <div style={{ fontSize: 9, color: '#475569' }}>{m.sub}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  )
}
