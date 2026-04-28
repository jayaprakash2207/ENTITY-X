function clampPercent(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return Math.max(0, Math.min(100, num))
}

function sentenceCase(text = '') {
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function parseExplainableSignals(explain = [], probability = 0, riskLevel = 'LOW') {
  const text = Array.isArray(explain) ? explain : []
  const lower = text.map((line) => String(line || '').toLowerCase())

  const signals = {
    vit: null,
    swin: null,
    ufd: null,
    clip: null,
    sdxl: null,
    face: null,
    resolution: null,
    quality: null,
    exifMissing: false,
    heuristic: false,
    confidenceLabel: riskLevel,
    confidenceDetail: probability >= 0.7 ? 'High' : probability >= 0.4 ? 'Moderate' : 'Low',
    summaryLine: '',
  }

  for (const line of text) {
    const valueLine = String(line || '')
    const ensemble = valueLine.match(/ViT=([\d.]+)%.*?SwinV2=([\d.]+)%.*?UFD=([\d.]+)%.*?(?:CLIP=([\d.]+)%.*?)?SDXL=([\d.]+)%/i)
    if (ensemble) {
      signals.vit = clampPercent(ensemble[1])
      signals.swin = clampPercent(ensemble[2])
      signals.ufd = clampPercent(ensemble[3])
      if (ensemble[4] != null) signals.clip = clampPercent(ensemble[4])
      signals.sdxl = clampPercent(ensemble[5])
    }

    const vit = valueLine.match(/Tier-1.*?ViT.*?:\s*([\d.]+)%\s*AI/i)
    if (vit) signals.vit = clampPercent(vit[1])

    const swin = valueLine.match(/Tier-2.*?SwinV2.*?:\s*([\d.]+)%\s*AI/i)
    if (swin) signals.swin = clampPercent(swin[1])

    const ufd = valueLine.match(/(?:Tier-3|PRIMARY).*?UniversalFakeDetect.*?:\s*([\d.]+)%\s*AI/i)
    if (ufd) signals.ufd = clampPercent(ufd[1])

    const clip = valueLine.match(/(?:Secondary|Tier-4).*?CLIP.*?:\s*([\d.]+)%\s*AI/i)
    if (clip) signals.clip = clampPercent(clip[1])

    const sdxl = valueLine.match(/(?:Tertiary|Tier-4).*?SDXL.*?:\s*([\d.]+)%\s*AI/i)
    if (sdxl) signals.sdxl = clampPercent(sdxl[1])

    const face = valueLine.match(/\[FACE\].*?:\s*([\d.]+)%\s*AI/i)
    if (face) signals.face = clampPercent(face[1])

    const resolution = valueLine.match(/Image resolution:\s*(\d+)x(\d+)px\s*\(quality:\s*(\w+)\)/i)
    if (resolution) {
      signals.resolution = `${resolution[1]}x${resolution[2]} px`
      signals.quality = sentenceCase(resolution[3])
    }

    if (/no camera exif|make\/model\/software absent|exif/i.test(valueLine)) {
      signals.exifMissing = /no camera exif|absent/i.test(valueLine)
    }

    if (/\[heuristic mode\]/i.test(valueLine)) {
      signals.heuristic = true
    }

    if (!signals.summaryLine) {
      const summary = valueLine.match(/(LOW|MODERATE(?:-HIGH)?|HIGH)\s*\(([\d.]+)%\):\s*(.+)$/i)
      if (summary) {
        signals.summaryLine = summary[3]
      }
    }
  }

  const evidence = [
    signals.face != null && {
      id: 'face',
      label: 'Face region',
      score: signals.face,
      detail: `${signals.face.toFixed(1)}% AI score on the detected face area`,
    },
    signals.ufd != null && {
      id: 'ufd',
      label: 'Universal detector',
      score: signals.ufd,
      detail: `${signals.ufd.toFixed(1)}% AI score from the general-purpose fake detector`,
    },
    signals.sdxl != null && {
      id: 'sdxl',
      label: 'Image generator match',
      score: signals.sdxl,
      detail: `${signals.sdxl.toFixed(1)}% match with SDXL-style synthetic patterns`,
    },
    signals.exifMissing && {
      id: 'exif',
      label: 'Metadata gap',
      score: 82,
      detail: 'Camera metadata is missing, which is common in generated or reprocessed images',
    },
    signals.quality && {
      id: 'quality',
      label: 'Image quality',
      score: signals.quality === 'Low' ? 78 : signals.quality === 'Medium' ? 58 : 32,
      detail: `${signals.resolution || 'Detected'} with ${signals.quality.toLowerCase()} quality`,
    },
  ].filter(Boolean)

  const topEvidence = evidence
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  const stepByStep = [
    `The system compared this content across multiple forensic models and combined the results instead of relying on a single detector.`,
    topEvidence[0] ? `${topEvidence[0].label} stood out most: ${topEvidence[0].detail}.` : 'No single indicator dominated, so the result depends on several weaker signals combined.',
    topEvidence[1] ? `A second reason was ${topEvidence[1].label.toLowerCase()}: ${topEvidence[1].detail}.` : 'Additional context came from metadata, image quality, and model agreement.',
    `Overall confidence is ${signals.confidenceDetail.toLowerCase()} and the technical risk level is ${String(riskLevel || 'LOW').toUpperCase()}.`,
  ]

  const simpleSummary =
    signals.summaryLine ||
    (probability >= 0.7
      ? 'Several strong indicators suggest this content may be AI-generated or manipulated.'
      : probability >= 0.4
        ? 'There are meaningful signs of possible AI generation, but the result is not fully conclusive.'
        : 'Only limited synthetic signals were found, so the content does not show strong AI-generation evidence.')

  const technicalHighlights = text
    .filter(Boolean)
    .slice(0, 5)
    .map((line) => String(line))

  return {
    ...signals,
    simpleSummary,
    evidence,
    topEvidence,
    stepByStep,
    technicalHighlights,
  }
}

function scoreColor(score) {
  if (score >= 75) return '#f87171'
  if (score >= 45) return '#fbbf24'
  return '#34d399'
}

function surfaceBackground(variant) {
  if (variant === 'forensic') return 'rgba(15,23,42,0.95)'
  if (variant === 'legal') return 'rgba(30,27,75,0.35)'
  return 'rgba(139,92,246,0.07)'
}

export default function ExplainableForensics({
  explain = [],
  probability = 0,
  riskLevel = 'LOW',
  title = 'Explainable AI Forensics',
  variant = 'default',
}) {
  const data = parseExplainableSignals(explain, probability, riskLevel)

  return (
    <div style={{
      background: surfaceBackground(variant),
      border: '1px solid rgba(139,92,246,0.18)',
      borderRadius: 10,
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: '#c4b5fd', margin: 0 }}>{title}</h2>
          <p style={{ fontSize: 11, color: '#94a3b8', margin: '4px 0 0' }}>
            Plain-language reasons for the flag, shown separately from the raw technical findings.
          </p>
        </div>
        <div style={{
          padding: '5px 10px',
          borderRadius: 999,
          border: '1px solid rgba(139,92,246,0.2)',
          background: 'rgba(139,92,246,0.08)',
          color: '#e2e8f0',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {String(riskLevel || 'LOW').toUpperCase()} risk
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.72)',
            border: '1px solid rgba(148,163,184,0.12)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 7 }}>
              What This Means
            </div>
            <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.7 }}>
              {data.simpleSummary}
            </div>
          </div>

          <div style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.72)',
            border: '1px solid rgba(148,163,184,0.12)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Step-By-Step Reasoning
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {data.stepByStep.map((step, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    flexShrink: 0,
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: 'rgba(139,92,246,0.14)',
                    border: '1px solid rgba(139,92,246,0.3)',
                    color: '#c4b5fd',
                    fontSize: 10,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                  }}>
                    {index + 1}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.6 }}>{step}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.72)',
            border: '1px solid rgba(148,163,184,0.12)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Visual Evidence Map
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(data.evidence.length > 0 ? data.evidence : [
                { id: 'overall', label: 'Overall model signal', score: clampPercent(probability * 100) || 0, detail: 'Combined model score from the current analysis' },
              ]).map((item) => {
                const color = scoreColor(item.score)
                return (
                  <div key={item.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#e2e8f0' }}>{item.label}</span>
                      <span style={{ fontSize: 11, color, fontFamily: 'monospace', fontWeight: 700 }}>{item.score.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ width: `${item.score}%`, height: '100%', background: `linear-gradient(90deg, ${color}, ${color}bb)` }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>{item.detail}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.72)',
            border: '1px solid rgba(148,163,184,0.12)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
              Highlighted Technical Clues
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.technicalHighlights.length > 0 ? data.technicalHighlights.map((line, index) => (
                <div key={index} style={{
                  padding: '8px 10px',
                  borderRadius: 7,
                  background: 'rgba(139,92,246,0.06)',
                  border: '1px solid rgba(139,92,246,0.12)',
                  fontSize: 11,
                  color: '#cbd5e1',
                  lineHeight: 1.5,
                }}>
                  {line}
                </div>
              )) : (
                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                  Technical detail will appear here once forensic findings are available.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid rgba(148,163,184,0.12)',
        fontSize: 10.5,
        color: '#94a3b8',
        lineHeight: 1.6,
      }}>
        This explanation is designed for non-technical readers. Keep using the existing forensic findings below for expert review and recordkeeping.
      </div>
    </div>
  )
}
