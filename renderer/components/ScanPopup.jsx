/**
 * ScanPopup — HUD-style scan result popup
 *
 * Opens when the user right-clicks (or double-clicks) an image/video/audio
 * element or selected text in the webview and picks "Scan with Entity X".
 *
 * Flow: scanning animation → result verdict → action buttons (Investigate / Forensics / Legal)
 */
import { useEffect, useState, useCallback } from 'react'
import {
  X, Zap, AlertTriangle, CheckCircle, Shield,
  Eye, FileText, Activity, Search, ArrowRight,
} from 'lucide-react'

/* ─── helpers ─── */
function getRiskColor(level) {
  if (!level) return '#8b5cf6'
  const l = level.toUpperCase()
  if (l.includes('HIGH'))   return '#f87171'
  if (l.includes('MEDIUM')) return '#fbbf24'
  return '#34d399'
}

function getProbability(result) {
  if (!result) return 0
  return result.fake_probability
    ?? result.ai_generated_probability
    ?? result.ai_probability
    ?? 0
}

const TYPE_COLOR = {
  image: '#8b5cf6',
  video: '#8b5cf6',
  audio: '#34d399',
  text:  '#fbbf24',
}
const TYPE_LABEL = {
  image: 'IMAGE SCAN',
  video: 'VIDEO SCAN',
  audio: 'AUDIO SCAN',
  text:  'TEXT SCAN',
}

/* ─── sub-components ─── */
function ActionBtn({ icon, label, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        padding: '8px 4px', borderRadius: 5,
        background: color + '12',
        border: `1px solid ${color}30`,
        cursor: 'pointer', color,
        fontSize: 9, fontWeight: 800, letterSpacing: '0.13em',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = color + '22'
        e.currentTarget.style.borderColor = color + '60'
        e.currentTarget.style.boxShadow = `0 0 12px ${color}20`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = color + '12'
        e.currentTarget.style.borderColor = color + '30'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {icon}
      {label}
      <ArrowRight size={8} />
    </button>
  )
}

function HudCorners({ color = 'rgba(139,92,246,0.38)' }) {
  const s = (pos) => ({
    position: 'absolute',
    width: 10, height: 10,
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: 0,
    ...(pos.includes('top')    ? { top: 0,    borderTopWidth: 1.5 }    : { bottom: 0, borderBottomWidth: 1.5 }),
    ...(pos.includes('left')   ? { left: 0,   borderLeftWidth: 1.5 }   : { right: 0,  borderRightWidth: 1.5 }),
  })
  return (
    <>
      <div style={s('top-left')} />
      <div style={s('top-right')} />
      <div style={s('bottom-left')} />
      <div style={s('bottom-right')} />
    </>
  )
}

/* ─── compact audio result card for video scans ─── */
function AudioResultCard({ audioResult }) {
  const AUDIO_COLOR = '#34d399'
  if (!audioResult) {
    return (
      <div style={{
        marginTop: 10, padding: '8px 12px', borderRadius: 6,
        background: 'rgba(52,211,153,0.04)', border: '1px solid rgba(52,211,153,0.12)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(52,211,153,0.3)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, color: '#2a4a65', letterSpacing: '0.1em' }}>AUDIO · Not available for this source</span>
      </div>
    )
  }

  const prob = audioResult.fake_probability ?? 0
  const risk = audioResult.risk_level || 'LOW'
  const riskCol = risk === 'HIGH' ? '#f87171' : risk === 'MEDIUM' ? '#fbbf24' : AUDIO_COLOR
  const findings = audioResult.forensic_explanation || []

  return (
    <div style={{
      marginTop: 10, padding: '10px 12px', borderRadius: 6,
      background: 'rgba(52,211,153,0.04)', border: `1px solid ${AUDIO_COLOR}22`,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{
          padding: '1px 7px', borderRadius: 2,
          background: AUDIO_COLOR + '15', border: `1px solid ${AUDIO_COLOR}40`,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: AUDIO_COLOR, letterSpacing: '0.14em' }}>AUDIO SCAN</span>
        </div>
        <div style={{
          padding: '1px 7px', borderRadius: 2,
          background: riskCol + '15', border: `1px solid ${riskCol}40`,
        }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: riskCol, letterSpacing: '0.12em' }}>{risk}</span>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 900, color: riskCol, fontFamily: 'monospace' }}>
          {Math.round(prob * 100)}%
        </span>
        <span style={{ fontSize: 8, color: '#2a4a65', letterSpacing: '0.08em' }}>AI PROB</span>
      </div>

      {/* Bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginBottom: findings.length ? 8 : 0 }}>
        <div style={{
          height: '100%', width: `${Math.round(prob * 100)}%`,
          background: `linear-gradient(90deg, ${riskCol}70, ${riskCol})`,
          borderRadius: 2, boxShadow: `0 0 6px ${riskCol}50`,
          transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)',
        }} />
      </div>

      {/* Top finding */}
      {findings.length > 0 && (
        <div style={{ fontSize: 9, color: '#6a90b4', lineHeight: 1.4, display: 'flex', gap: 5, marginTop: 2 }}>
          <div style={{ width: 4, height: 4, borderRadius: '50%', background: riskCol, flexShrink: 0, marginTop: 4 }} />
          <span>{String(findings[0])}</span>
        </div>
      )}
    </div>
  )
}

