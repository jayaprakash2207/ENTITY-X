import { useState } from 'react'
import { Video, Search, Loader, AlertTriangle, Shield, ChevronRight, Film, Activity, Mic } from 'lucide-react'

const S = {
  page: { minHeight: '100%', color: '#c8d8e8' },

  header: {
    marginBottom: 24, paddingBottom: 16,
    borderBottom: '1px solid rgba(255,107,53,0.15)',
    display: 'flex', alignItems: 'center', gap: 14,
  },
  headerIcon: {
    width: 40, height: 40, borderRadius: 8,
    background: 'rgba(255,107,53,0.1)',
    border: '1px solid rgba(255,107,53,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 18px rgba(255,107,53,0.2)',
  },
  title: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' },
  sub:   { fontSize: 11, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },

  panel: {
    background: 'rgba(17,17,32,0.9)',
    border: '1px solid rgba(255,107,53,0.12)',
    borderRadius: 10, padding: '18px 20px', marginBottom: 16,
  },
  panelTitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: '#ff6b35',
    marginBottom: 14, borderBottom: '1px solid rgba(255,107,53,0.1)',
    paddingBottom: 8,
  },

  label: {
    fontSize: 10, fontWeight: 700, color: '#3d7aaa',
    letterSpacing: '0.1em', textTransform: 'uppercase',
    marginBottom: 5, display: 'block',
  },
  input: {
    width: '100%', background: 'rgba(255,107,53,0.04)',
    border: '1px solid rgba(255,107,53,0.2)', borderRadius: 7,
    padding: '10px 12px', color: '#c8d8e8', fontSize: 13,
    outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  },

  btn: (color = '#ff6b35', disabled = false) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '9px 20px', borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${disabled ? 'rgba(100,120,150,0.2)' : `rgba(255,107,53,0.4)`}`,
    background: disabled ? 'rgba(100,120,150,0.06)' : 'rgba(255,107,53,0.1)',
    color: disabled ? '#475569' : color,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    transition: 'all 0.18s', opacity: disabled ? 0.6 : 1,
  }),

  btnSecondary: (color, disabled = false) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '8px 16px', borderRadius: 7,
    cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid rgba(${color},0.3)`,
    background: `rgba(${color},0.08)`,
    color: `rgb(${color})`,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    transition: 'all 0.18s', opacity: disabled ? 0.5 : 1,
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
    border: '1px solid rgba(255,107,53,0.1)',
    borderRadius: 8, padding: '14px 16px',
  },
  scoreLabel: { fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 },
  scoreValue: (color) => ({ fontSize: 26, fontWeight: 900, color, letterSpacing: '0.04em', lineHeight: 1 }),

  track: { height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  fill:  (pct, color) => ({ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }),

  findingItem: {
    display: 'flex', gap: 10, padding: '8px 12px',
    background: 'rgba(255,107,53,0.04)', borderLeft: '2px solid rgba(255,107,53,0.3)',
    borderRadius: '0 5px 5px 0', marginBottom: 6, fontSize: 12, color: '#8ab8d8', lineHeight: 1.5,
  },
  findingNum: { fontSize: 10, fontWeight: 700, color: '#ff6b35', flexShrink: 0, marginTop: 2, minWidth: 16 },

  loadingOverlay: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 12, padding: '48px 20px',
    color: '#3d7aaa', fontSize: 13,
  },
}

function riskColor(risk) {
  if (risk === 'HIGH') return '#f87171'
  if (risk === 'MEDIUM') return '#fbbf24'
  return '#34d399'
}

function probColor(p) {
  if (p >= 0.65) return '#f87171'
  if (p >= 0.35) return '#fbbf24'
  return '#34d399'
}

// Mini bar chart for per-frame scores
function FrameChart({ scores }) {
  if (!scores || scores.length === 0) return null
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
        Per-Frame Scores ({scores.length} frames)
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 48 }}>
        {scores.map((s, i) => {
          const color = probColor(s)
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: '100%', minWidth: 6,
                height: `${Math.max(4, s * 44)}px`,
                background: color,
                borderRadius: '2px 2px 0 0',
                opacity: 0.85,
                boxShadow: s > 0.65 ? `0 0 6px ${color}` : 'none',
                transition: 'height 0.4s ease',
              }} />
              <span style={{ fontSize: 7, color: '#2a4a65', fontFamily: 'monospace' }}>{i + 1}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: '#2a4a65' }}>
        <span>frame 1</span>
        <span style={{ color: '#475569' }}>AI confidence per frame</span>
        <span>frame {scores.length}</span>
      </div>
    </div>
  )
}

