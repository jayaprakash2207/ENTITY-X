import { useRef, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Cpu, Eye, Image, FileText, Video, Mic } from 'lucide-react'

const RISK = {
  HIGH:   { label: 'HIGH', cls: 'badge-high',   bar: 'prob-fill-high',   color: '#f87171', border: 'rgba(248,113,113,0.3)'  },
  MEDIUM: { label: 'MED',  cls: 'badge-medium', bar: 'prob-fill-medium', color: '#fbbf24', border: 'rgba(251,191,36,0.3)'   },
  LOW:    { label: 'LOW',  cls: 'badge-low',    bar: 'prob-fill-low',    color: '#34d399', border: 'rgba(52,211,153,0.25)'  },
}

function riskOf(p) {
  return p > 0.7 ? 'HIGH' : p > 0.4 ? 'MEDIUM' : 'LOW'
}

/** Stable, unique key for a detection — prefers entity_id, falls back to URL, then timestamp. */
function detectionKey(detection) {
  return (
    detection.data?.entity_id  ||
    detection.data?.image_url  ||
    detection.data?.video_url  ||
    detection.data?.audio_url  ||
    detection.data?.url        ||
    detection.timestamp
  )
}

export default function DetectionFeed({ detections, onSelectDetection }) {
  const [expanded, setExpanded] = useState(true)
  const scrollRef = useRef(null)

  const highCount = detections.filter(d => {
    const p = d.type === 'IMAGE' || d.type === 'VIDEO' || d.type === 'AUDIO'
      ? d.data.fake_probability
      : d.data.ai_generated_probability
    return p > 0.7
  }).length

  // Auto-scroll to the newest detection (left edge) when a new one arrives
  useEffect(() => {
    if (expanded && scrollRef.current && detections.length > 0) {
      scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }, [detections.length, expanded])

  if (!expanded) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label="Expand detection feed"
        onClick={() => setExpanded(true)}
        onKeyDown={e => e.key === 'Enter' && setExpanded(true)}
        style={{
          height: 40,
          background: 'rgba(8,8,18,0.98)',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Cpu size={12} style={{ color: '#8b5cf6' }} aria-hidden="true" />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Detection Feed</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 20,
            background: 'rgba(139,92,246,0.1)', color: '#a78bfa',
            border: '1px solid rgba(139,92,246,0.2)',
          }}>{detections.length}</span>
          {highCount > 0 && (
            <span className="badge-high" style={{ fontSize: 10, fontWeight: 600, padding: '1px 8px' }}>
              {highCount} HIGH
            </span>
          )}
        </div>
        <ChevronUp size={14} style={{ color: '#475569' }} aria-hidden="true" />
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label="Live detection feed"
      style={{
        height: 195,
        background: 'rgba(8,8,18,0.98)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Cpu size={13} style={{ color: '#8b5cf6' }} aria-hidden="true" />
          <span style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0' }}>Detection Feed</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 8px', borderRadius: 20,
            background: 'rgba(139,92,246,0.1)', color: '#a78bfa',
            border: '1px solid rgba(139,92,246,0.2)',
          }}>{detections.length}</span>
          {highCount > 0 && (
            <span className="badge-high threat-blink" style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px' }}>
              ⚠ {highCount} THREAT{highCount > 1 ? 'S' : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded(false)}
          aria-label="Collapse detection feed"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2 }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Cards */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowX: 'auto', overflowY: 'hidden',
          display: 'flex', gap: 8, padding: '8px 12px',
          alignItems: 'stretch',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(139,92,246,0.3) transparent',
        }}
      >
        {detections.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Eye size={22} style={{ color: '#1e293b' }} aria-hidden="true" />
            <span style={{ fontSize: 11, color: '#334155' }}>
              Awaiting detections — monitoring active
            </span>
          </div>
        ) : (
          detections.map(detection => (
            <DetectionCard
              key={detectionKey(detection)}
              detection={detection}
              onSelect={() => onSelectDetection(detection.data)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function DetectionCard({ detection, onSelect }) {
  const { type, data, timestamp } = detection

  const probability = type === 'IMAGE' || type === 'VIDEO' || type === 'AUDIO'
    ? data.fake_probability
    : data.ai_generated_probability

  const risk = riskOf(probability)
  const { cls, bar, color, border } = RISK[risk]
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const [imgFailed, setImgFailed] = useState(false)
  const [hovered, setHovered]     = useState(false)

  const typeConfig = {
    IMAGE: { icon: Image,    color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.2)'  },
    TEXT:  { icon: FileText, color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)'  },
    VIDEO: { icon: Video,    color: '#fb923c', bg: 'rgba(251,146,60,0.08)', border: 'rgba(251,146,60,0.2)'  },
    AUDIO: { icon: Mic,      color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.2)'  },
  }

  const typeStyle = typeConfig[type] || typeConfig.TEXT
  const TypeIcon  = typeStyle.icon

  const fullText = type === 'IMAGE'
    ? (data.image_url  || data.source_url || '—')
    : type === 'VIDEO'
    ? (data.video_url  || data.source_url || '—')
    : type === 'AUDIO'
    ? (data.audio_url  || data.source_url || '—')
    : (data.title      || data.content_title || 'Analyzed Article')

  const riskLabel = `${type} detected — ${RISK[risk].label} risk, ${(probability * 100).toFixed(1)}% AI confidence`

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={riskLabel}
      onClick={onSelect}
      onKeyDown={e => e.key === 'Enter' && onSelect()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="animate-slide-in"
      style={{
        width: 192, minWidth: 192, height: '100%',
        background: hovered ? 'rgba(22,22,38,0.98)' : 'rgba(17,17,30,0.95)',
        border: `1px solid ${hovered ? border : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        padding: '8px 10px',
        display: 'flex', flexDirection: 'column', gap: 5,
        boxShadow: hovered ? `0 4px 20px rgba(0,0,0,0.4),0 0 0 1px ${border}` : 'none',
        transition: 'all 0.18s',
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
        outline: 'none',
      }}
    >
      {/* Top shimmer line on hover */}
      <div style={{
        position: 'absolute', top: 0, left: hovered ? '10%' : '50%',
        width: hovered ? '80%' : '0%',
        height: 2,
        background: `linear-gradient(90deg,transparent,${color},transparent)`,
        transition: 'all 0.35s cubic-bezier(0.16,1,0.3,1)',
        borderRadius: '0 0 2px 2px',
      }} />

      {/* Top row: type + risk badge + time */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '2px 6px', borderRadius: 4,
          background: typeStyle.bg, border: `1px solid ${typeStyle.border}`,
        }}>
          <TypeIcon size={8} color={typeStyle.color} aria-hidden="true" />
          <span style={{ fontSize: 8, fontWeight: 700, color: typeStyle.color, letterSpacing: '0.06em' }}>
            {type}
          </span>
        </div>
        <span className={cls} style={{ fontSize: 8, fontWeight: 700, padding: '2px 6px', letterSpacing: '0.06em' }}>
          {RISK[risk].label}
        </span>
        <span style={{ fontSize: 9, color: '#334155', marginLeft: 'auto', fontFamily: 'monospace' }}>
          {time}
        </span>
      </div>

      {/* Thumbnail / icon area */}
      {type === 'IMAGE' && data.image_url && !imgFailed ? (
        <div style={{ position: 'relative', width: '100%', height: 56, borderRadius: 5, overflow: 'hidden' }}>
          <img
            src={data.image_url}
            alt=""
            onError={() => setImgFailed(true)}
            style={{
              width: '100%', height: '100%', objectFit: 'cover',
              filter: risk === 'HIGH' ? 'saturate(0.3) brightness(0.85)' : 'none',
              transition: 'filter 0.3s',
            }}
          />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg,transparent 50%,rgba(0,0,0,0.5) 100%)',
          }} />
        </div>
      ) : (
        <div style={{
          width: '100%', height: 56, borderRadius: 5,
          background: typeStyle.bg, border: `1px solid ${typeStyle.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <TypeIcon size={14} color={typeStyle.color} style={{ opacity: 0.6 }} aria-hidden="true" />
          <span style={{ fontSize: 8, color: typeStyle.color, opacity: 0.6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {type === 'IMAGE' ? 'VISUAL' : type === 'VIDEO' ? 'VIDEO' : type === 'AUDIO' ? 'AUDIO' : 'ARTICLE'}
          </span>
          {type === 'VIDEO' && data.frames_analysed > 0 && (
            <span style={{ fontSize: 7, color: typeStyle.color, opacity: 0.5 }}>
              ({data.frames_analysed} frames)
            </span>
          )}
          {type === 'AUDIO' && data.duration_seconds > 0 && (
            <span style={{ fontSize: 7, color: typeStyle.color, opacity: 0.5 }}>
              ({data.duration_seconds.toFixed(1)}s)
            </span>
          )}
        </div>
      )}

      {/* Confidence score */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: '#334155', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            AI Confidence
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color }}>
            {(probability * 100).toFixed(1)}%
          </span>
        </div>
        <div className="prob-track" role="progressbar" aria-valuenow={Math.round(probability * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className={bar} style={{ width: `${probability * 100}%`, transition: 'width 0.6s ease' }} />
        </div>
      </div>

      {/* URL / title */}
      <p style={{
        fontSize: 9, color: '#334155', fontFamily: 'monospace',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        lineHeight: 1.3, margin: 0,
      }} title={fullText}>
        {fullText}
      </p>

      {/* CTA */}
      <div style={{
        paddingTop: 4,
        borderTop: `1px solid ${hovered ? border : 'rgba(255,255,255,0.05)'}`,
        transition: 'border-color 0.2s',
      }}>
        <span style={{
          fontSize: 9, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: hovered ? color : '#334155',
          transition: 'color 0.18s',
        }}>
          Investigate →
        </span>
      </div>
    </div>
  )
}