/* ─── main component ─── */
export default function ScanPopup({ payload, onClose, onNavigate }) {
  const [phase, setPhase]         = useState('scanning') // 'scanning' | 'result' | 'error' | 'navigating'
  const [result, setResult]       = useState(null)
  const [audioResult, setAudioResult] = useState(undefined) // undefined = not started, null = failed/N/A
  const [errorMsg, setErrorMsg]   = useState(null)
  const [progress, setProgress]   = useState(0)
  const [navTarget, setNavTarget] = useState(null)

  const handleNavigate = (dest, entity) => {
    setNavTarget(dest)
    setPhase('navigating')
    setTimeout(() => {
      onNavigate?.(dest, entity)
      onClose?.()
    }, 550)
  }

  const typeColor = TYPE_COLOR[payload?.type] || '#8b5cf6'
  const typeLabel = TYPE_LABEL[payload?.type] || 'SCAN'

  const runScan = useCallback(async () => {
    if (!payload) return
    setPhase('scanning')
    setProgress(0)
    setResult(null)
    setAudioResult(undefined)
    setErrorMsg(null)

    /* Animated progress bar — stalls at 85% until real result comes back */
    const tid = setInterval(() => {
      setProgress(p => {
        if (p >= 85) { clearInterval(tid); return 85 }
        return Math.min(85, p + (Math.random() * 10 + 3))
      })
    }, 180)

    try {
      let res
      if      (payload.type === 'image') res = await window.entityX.analyzeUrl(payload.url)
      else if (payload.type === 'video') res = await window.entityX.scanVideoWithAudio(payload.url)
      else if (payload.type === 'audio') res = await window.entityX.scanAudio(payload.url)
      else if (payload.type === 'text')  res = await window.entityX.analyzeText({ text: payload.text, title: payload.title || 'Selected Text' })

      clearInterval(tid)
      setProgress(100)

      if (payload.type === 'video') {
        if (res?.success && res?.videoEntity) {
          setResult(res.videoEntity)
          setAudioResult(res.audioEntity ?? null)
          setPhase('result')
        } else {
          setErrorMsg(res?.error || 'Analysis returned no result')
          setPhase('error')
        }
      } else if (res?.success && res?.entity) {
        setResult(res.entity)
        setPhase('result')
      } else {
        setErrorMsg(res?.error || 'Analysis returned no result')
        setPhase('error')
      }
    } catch (err) {
      clearInterval(tid)
      setErrorMsg(err.message || 'Unexpected error')
      setPhase('error')
    }
  }, [payload])

  useEffect(() => { runScan() }, [runScan])

  /* ESC key closes */
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!payload) return null

  const prob      = getProbability(result)
  const riskColor = phase === 'result' ? getRiskColor(result?.risk_level) : typeColor
  const exps      = result?.explanations || result?.forensic_explanation || []
  const sourceStr = payload.type === 'text'
    ? `"${(payload.text || '').substring(0, 58)}${payload.text?.length > 58 ? '…' : ''}"`
    : (payload.url || '').length > 62
      ? (payload.url || '').substring(0, 62) + '…'
      : (payload.url || '')

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,4,12,0.75)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        animation: 'sx-fade 0.18s ease-out',
      }}
    >
      <div style={{
        width: 480,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(160deg, rgba(2,10,24,0.99) 0%, rgba(1,6,16,0.99) 100%)',
        border: `1px solid ${riskColor}38`,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: `0 0 0 1px rgba(0,0,0,0.8), 0 24px 80px rgba(0,0,0,0.7), 0 0 40px ${riskColor}12`,
        animation: 'sx-rise 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative',
      }}>

        {/* ── TOP GLOW LINE ── */}
        <div style={{
          position: 'absolute', top: 0, left: '10%', right: '10%', height: 1,
          background: `linear-gradient(90deg, transparent, ${typeColor}80, transparent)`,
          boxShadow: `0 0 10px ${typeColor}60`,
        }} />

        {/* ══ HEADER ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px',
          background: 'rgba(0,212,255,0.025)',
          borderBottom: '1px solid rgba(139,92,246,0.08)',
        }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 16, height: 16,
              background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.32)',
              borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 8px rgba(139,92,246,0.22)',
            }}>
              <Zap size={9} color="#8b5cf6" />
            </div>
            <span style={{ fontSize: 9, fontWeight: 900, color: '#8b5cf6', letterSpacing: '0.18em' }}>
              ENTITY<span style={{ opacity: 0.5 }}>X</span>
            </span>
          </div>

          {/* Type badge */}
          <div style={{
            padding: '2px 8px', borderRadius: 2,
            background: typeColor + '15',
            border: `1px solid ${typeColor}40`,
          }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: typeColor, letterSpacing: '0.16em' }}>
              {typeLabel}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: 22, height: 22, borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.08)',
              cursor: 'pointer', color: '#475569',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.12)'; e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(255,45,85,0.25)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)' }}
            title="Close (Esc)"
          >
            <X size={11} />
          </button>
        </div>

        {/* ── SOURCE LINE ── */}
        <div style={{
          padding: '5px 14px',
          borderBottom: '1px solid rgba(139,92,246,0.06)',
          background: 'rgba(0,0,0,0.2)',
        }}>
          <span style={{
            fontSize: 9, fontFamily: 'monospace',
            color: '#2a4a65', letterSpacing: '0.06em',
            display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {sourceStr}
          </span>
        </div>

        {/* ══ SCROLLABLE BODY ══ */}
        <div style={{ overflowY: 'auto', flex: 1 }}>

        {/* ══ SCANNING PHASE ══ */}
        {phase === 'scanning' && (
          <div style={{ padding: '32px 24px 28px', textAlign: 'center' }}>
            {/* Rings */}
            <div style={{ position: 'relative', width: 88, height: 88, margin: '0 auto 20px' }}>
              {/* Static outer ring */}
              <div style={{
                position: 'absolute', inset: 0,
                border: `1.5px solid ${typeColor}15`,
                borderRadius: '50%',
              }} />
              {/* Static inner ring */}
              <div style={{
                position: 'absolute', inset: 10,
                border: `1px solid ${typeColor}08`,
                borderRadius: '50%',
              }} />
              {/* Spinning outer */}
              <div style={{
                position: 'absolute', inset: 0,
                border: '2px solid transparent',
                borderTopColor: typeColor,
                borderRadius: '50%',
                animation: 'sx-spin 0.85s linear infinite',
                boxShadow: `0 0 14px ${typeColor}50`,
              }} />
              {/* Spinning inner (reverse) */}
              <div style={{
                position: 'absolute', inset: 10,
                border: '1.5px solid transparent',
                borderTopColor: typeColor + '60',
                borderRadius: '50%',
                animation: 'sx-spin 1.3s linear infinite reverse',
              }} />
              {/* Center icon */}
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Search size={20} color={typeColor + 'aa'} style={{ animation: 'sx-pulse 1.6s ease-in-out infinite' }} />
              </div>
            </div>

            <div style={{
              fontSize: 12, fontWeight: 900, color: typeColor,
              letterSpacing: '0.22em', marginBottom: 5,
            }}>
              ANALYZING
            </div>
            <div style={{ fontSize: 9, color: '#2a4a65', letterSpacing: '0.14em', marginBottom: 18 }}>
              {payload?.type === 'video' ? 'VIDEO · AUDIO · PARALLEL ANALYSIS' : 'RUNNING ENSEMBLE MODELS'}
            </div>

            {/* Progress bar */}
            <div style={{
              height: 2, background: 'rgba(255,255,255,0.05)',
              borderRadius: 1, overflow: 'hidden', margin: '0 24px',
            }}>
              <div style={{
                height: '100%',
                width: `${progress}%`,
                background: `linear-gradient(90deg, ${typeColor}60, ${typeColor})`,
                borderRadius: 1,
                transition: 'width 0.25s ease',
                boxShadow: `0 0 8px ${typeColor}70`,
              }} />
            </div>
          </div>
        )}

        {/* ══ ERROR PHASE ══ */}
        {phase === 'error' && (
          <div style={{ padding: '28px 24px', textAlign: 'center' }}>
            <AlertTriangle size={30} color="#f87171" style={{ margin: '0 auto 12px', display: 'block', filter: 'drop-shadow(0 0 8px #f8717160)' }} />
            <div style={{ fontSize: 11, fontWeight: 800, color: '#f87171', letterSpacing: '0.15em', marginBottom: 8 }}>
              SCAN FAILED
            </div>
            <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginBottom: 16, lineHeight: 1.5 }}>
              {errorMsg}
            </div>
            <button
              onClick={runScan}
              style={{
                padding: '7px 20px', borderRadius: 4,
                background: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.22)',
                color: '#8b5cf6', cursor: 'pointer', fontSize: 10, fontWeight: 800,
                letterSpacing: '0.14em', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.14)'; e.currentTarget.style.boxShadow = '0 0 12px rgba(139,92,246,0.18)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.07)'; e.currentTarget.style.boxShadow = 'none' }}
            >
              RETRY
            </button>
          </div>
        )}

        {/* ══ NAVIGATING PHASE ══ */}
        {phase === 'navigating' && (
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ position: 'relative', width: 56, height: 56, margin: '0 auto 16px' }}>
              <div style={{ position:'absolute', inset:0, border:'2px solid transparent', borderTopColor: typeColor, borderRadius:'50%', animation:'sx-spin 0.7s linear infinite', boxShadow:`0 0 12px ${typeColor}50` }} />
              <div style={{ position:'absolute', inset:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
                {navTarget === 'investigation' ? <Eye size={16} color={typeColor} />
                  : navTarget === 'forensic-lab' ? <Activity size={16} color={typeColor} />
                  : <FileText size={16} color={typeColor} />}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: typeColor, letterSpacing: '0.18em', marginBottom: 4 }}>
              OPENING {navTarget === 'investigation' ? 'INVESTIGATION' : navTarget === 'forensic-lab' ? 'FORENSIC LAB' : 'LEGAL GENERATOR'}
            </div>
            <div style={{ fontSize: 9, color: '#2a4a65', letterSpacing: '0.12em' }}>Preparing analysis view…</div>
          </div>
        )}

        {/* ══ RESULT PHASE ══ */}
        {phase === 'result' && result && (
          <div style={{ padding: '14px' }}>

            {/* Verdict card */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 14px',
              background: riskColor + '0c',
              border: `1px solid ${riskColor}30`,
              borderRadius: 6, marginBottom: 12,
              position: 'relative', overflow: 'hidden',
            }}>
              <HudCorners color={riskColor + '40'} />

              {/* Icon */}
              {result.risk_level?.toUpperCase().includes('HIGH')
                ? <AlertTriangle size={20} color={riskColor} style={{ flexShrink: 0, filter: `drop-shadow(0 0 6px ${riskColor}80)` }} />
                : result.risk_level?.toUpperCase().includes('LOW')
                  ? <CheckCircle size={20} color={riskColor} style={{ flexShrink: 0, filter: `drop-shadow(0 0 6px ${riskColor}80)` }} />
                  : <Shield size={20} color={riskColor} style={{ flexShrink: 0, filter: `drop-shadow(0 0 6px ${riskColor}80)` }} />
              }

              {/* Verdict text */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 900, color: riskColor, letterSpacing: '0.06em', lineHeight: 1 }}>
                  {result.risk_level || 'UNKNOWN'}
                  {result.confidence_sublevel && (
                    <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.65, marginLeft: 7 }}>
                      ({result.confidence_sublevel})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', marginTop: 4 }}>
                  {result.is_ai_generated ? 'AI-GENERATED CONTENT DETECTED' : 'APPEARS AUTHENTIC'}
                </div>
              </div>

              {/* Probability */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontSize: 22, fontWeight: 900, color: riskColor,
                  fontFamily: 'monospace', lineHeight: 1,
                  textShadow: `0 0 12px ${riskColor}60`,
                }}>
                  {Math.round(prob * 100)}%
                </div>
                <div style={{ fontSize: 8, color: '#475569', letterSpacing: '0.1em', marginTop: 2 }}>
                  AI PROB
                </div>
              </div>
            </div>

            {/* Probability bar */}
            <div style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 8, color: '#2a4a65', letterSpacing: '0.14em', fontWeight: 700 }}>
                  AI-GENERATION PROBABILITY
                </span>
                <span style={{ fontSize: 8, fontFamily: 'monospace', color: riskColor, fontWeight: 700 }}>
                  {Math.round(prob * 100)}%
                </span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.round(prob * 100)}%`,
                  background: `linear-gradient(90deg, ${riskColor}70, ${riskColor})`,
                  borderRadius: 3,
                  transition: 'width 0.9s cubic-bezier(0.16,1,0.3,1)',
                  boxShadow: `0 0 10px ${riskColor}60`,
                }} />
              </div>
            </div>

            {/* Key findings */}
            {exps.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 8, fontWeight: 800, color: '#2a4a65',
                  letterSpacing: '0.16em', marginBottom: 7, textTransform: 'uppercase',
                }}>
                  Key Findings
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {exps.slice(0, 3).map((exp, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 7,
                        padding: '6px 9px', borderRadius: 4,
                        background: 'rgba(0,212,255,0.02)',
                        border: '1px solid rgba(0,212,255,0.07)',
                      }}
                    >
                      <div style={{
                        width: 5, height: 5, borderRadius: '50%',
                        background: riskColor,
                        flexShrink: 0, marginTop: 4,
                        boxShadow: `0 0 5px ${riskColor}80`,
                      }} />
                      <span style={{ fontSize: 10, color: '#6a90b4', lineHeight: 1.45 }}>{exp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audio result card — only shown for video scans */}
            {payload?.type === 'video' && audioResult !== undefined && (
              <AudioResultCard audioResult={audioResult} />
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
              <ActionBtn icon={<Eye size={10} />}      label="INVESTIGATE" color="#8b5cf6" onClick={() => handleNavigate('investigation', result)} />
              <ActionBtn icon={<Activity size={10} />} label="FORENSICS"   color="#8b5cf6" onClick={() => handleNavigate('forensic-lab', result)} />
              <ActionBtn icon={<FileText size={10} />} label="LEGAL"       color="#fbbf24" onClick={() => handleNavigate('legal-generator', result)} />
            </div>
          </div>
        )}

        </div>{/* end scrollable body */}

        {/* ══ BOTTOM STATUS BAR ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '5px 14px',
          borderTop: '1px solid rgba(139,92,246,0.06)',
          background: 'rgba(0,0,0,0.25)',
        }}>
          <div style={{ width: 8, height: 8, borderBottom: `1.5px solid ${riskColor}40`, borderLeft: `1.5px solid ${riskColor}40` }} />
          <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#1a3050', letterSpacing: '0.12em' }}>
            {phase === 'scanning'    ? 'ENTITY-X ENGINE · ANALYZING'
             : phase === 'result'   ? `SCAN COMPLETE · ${new Date().toLocaleTimeString()}`
             : phase === 'navigating' ? 'ENTITY-X · LAUNCHING VIEW'
             : 'SCAN FAILED'
            }
          </span>
          <div style={{ width: 8, height: 8, borderBottom: `1.5px solid ${riskColor}40`, borderRight: `1.5px solid ${riskColor}40` }} />
        </div>
      </div>

      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes sx-fade     { from { opacity: 0 }                                          to { opacity: 1 } }
        @keyframes sx-rise     { from { opacity: 0; transform: translateY(18px) scale(0.96) } to { opacity: 1; transform: none } }
        @keyframes sx-spin     { to   { transform: rotate(360deg) } }
        @keyframes sx-pulse    { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
      `}</style>
    </div>
  )
}