export default function VideoAnalyzer({ onSelectEntity }) {
  const [url, setUrl]               = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [result, setResult]         = useState(null)
  const [audioResult, setAudioResult] = useState(null)

  const canScan = url.trim().startsWith('http') && !loading

  const handleScan = async () => {
    setError(null)
    setResult(null)
    setAudioResult(null)
    setLoading(true)
    try {
      const res = await window.entityX.scanVideoWithAudio(url.trim())
      if (res?.success && res.videoEntity) {
        setResult(res.videoEntity)
        setAudioResult(res.audioEntity ?? null)
      } else {
        setError(res?.error || 'Analysis failed. Make sure the backend is running.')
      }
    } catch (e) {
      setError(e.message || 'Unexpected error during video analysis.')
    } finally {
      setLoading(false)
    }
  }

  const entity      = result
  const fakeProb    = entity?.fake_probability ?? 0
  const risk        = (entity?.risk_level || 'LOW').toUpperCase()
  const frames      = entity?.frames_analysed ?? 0
  const frameScores = entity?.frame_scores ?? []
  const findings    = entity?.forensic_explanation ?? []

  const audioProb     = audioResult?.fake_probability ?? 0
  const audioRisk     = (audioResult?.risk_level || 'LOW').toUpperCase()
  const audioFindings = audioResult?.forensic_explanation ?? []

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerIcon}>
          <Video size={18} color="#ff6b35" />
        </div>
        <div>
          <div style={S.title}>Video Analyzer</div>
          <div style={S.sub}>Deepfake & synthetic video detection — paste a video URL</div>
        </div>
      </div>

      {/* Input Panel */}
      <div style={S.panel}>
        <div style={S.panelTitle}>Video URL</div>
        <label style={S.label}>YouTube, Vimeo, TikTok, or Direct Video Link (.mp4, .webm, .mov…)</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="https://youtube.com/watch?v=... or https://example.com/video.mp4"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canScan && handleScan()}
          />
          <button style={S.btn('#ff6b35', !canScan)} onClick={handleScan} disabled={!canScan}>
            {loading ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={13} />}
            {loading ? 'Scanning…' : 'Scan Video'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
          Supports YouTube, Vimeo, TikTok, Instagram, Facebook, and 1000+ sites via yt-dlp.
          Entity X extracts up to 16 frames, detects faces, runs 2 deepfake ML models, and analyzes the audio track.
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
            <Film size={32} color="#ff6b35" style={{ animation: 'spin 2s linear infinite' }} />
            <div style={{ fontWeight: 700, color: '#ff6b35', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 11 }}>
              Analyzing Video + Audio
            </div>
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
              Video: downloading → extracting frames → face detection → deepfake ML models
              <br />Audio: extracting track → spectral analysis → synthetic voice detection
              <br />Running both in parallel. This may take 30–120 seconds.
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
              <div style={{
                fontSize: 10, color: '#3d7aaa',
                background: 'rgba(255,107,53,0.06)', border: '1px solid rgba(255,107,53,0.15)',
                borderRadius: 4, padding: '2px 10px', letterSpacing: '0.08em',
              }}>
                <Film size={9} style={{ display: 'inline', marginRight: 4 }} />
                {frames} frames analyzed
              </div>
              <div style={{ fontSize: 10, color: '#2a4a65', marginLeft: 'auto', fontFamily: 'monospace' }}>
                ID: <span style={{ color: '#475569' }}>{entity.entity_id}</span>
              </div>
            </div>

            {/* Score cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              {/* Fake probability */}
              <div style={{ ...S.scoreCard, gridColumn: '1 / -1' }}>
                <div style={S.scoreLabel}>AI / Deepfake Probability</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={S.scoreValue(probColor(fakeProb))}>
                    {(fakeProb * 100).toFixed(1)}%
                  </div>
                  <span style={{ fontSize: 11, color: '#475569' }}>confidence this video is AI-generated or deepfaked</span>
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

              {/* Frames */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>Frames Analyzed</div>
                <div style={S.scoreValue('#ff6b35')}>{frames}</div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>
                  {frameScores.filter(s => s >= 0.65).length} high-risk frames
                </div>
              </div>
            </div>

            {/* Per-frame chart */}
            {frameScores.length > 0 && (
              <div style={{
                background: 'rgba(255,107,53,0.03)',
                border: '1px solid rgba(255,107,53,0.1)',
                borderRadius: 7, padding: '12px 14px', marginBottom: 14,
              }}>
                <FrameChart scores={frameScores} />
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid rgba(255,107,53,0.08)' }}>
              <button
                style={S.btnSecondary('0,212,255')}
                onClick={() => entity && onSelectEntity && onSelectEntity({ ...entity, entity_type: 'VIDEO', ai_generated_probability: entity.fake_probability, misinformation_risk: entity.risk_level, credibility_score: 1 - entity.fake_probability, explanation: entity.forensic_explanation, content_title: entity.video_url })}
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

          {/* Audio Analysis Results */}
          <div style={{ ...S.panel, border: '1px solid rgba(52,211,153,0.15)' }}>
            <div style={{ ...S.panelTitle, color: '#34d399', borderBottomColor: 'rgba(52,211,153,0.1)' }}>
              <Mic size={11} style={{ display: 'inline', marginRight: 6 }} />
              Audio Track Analysis
            </div>
            {audioResult ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <div style={{
                    ...S.badge(audioRisk),
                    background: audioRisk === 'HIGH' ? 'rgba(255,45,85,0.15)' : audioRisk === 'MEDIUM' ? 'rgba(255,170,0,0.12)' : 'rgba(52,211,153,0.1)',
                    border: `1px solid ${audioRisk === 'HIGH' ? 'rgba(255,45,85,0.35)' : audioRisk === 'MEDIUM' ? 'rgba(255,170,0,0.3)' : 'rgba(52,211,153,0.3)'}`,
                    color: audioRisk === 'HIGH' ? '#f87171' : audioRisk === 'MEDIUM' ? '#fbbf24' : '#34d399',
                  }}>
                    {audioRisk} Risk
                  </div>
                  {audioResult.analysis_type && (
                    <div style={{
                      fontSize: 10, color: '#34d399',
                      background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.15)',
                      borderRadius: 4, padding: '2px 10px', letterSpacing: '0.08em',
                    }}>
                      {audioResult.analysis_type}
                    </div>
                  )}
                  {audioResult.duration_seconds != null && (
                    <div style={{ fontSize: 10, color: '#2a4a65', fontFamily: 'monospace' }}>
                      {audioResult.duration_seconds.toFixed(1)}s
                    </div>
                  )}
                </div>

                <div style={{ ...S.scoreCard, border: '1px solid rgba(52,211,153,0.1)', marginBottom: 14 }}>
                  <div style={S.scoreLabel}>AI / Synthetic Audio Probability</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <div style={S.scoreValue(probColor(audioProb))}>
                      {(audioProb * 100).toFixed(1)}%
                    </div>
                    <span style={{ fontSize: 11, color: '#475569' }}>confidence audio is AI-generated or synthetic</span>
                  </div>
                  <div style={S.track}>
                    <div style={S.fill(audioProb * 100, probColor(audioProb))} />
                  </div>
                </div>

                {audioFindings.length > 0 && (
                  <>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#34d399', letterSpacing: '0.1em', marginBottom: 8 }}>
                      Audio Findings
                    </div>
                    {audioFindings.map((f, i) => (
                      <div key={i} style={{ ...S.findingItem, borderLeftColor: 'rgba(52,211,153,0.3)' }}>
                        <span style={{ ...S.findingNum, color: '#34d399' }}>{i + 1}</span>
                        <span>{String(f)}</span>
                      </div>
                    ))}
                  </>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#2a4a65', padding: '8px 0' }}>
                Audio analysis was not available for this video source.
                This can happen with DRM-protected or private streams.
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!entity && !loading && (
        <div style={{ ...S.panel, textAlign: 'center', padding: '40px 20px' }}>
          <Video size={36} color="rgba(255,107,53,0.2)" style={{ margin: '0 auto 14px' }} />
          <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 8 }}>
            Paste a video URL to start
          </div>
          <div style={{ fontSize: 11, color: '#2a4a65', lineHeight: 1.8, maxWidth: 440, margin: '0 auto' }}>
            Entity X uses two dedicated deepfake ML models (ViT 99.3% + SwinV2 98.1%),
            OpenCV face detection, and librosa audio analysis to detect synthetic or manipulated video.
          </div>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
            {[
              { label: 'ViT 99.3%',     sub: 'dima806 deepfake detector',      color: '#ff6b35' },
              { label: 'SwinV2 98.1%',  sub: 'haywoodsloan AI detector',       color: '#fbbf24' },
              { label: 'Face Crop',     sub: 'OpenCV Haar cascade',            color: '#8b5cf6' },
              { label: 'Audio AI',      sub: 'librosa spectral analysis',      color: '#00cc88' },
            ].map(m => (
              <div key={m.label} style={{
                padding: '8px 14px', borderRadius: 6,
                background: `rgba(${m.color === '#ff6b35' ? '255,107,53' : m.color === '#fbbf24' ? '255,170,0' : m.color === '#8b5cf6' ? '0,212,255' : '0,204,136'},0.06)`,
                border: `1px solid ${m.color}22`,
                minWidth: 120,
              }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: m.color }}>{m.label}</div>
                <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
