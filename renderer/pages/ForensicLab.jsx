import { ArrowLeft, Lock, FlaskConical, Activity, BarChart2, Waves, Layers, Eye, Download, Image, Video, Music, Cpu, AlertTriangle, Crosshair } from 'lucide-react'
import { useState } from 'react'
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

export default function ForensicLab({ entity, onClose }) {
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfStatus, setPdfStatus] = useState(null)

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
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <FlaskConical size={32} style={{ color: '#334155' }} />
        </div>
        <p style={{ fontSize: 12, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase' }}>No entity selected</p>
        <p style={{ fontSize: 11, color: '#334155', textAlign: 'center', maxWidth: 320, lineHeight: 1.7 }}>
          Open a detection from the Live Monitor or Audit History, then click "Forensics" to examine it here.
        </p>
      </div>
    )
  }

  const analysis = entity.analysis || {}
  const fakeProbRaw = entity.fake_probability ?? entity.ai_generated_probability ?? analysis.fake_probability ?? analysis.ai_generated_probability ?? 0
  const probability = typeof fakeProbRaw === 'number' ? fakeProbRaw : 0
  const riskLevel = (entity.risk_level || analysis.risk_level || (probability > 0.7 ? 'HIGH' : probability > 0.4 ? 'MEDIUM' : 'LOW')).toUpperCase()
  const accent = riskLevel === 'HIGH' ? '#f87171' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#34d399'
  const entityType = (entity.type || entity.entity_type || analysis.type || '').toUpperCase()
  const mediaType = detectMediaType(entity)
  const mediaUrl = entity.image_url || entity.source_url || entity.url || analysis.image_url || analysis.source_url
  const explain = entity.forensic_explanation || analysis.forensic_explanation || []
  const forensic = parseForensicData(explain)

  const hasSuspect = (keys) => keys.some((key) => explain.some((line) => line.toLowerCase().includes(key)))
  const hasHighScore = (keys) => keys.some((key) =>
    explain.some((line) => {
      if (!line.toLowerCase().includes(key)) return false
      const match = line.match(/([\d.]+)%/)
      return match && Number(match[1]) > 40
    })
  )

  const indicators = [
    { label: 'Frequency Analysis', status: hasHighScore(['frequency analysis']) ? 'detected' : hasSuspect(['frequency', 'fft', 'spectral']) ? 'suspicious' : 'clean', icon: <Waves size={11} /> },
    { label: 'Texture Consistency', status: hasHighScore(['texture analysis']) ? 'detected' : hasSuspect(['texture', 'smooth', 'gradient']) ? 'suspicious' : 'clean', icon: <Layers size={11} /> },
    { label: 'Symmetry Artifacts', status: hasHighScore(['symmetry analysis']) ? 'suspicious' : hasSuspect(['symmetry', 'symmetric']) ? 'suspicious' : 'clean', icon: <Activity size={11} /> },
    { label: 'Temporal / Audio', status: hasSuspect(['[ml-primary]', '[wavlm]', '[fusion]', 'temporal', 'optical flow', 'splice']) ? 'detected' : 'clean', icon: <Eye size={11} /> },
    { label: 'Metadata Integrity', status: explain.some((line) => line.toLowerCase().includes('exif')) ? 'suspicious' : 'unverified', icon: <Lock size={11} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,212,255,0.1)', paddingBottom: 14 }}>
        <button onClick={onClose} style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)', borderRadius: 4, cursor: 'pointer', padding: '6px 8px', color: '#8b5cf6' }}>
          <ArrowLeft size={14} />
        </button>
        <div style={{ width: 4, height: 22, borderRadius: 2, background: 'linear-gradient(180deg,#8b5cf6,#8b5cf6)', boxShadow: '0 0 8px rgba(139,92,246,0.6)' }} />
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em', color: '#f1f5f9', textTransform: 'uppercase', margin: 0 }}>Forensic Lab</h1>
          <p style={{ fontSize: 10, color: '#475569', margin: 0 }}>Advanced ML evidence examination</p>
        </div>
        <button
          onClick={handleExportPdf}
          disabled={pdfLoading}
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            borderRadius: 5,
            cursor: pdfLoading ? 'not-allowed' : 'pointer',
            background: 'rgba(139,92,246,0.1)',
            border: '1px solid rgba(139,92,246,0.3)',
            color: '#a78bfa',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            opacity: pdfLoading ? 0.6 : 1,
          }}
        >
          <Download size={11} />
          {pdfLoading ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>

      {pdfStatus && (
        <div style={{
          fontSize: 11,
          padding: '6px 12px',
          borderRadius: 5,
          color: pdfStatus.ok ? '#34d399' : '#fbbf24',
          background: pdfStatus.ok ? 'rgba(0,255,149,0.08)' : 'rgba(255,170,0,0.08)',
          border: `1px solid ${pdfStatus.ok ? 'rgba(0,255,149,0.2)' : 'rgba(255,170,0,0.2)'}`,
        }}>
          {pdfStatus.msg}
        </div>
      )}

      <ExplainableForensics explain={explain} probability={probability} riskLevel={riskLevel} variant="forensic" />

      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {mediaUrl && (
          <div style={{ flex: '1 1 340px', minWidth: 320, background: 'rgba(17,17,32,0.9)', border: `1px solid ${accent}33`, borderRadius: 8, overflow: 'hidden', boxShadow: `0 0 20px ${accent}14` }}>
            <div style={{ padding: '8px 14px', borderBottom: `1px solid ${accent}22`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {mediaType === 'video' ? <Video size={12} style={{ color: accent }} /> : mediaType === 'audio' ? <Music size={12} style={{ color: accent }} /> : <Image size={12} style={{ color: accent }} />}
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: accent, textTransform: 'uppercase' }}>
                  {mediaType === 'video' ? 'Video' : mediaType === 'audio' ? 'Audio' : 'Image'} Evidence
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {forensic.resolution && <span style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{forensic.resolution}</span>}
                {forensic.quality && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.18)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{forensic.quality}</span>}
                <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 2, background: `${accent}18`, color: accent, border: `1px solid ${accent}44`, fontWeight: 800, letterSpacing: '0.1em' }}>{entityType || mediaType.toUpperCase()}</span>
              </div>
            </div>
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 80 }}>
              {mediaType === 'image' && <LabImage url={mediaUrl} accent={accent} />}
              {mediaType === 'video' && (
                <video controls style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 4, background: '#000' }}>
                  <source src={mediaUrl} />
                </video>
              )}
              {mediaType === 'audio' && (
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Music size={24} style={{ color: accent, opacity: 0.5, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontFamily: 'monospace', wordBreak: 'break-all' }}>{mediaUrl.split('/').pop()}</div>
                    <audio controls style={{ width: '100%', accentColor: accent }}>
                      <source src={mediaUrl} />
                    </audio>
                  </div>
                </div>
              )}
              {mediaType === 'unknown' && (
                <div style={{ color: '#475569', fontSize: 11, textAlign: 'center' }}>
                  <Crosshair size={22} style={{ marginBottom: 6, opacity: 0.4 }} />
                  <div>Media unavailable</div>
                </div>
              )}
            </div>
            {forensic.heuristic && (
              <div style={{ padding: '5px 14px', background: 'rgba(255,170,0,0.07)', borderTop: '1px solid rgba(255,170,0,0.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={9} style={{ color: '#fbbf24' }} />
                <span style={{ fontSize: 8, color: '#fbbf24', letterSpacing: '0.06em' }}>HEURISTIC MODE - URL fingerprint analysis only</span>
              </div>
            )}
          </div>
        )}

        <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {forensic.ufd !== null && (
            <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={12} style={{ color: '#a78bfa' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#a78bfa', textTransform: 'uppercase' }}>ML Ensemble - UFD . CLIP . SDXL</span>
              </div>
              <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                <ModelScoreTile label="UniversalFakeDetect" abbr="UFD" score={forensic.ufd} color="#f87171" desc="ViT-L/14 + FC" />
                <ModelScoreTile label="AI Image Detector" abbr="CLIP" score={forensic.clip_ai} color="#fbbf24" desc="umm-maybe" />
                <ModelScoreTile label="SDXL Detector" abbr="SDXL" score={forensic.sdxl} color="#8b5cf6" desc="Organika" />
              </div>
              {(forensic.multicrop || Object.keys(forensic.aux).length > 0) && (
                <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(139,92,246,0.08)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {forensic.multicrop && (
                    <div style={{ padding: '5px 10px', background: 'rgba(139,92,246,0.04)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Multi-Crop - </span>
                      <span style={{ fontSize: 11, color: '#e2e8f0' }}>{forensic.multicrop.count} crops</span>
                    </div>
                  )}
                  {forensic.aux.frequency != null && <AuxChip label="Frequency" value={forensic.aux.frequency} icon={<Waves size={9} />} />}
                  {forensic.aux.texture != null && <AuxChip label="Texture" value={forensic.aux.texture} icon={<Layers size={9} />} />}
                  {forensic.aux.symmetry != null && <AuxChip label="Symmetry" value={forensic.aux.symmetry} icon={<Activity size={9} />} />}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <FlaskConical size={12} style={{ color: '#8b5cf6', filter: 'drop-shadow(0 0 4px #8b5cf6)' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#a78bfa', textTransform: 'uppercase' }}>Detection Metrics</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <FRow label="Primary Score" value={`${(probability * 100).toFixed(1)}%`} accent={accent} />
                <FRow label="Risk Level" value={riskLevel} accent={accent} />
                <FRow label="Content Type" value={entity.type || '-'} />
                <FRow label="Session" value={entity.session_id || '-'} mono />
                <FRow label="Trust Score" value={entity.trust_score != null ? entity.trust_score : '-'} />
              </div>
            </div>

            <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                <BarChart2 size={12} style={{ color: '#8b5cf6' }} />
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#8b5cf6', textTransform: 'uppercase' }}>Analysis Indicators</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {indicators.map((indicator, index) => (
                  <IndicatorRow key={index} icon={indicator.icon} label={indicator.label} status={indicator.status} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ContentIntel entity={entity} />

      {explain.length > 0 && (
        <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FlaskConical size={12} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#8b5cf6', textTransform: 'uppercase' }}>Detailed Findings</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#475569' }}>{explain.length} entries</span>
          </div>
          <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {explain.map((finding, index) => (
              <div
                key={index}
                style={{
                  padding: '8px 12px',
                  background: finding.toLowerCase().includes('unable') ? 'rgba(255,170,0,0.04)' : 'rgba(139,92,246,0.03)',
                  borderLeft: `2px solid ${finding.toLowerCase().includes('unable') ? 'rgba(255,170,0,0.5)' : 'rgba(139,92,246,0.38)'}`,
                  borderRadius: '0 4px 4px 0',
                }}
              >
                <p style={{ fontSize: 11, color: '#e2e8f0', margin: 0, lineHeight: 1.5 }}>{finding}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FRow({ label, value, accent, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid rgba(139,92,246,0.06)' }}>
      <span style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit', color: accent || '#e2e8f0' }}>{value}</span>
    </div>
  )
}

function IndicatorRow({ icon, label, status }) {
  const config = {
    detected: { color: '#f87171', bg: 'rgba(255,45,85,0.1)', border: 'rgba(255,45,85,0.3)', text: 'DETECTED' },
    suspicious: { color: '#fbbf24', bg: 'rgba(255,170,0,0.1)', border: 'rgba(255,170,0,0.3)', text: 'SUSPICIOUS' },
    clean: { color: '#34d399', bg: 'rgba(0,255,149,0.08)', border: 'rgba(0,255,149,0.25)', text: 'CLEAN' },
    unverified: { color: '#475569', bg: 'rgba(61,100,145,0.1)', border: 'rgba(61,100,145,0.25)', text: 'UNVERIFIED' },
  }[status] || { color: '#475569', bg: 'transparent', border: 'transparent', text: '-' }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(139,92,246,0.03)', borderRadius: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#64748b' }}>
        {icon}
        <span style={{ fontSize: 11, color: '#e2e8f0' }}>{label}</span>
      </div>
      <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 3, background: config.bg, color: config.color, border: `1px solid ${config.border}`, letterSpacing: '0.1em' }}>
        {config.text}
      </span>
    </div>
  )
}

function LabImage({ url, accent }) {
  const [state, setState] = useState('loading')

  return (
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {state !== 'error' && (
        <img
          src={url}
          alt="Evidence"
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
          style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 4, border: `1px solid ${accent}33`, display: state === 'loading' ? 'none' : 'block', objectFit: 'contain' }}
        />
      )}
      {state === 'loading' && (
        <div style={{ padding: 20, color: '#475569', fontSize: 11, textAlign: 'center' }}>
          <div style={{ width: 20, height: 20, border: '2px solid rgba(139,92,246,0.2)', borderTopColor: '#8b5cf6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 8px' }} />
          Loading...
        </div>
      )}
      {state === 'error' && (
        <div style={{ padding: '10px 16px', textAlign: 'center' }}>
          <Image size={24} style={{ color: '#334155', marginBottom: 4 }} />
          <div style={{ fontSize: 9, color: '#475569' }}>Image unavailable</div>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 8, color: '#8b5cf6', fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', marginTop: 4 }}>{url}</a>
        </div>
      )}
    </div>
  )
}

function ModelScoreTile({ label, abbr, score, color, desc }) {
  if (score === null) return null

  const pct = Math.min(score, 100)
  const riskColor = pct > 70 ? '#f87171' : pct > 40 ? '#fbbf24' : '#34d399'

  return (
    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '10px 12px', border: `1px solid ${color}22` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 5px', borderRadius: 2, background: `${color}22`, color, border: `1px solid ${color}44`, letterSpacing: '0.08em' }}>{abbr}</span>
        <span style={{ fontSize: 17, fontWeight: 900, fontFamily: 'monospace', color: riskColor }}>{score.toFixed(1)}%</span>
      </div>
      <div style={{ fontSize: 10, color: '#e2e8f0', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 9, color: '#475569', marginBottom: 6 }}>{desc}</div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${riskColor}, ${riskColor}99)`, boxShadow: `0 0 6px ${riskColor}88`, borderRadius: 2, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

function AuxChip({ label, value, icon }) {
  const pct = value * 100
  const color = pct > 70 ? '#f87171' : pct > 40 ? '#fbbf24' : '#34d399'

  return (
    <div style={{ padding: '5px 12px', background: 'rgba(139,92,246,0.04)', borderRadius: 4, border: '1px solid rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: '#475569' }}>{icon}</span>
      <span style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color }}>{pct.toFixed(0)}%</span>
    </div>
  )
}
