import { ArrowLeft, TrendingUp, AlertTriangle, BarChart3, Shield, Crosshair, Clock, FileSearch, Download, Image, Music, Cpu, Layers, Activity, Waves, Eye, Search, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import ContentIntel from '../components/ContentIntel'
import ExplainableForensics from '../components/ExplainableForensics'

function parseForensicData(explain = []) {
  const data = { ufd: null, clip_ai: null, sdxl: null, resolution: null, quality: null, multicrop: null, aux: {}, heuristic: false }

  for (const line of explain) {
    const ensemble = line.match(/UFD=([\d.]+)%.*?CLIP=([\d.]+)%.*?SDXL=([\d.]+)%/i)
    if (ensemble) {
      data.ufd = Number(ensemble[1])
      data.clip_ai = Number(ensemble[2])
      data.sdxl = Number(ensemble[3])
    }

    if (data.ufd === null) {
      const ufdMatch = line.match(/PRIMARY.*?UniversalFakeDetect.*?:\s*([\d.]+)%\s*AI/i)
      if (ufdMatch) data.ufd = Number(ufdMatch[1])
    }

    if (data.clip_ai === null) {
      const clipMatch = line.match(/Secondary.*?CLIP.*?:\s*([\d.]+)%\s*AI/i)
      if (clipMatch) data.clip_ai = Number(clipMatch[1])
    }

    if (data.sdxl === null) {
      const sdxlMatch = line.match(/Tertiary.*?SDXL.*?:\s*([\d.]+)%\s*AI/i)
      if (sdxlMatch) data.sdxl = Number(sdxlMatch[1])
    }

    const resolution = line.match(/Image resolution:\s*(\d+)x(\d+)px\s*\(quality:\s*(\w+)\)/i)
    if (resolution) {
      data.resolution = `${resolution[1]}x${resolution[2]}px`
      data.quality = resolution[3]
    }

    const multiCrop = line.match(/Multi-crop analysis\s*\((\d+)\s*regions?\)/i)
    if (multiCrop) data.multicrop = { count: Number(multiCrop[1]) }

    const frequency = line.match(/Frequency analysis:\s*([\d.]+)%\s*AI/i)
    if (frequency) data.aux.frequency = Number(frequency[1]) / 100

    const texture = line.match(/Texture analysis:\s*([\d.]+)%\s*AI/i)
    if (texture) data.aux.texture = Number(texture[1]) / 100

    const symmetry = line.match(/Symmetry analysis:\s*([\d.]+)%\s*AI/i)
    if (symmetry) data.aux.symmetry = Number(symmetry[1]) / 100

    if (line.includes('[HEURISTIC MODE]')) data.heuristic = true
  }

  return data
}

function detectMediaType(entity) {
  const type = (entity?.type || entity?.entity_type || '').toUpperCase()
  const url = entity?.image_url || entity?.source_url || entity?.url || ''

  if (type === 'VIDEO' || /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(url)) return 'video'
  if (type === 'AUDIO' || /\.(mp3|wav|ogg|flac|aac|m4a)(\?|$)/i.test(url)) return 'audio'
  if (type === 'IMAGE' || /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)(\?|$)/i.test(url)) return 'image'
  if (url) return 'image'
  return 'unknown'
}

export default function Investigation({ entity, onClose }) {
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfStatus, setPdfStatus] = useState(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [trustScore, setTrustScore] = useState(0)

  useEffect(() => {
    const analysis = entity?.analysis || {}
    setTrustScore(entity?.trust_score ?? analysis.trust_score ?? analysis.trust_score_after ?? 0)
  }, [entity])

  const handleExportPdf = async () => {
    if (!entity) return
    setPdfLoading(true)
    setPdfStatus(null)

    try {
      const res = await window.entityX.exportPdf({
        entity_id: entity.entity_id,
        entity_type: entity.type || entity.entity_type,
        content_title: entity.content_title || entity.title,
        source_url: entity.source_url || entity.image_url || entity.url,
        image_url: entity.image_url,
        risk_level: entity.risk_level,
        ai_generated_probability: entity.ai_generated_probability,
        fake_probability: entity.fake_probability,
        credibility_score: entity.credibility_score,
        trust_score: entity.trust_score,
        trust_score_delta: entity.trust_score_delta,
        forensic_explanation: entity.forensic_explanation || [],
        key_claims: entity.key_claims || [],
        ai_summary: entity.ai_summary,
        topic: entity.topic,
        detected_at: entity.detected_at || entity.analyzed_at,
        word_count: entity.word_count,
        session_id: entity.session_id,
      })

      if (res?.success) setPdfStatus({ ok: true, msg: `Saved: ${res.path}` })
      else if (res?.canceled) setPdfStatus(null)
      else setPdfStatus({ ok: false, msg: res?.error || 'Export failed' })
    } catch (error) {
      setPdfStatus({ ok: false, msg: error.message })
    } finally {
      setPdfLoading(false)
      setTimeout(() => setPdfStatus(null), 6000)
    }
  }

  if (!entity) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 16 }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: 'rgba(139,92,246,0.08)',
          border: '1px solid rgba(139,92,246,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Crosshair size={28} style={{ color: '#6d28d9' }} />
        </div>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#475569', textAlign: 'center' }}>No entity selected</p>
        <p style={{ fontSize: 12, color: '#334155', textAlign: 'center', maxWidth: 320, lineHeight: 1.7 }}>
          Click any detection in the Live Monitor or Audit History, or use the Investigation View button after scanning content.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { icon: <Eye size={11} />, label: 'Live Monitor', color: '#8b5cf6' },
            { icon: <Clock size={11} />, label: 'Audit History', color: '#22d3ee' },
            { icon: <Search size={11} />, label: 'Scan Content', color: '#fbbf24' },
          ].map((item) => (
            <div key={item.label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 8,
              background: `${item.color}12`,
              border: `1px solid ${item.color}28`,
              color: item.color,
              fontSize: 11,
              fontWeight: 500,
            }}>
              {item.icon}
              {item.label}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const analysis = entity.analysis || {}
  const entityType = (entity.type || entity.entity_type || analysis.type || '').toUpperCase()
  const fakeProbRaw = entity.fake_probability ?? entity.ai_generated_probability ?? analysis.fake_probability ?? analysis.ai_generated_probability ?? 0
  const probability = typeof fakeProbRaw === 'number' ? fakeProbRaw : 0
  const riskLevel = (entity.risk_level || analysis.risk_level || (probability > 0.7 ? 'HIGH' : probability > 0.4 ? 'MEDIUM' : 'LOW')).toUpperCase()
  const accent = riskLevel === 'HIGH' ? '#f87171' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#34d399'
  const mediaType = detectMediaType(entity)
  const mediaUrl = entity.image_url || entity.source_url || entity.url || analysis.image_url || analysis.source_url
  const forensicLines = entity.forensic_explanation || analysis.forensic_explanation || []
  const forensic = parseForensicData(forensicLines)
  const hasModels = forensic.ufd !== null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 16 }}>
        <button
          onClick={onClose}
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, cursor: 'pointer', padding: '7px 9px', color: '#64748b' }}
        >
          <ArrowLeft size={14} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <BarChart3 size={16} color="#a78bfa" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em', margin: 0 }}>Investigation</h1>
            <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>Forensic content analysis</p>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={riskLevel === 'HIGH' ? 'badge-high threat-blink' : riskLevel === 'MEDIUM' ? 'badge-medium' : 'badge-low'} style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px' }}>
            {riskLevel} RISK
          </span>
          <button
            onClick={handleExportPdf}
            disabled={pdfLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 7,
              cursor: pdfLoading ? 'not-allowed' : 'pointer',
              background: 'rgba(139,92,246,0.1)',
              border: '1px solid rgba(139,92,246,0.25)',
              color: '#a78bfa',
              fontSize: 11,
              fontWeight: 600,
              opacity: pdfLoading ? 0.6 : 1,
              transition: 'all 0.18s',
            }}
          >
            <Download size={13} />
            Export PDF
          </button>
        </div>
      </div>

      {pdfStatus && (
        <div style={{
          fontSize: 11,
          padding: '7px 14px',
          borderRadius: 7,
          color: pdfStatus.ok ? '#34d399' : '#fbbf24',
          background: pdfStatus.ok ? 'rgba(0,255,149,0.08)' : 'rgba(255,170,0,0.08)',
          border: `1px solid ${pdfStatus.ok ? 'rgba(0,255,149,0.2)' : 'rgba(255,170,0,0.2)'}`,
        }}>
          {pdfStatus.msg}
        </div>
      )}

      <ExplainableForensics explain={forensicLines} probability={probability} riskLevel={riskLevel} />

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {mediaUrl && (
          <div style={{ flex: '1 1 340px', minWidth: 320, background: 'rgba(17,17,32,0.9)', border: `1px solid ${accent}33`, borderRadius: 8, overflow: 'hidden', boxShadow: `0 0 20px ${accent}14` }}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {mediaType === 'video' ? <Video size={12} style={{ color: accent }} /> : mediaType === 'audio' ? <Music size={12} style={{ color: accent }} /> : <Image size={12} style={{ color: accent }} />}
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: accent, textTransform: 'uppercase' }}>
                  {mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Image'} Preview
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {forensic.resolution && <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{forensic.resolution}</span>}
                {forensic.quality && (
                  <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.18)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {forensic.quality}
                  </span>
                )}
                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: `${accent}18`, color: accent, border: `1px solid ${accent}44`, fontWeight: 800, letterSpacing: '0.1em' }}>
                  {entityType || mediaType.toUpperCase()}
                </span>
              </div>
            </div>
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 80 }}>
              {mediaType === 'image' && <MediaImage url={mediaUrl} accent={accent} />}
              {mediaType === 'video' && (
                <video controls style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 4, background: '#000' }}>
                  <source src={mediaUrl} />
                </video>
              )}
              {mediaType === 'audio' && (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <Music size={24} style={{ color: accent, opacity: 0.5, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 10, color: '#64748b', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                      {mediaUrl.split('/').pop()}
                    </div>
                  </div>
                  <audio controls style={{ width: '100%', accentColor: accent }}>
                    <source src={mediaUrl} />
                  </audio>
                </div>
              )}
            </div>
            {forensic.heuristic && (
              <div style={{ padding: '5px 14px', background: 'rgba(251,191,36,0.07)', borderTop: '1px solid rgba(251,191,36,0.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={9} style={{ color: '#fbbf24' }} />
                <span style={{ fontSize: 8, color: '#fbbf24', letterSpacing: '0.06em' }}>HEURISTIC MODE - URL fingerprint analysis only</span>
              </div>
            )}
          </div>
        )}

        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {hasModels && (
            <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={12} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#a78bfa', textTransform: 'uppercase' }}>ML Model Ensemble</span>
                <span style={{ marginLeft: 'auto', fontSize: 9, color: '#475569' }}>3-model consensus</span>
              </div>
              <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ModelScoreRow label="UniversalFakeDetect" abbr="UFD" score={forensic.ufd} color="#f87171" desc="CLIP ViT-L/14 + FC head" />
                <ModelScoreRow label="AI Image Detector" abbr="CLIP" score={forensic.clip_ai} color="#fbbf24" desc="umm-maybe/AI-image-detector" />
                <ModelScoreRow label="SDXL Detector" abbr="SDXL" score={forensic.sdxl} color="#8b5cf6" desc="Organika/sdxl-detector" />
              </div>
              {Object.keys(forensic.aux).length > 0 && (
                <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(139,92,246,0.08)', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
                  {forensic.aux.frequency != null && <AuxScore label="Frequency" icon={<Waves size={10} />} value={forensic.aux.frequency} />}
                  {forensic.aux.texture != null && <AuxScore label="Texture" icon={<Layers size={10} />} value={forensic.aux.texture} />}
                  {forensic.aux.symmetry != null && <AuxScore label="Symmetry" icon={<Activity size={10} />} value={forensic.aux.symmetry} />}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            <MetricCard title="AI Probability" icon={<TrendingUp size={15} />} value={`${(probability * 100).toFixed(1)}%`} accent={accent} sub="Deepfake / Synthetic" bar={probability} />

            <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Shield size={13} style={{ color: '#8b5cf6' }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Trust Score</span>
                </div>
                {!resetConfirm ? (
                  <button
                    onClick={() => setResetConfirm(true)}
                    style={{ fontSize: 10, fontWeight: 500, color: '#475569', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 6, padding: '3px 9px', cursor: 'pointer' }}
                    title="Reset session trust score to 100"
                  >
                    Reset
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 5 }}>
                    <button
                      onClick={async () => {
                        if (window.entityX?.resetTrust) {
                          const response = await window.entityX.resetTrust()
                          if (response?.success) setTrustScore(100)
                        }
                        setResetConfirm(false)
                      }}
                      style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 6, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', cursor: 'pointer' }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setResetConfirm(false)}
                      style={{ fontSize: 10, fontWeight: 500, padding: '3px 9px', borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: '#475569', cursor: 'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: trustScore > 60 ? '#34d399' : trustScore > 30 ? '#fbbf24' : '#f87171', lineHeight: 1, fontFamily: 'monospace' }}>
                {typeof trustScore === 'number' ? trustScore.toFixed(1) : trustScore}
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, trustScore || 0))}%`, background: trustScore > 60 ? '#34d399' : trustScore > 30 ? '#fbbf24' : '#f87171', borderRadius: 4, transition: 'width 0.5s ease' }} />
              </div>
              <div style={{ fontSize: 10, color: '#475569' }}>Session integrity (0-100)</div>
            </div>

            <MetricCard
              title="Risk Level"
              icon={<AlertTriangle size={15} />}
              value={riskLevel}
              accent={accent}
              sub={riskLevel === 'HIGH' ? 'Manual review needed' : riskLevel === 'MEDIUM' ? 'Monitor closely' : 'No strong signals'}
            />
          </div>
        </div>
      </div>

      <ContentIntel entity={entity} />

      {forensicLines.length > 0 && (
        <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileSearch size={13} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Forensic Findings</span>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{forensicLines.length} entries</span>
          </div>
          <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {forensicLines.map((finding, index) => (
              <div key={index} style={{ padding: '9px 13px', background: 'rgba(139,92,246,0.04)', borderLeft: '2px solid rgba(139,92,246,0.4)', borderRadius: '0 6px 6px 0' }}>
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.6 }}>{finding}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {(entity.detected_timestamp || entity.source_url || entity.image_url) && (
        <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={13} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>Detection Metadata</span>
          </div>
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entity.detected_timestamp && <Row label="Detected" value={new Date(entity.detected_timestamp).toLocaleString()} />}
            {(entity.source_url || entity.image_url) && <Row label="Source URL" value={entity.source_url || entity.image_url} mono />}
            {entity.type && <Row label="Content Type" value={entity.type} />}
            {entity.session_id && <Row label="Session" value={entity.session_id} mono />}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ title, icon, value, accent, sub, bar }) {
  return (
    <div style={{ background: 'rgba(17,17,32,0.9)', border: `1px solid ${accent}22`, borderRadius: 10, padding: '14px', position: 'relative', overflow: 'hidden', transition: 'border-color 0.2s' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: `radial-gradient(circle at top right, ${accent}10, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#475569' }}>{title}</span>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: `${accent}18`, border: `1px solid ${accent}28`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent, opacity: 0.9 }}>
          {icon}
        </div>
      </div>
      <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'monospace', color: accent, margin: '0 0 8px' }}>{value}</p>
      {bar !== undefined && (
        <div className="prob-track" style={{ marginBottom: 7, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${bar * 100}%`, background: `linear-gradient(90deg, ${accent}, ${accent}99)`, borderRadius: 4, transition: 'width 0.6s ease' }} />
        </div>
      )}
      <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{sub}</p>
    </div>
  )
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: '#475569', minWidth: 110, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all', lineHeight: 1.5 }}>{value}</span>
    </div>
  )
}

function MediaImage({ url, accent }) {
  const [state, setState] = useState('loading')

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {state !== 'error' && (
        <img
          src={url}
          alt="Analyzed media"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
          style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 4, border: `1px solid ${accent}33`, display: state === 'loading' ? 'none' : 'block', objectFit: 'contain' }}
        />
      )}
      {state === 'loading' && (
        <div style={{ padding: 24, color: '#475569', fontSize: 11, textAlign: 'center' }}>
          <div style={{ width: 22, height: 22, border: '2px solid rgba(139,92,246,0.15)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          Loading...
        </div>
      )}
      {state === 'error' && (
        <div style={{ padding: '12px 18px', textAlign: 'center' }}>
          <Image size={26} style={{ color: '#334155', marginBottom: 6 }} />
          <div style={{ fontSize: 10, color: '#475569' }}>Image could not be displayed</div>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 9, color: '#8b5cf6', fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', marginTop: 5 }}>
            {url}
          </a>
        </div>
      )}
    </div>
  )
}

function ModelScoreRow({ label, abbr, score, color, desc }) {
  if (score === null) return null

  const pct = Math.min(score, 100)
  const riskColor = pct > 70 ? '#f87171' : pct > 40 ? '#fbbf24' : '#34d399'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, background: `${color}22`, color, border: `1px solid ${color}44`, letterSpacing: '0.08em' }}>{abbr}</span>
          <span style={{ fontSize: 11, color: '#e2e8f0' }}>{label}</span>
          <span style={{ fontSize: 9, color: '#475569' }}>{desc}</span>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: riskColor, minWidth: 44, textAlign: 'right' }}>{score.toFixed(1)}%</span>
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${riskColor}, ${riskColor}99)`, boxShadow: `0 0 6px ${riskColor}88`, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

function AuxScore({ label, icon, value }) {
  const pct = Math.min(value * 100, 100)
  const color = pct > 70 ? '#f87171' : pct > 40 ? '#fbbf24' : '#34d399'

  return (
    <div style={{ padding: '7px 9px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, color: '#64748b' }}>
        {icon}
        <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#475569' }}>{label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 900, fontFamily: 'monospace', color, marginBottom: 3 }}>{(value * 100).toFixed(0)}%</div>
      <div style={{ height: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 1 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 1, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}
