import { Activity, AlertTriangle, TrendingUp, Shield, Zap, Clock } from 'lucide-react'

function riskOf(p) { return p > 0.7 ? 'HIGH' : p > 0.4 ? 'MEDIUM' : 'LOW' }

function getProb(d) {
  return d.type === 'IMAGE' ? d.data.fake_probability
    : d.data.ai_generated_probability ?? d.data.fake_probability ?? 0
}

/* ── SVG Donut Chart ── */
function DonutChart({ high, medium, low }) {
  const total = high + medium + low
  const R = 36, C = 2 * Math.PI * R

  if (total === 0) {
    return (
      <svg width={100} height={100} viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={9} />
        <text x={50} y={47} textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="monospace" fill="#334155">0</text>
        <text x={50} y={59} textAnchor="middle" fontSize="7" fill="#1e293b" letterSpacing="0.1em">NO DATA</text>
      </svg>
    )
  }

  const highLen = (high / total) * C
  const medLen  = (medium / total) * C
  const lowLen  = (low / total) * C
  const GAP = total > 1 ? 3 : 0
  const highOff = 0
  const medOff  = -(highLen + GAP)
  const lowOff  = -(highLen + medLen + GAP * 2)

  const seg = (len, color, offset) => (
    <circle
      cx={50} cy={50} r={R}
      fill="none"
      stroke={color}
      strokeWidth={9}
      strokeDasharray={`${Math.max(0, len - GAP)} ${C}`}
      strokeDashoffset={offset}
      strokeLinecap="round"
      transform="rotate(-90 50 50)"
      style={{ transition: 'stroke-dasharray 0.6s ease' }}
    />
  )

  return (
    <svg width={100} height={100} viewBox="0 0 100 100">
      <circle cx={50} cy={50} r={R} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={9} />
      {lowLen  > 0 && seg(lowLen,  '#34d399', lowOff)}
      {medLen  > 0 && seg(medLen,  '#fbbf24', medOff)}
      {highLen > 0 && seg(highLen, '#f87171', highOff)}
      <text x={50} y={47} textAnchor="middle" fontSize="16" fontWeight="700" fontFamily="monospace" fill="#e2e8f0">{total}</text>
      <text x={50} y={59} textAnchor="middle" fontSize="7" fill="#475569" letterSpacing="0.1em">SCANNED</text>
    </svg>
  )
}

function LegendDot({ color, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 9, color: '#475569' }}>{label}</span>
    </div>
  )
}

export default function LiveMonitor({ detections = [], onSelectEntity }) {
  const highCount = detections.filter(d => riskOf(getProb(d)) === 'HIGH').length
  const medCount  = detections.filter(d => riskOf(getProb(d)) === 'MEDIUM').length
  const lowCount  = detections.filter(d => riskOf(getProb(d)) === 'LOW').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Page Header ── */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 5 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Activity size={16} color="#a78bfa" />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
              Live Monitor
            </h1>
            <p style={{ fontSize: 12, color: '#475569', marginTop: 1 }}>
              Real-time AI-generated content detection
            </p>
          </div>
          <div style={{
            marginLeft: 'auto',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 20,
            background: 'rgba(52,211,153,0.08)',
            border: '1px solid rgba(52,211,153,0.2)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px rgba(52,211,153,0.6)' }} />
            <span style={{ fontSize: 11, fontWeight: 500, color: '#34d399' }}>Monitoring Active</span>
          </div>
        </div>
      </div>

      {/* ── Stats + Donut ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 140px', gap: 12, alignItems: 'stretch' }}>
        <StatCard icon={<Activity size={16} />}      label="Total Scanned" value={detections.length} accent="#8b5cf6" />
        <StatCard icon={<AlertTriangle size={16} />} label="High Risk"     value={highCount}         accent="#f87171" blink={highCount > 0} />
        <StatCard icon={<TrendingUp size={16} />}    label="Medium Risk"   value={medCount}          accent="#fbbf24" />
        <StatCard icon={<Shield size={16} />}        label="Low / Safe"    value={lowCount}          accent="#34d399" />

        {/* Donut card */}
        <div style={{
          background: 'rgba(17,17,32,0.9)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 10, padding: '10px 8px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <DonutChart high={highCount} medium={medCount} low={lowCount} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <LegendDot color="#f87171" label="High" />
            <LegendDot color="#fbbf24" label="Med" />
            <LegendDot color="#34d399" label="Low" />
          </div>
        </div>
      </div>

      {/* ── Detection Table ── */}
      <div style={{
        background: 'rgba(17,17,32,0.9)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Zap size={13} style={{ color: '#8b5cf6' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
            Recent Detections
          </span>
          {detections.length > 0 && (
            <span style={{
              marginLeft: 4, fontSize: 11, padding: '1px 8px', borderRadius: 20,
              background: 'rgba(139,92,246,0.1)', color: '#a78bfa',
              border: '1px solid rgba(139,92,246,0.2)',
            }}>{detections.length}</span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>Click a row to investigate</span>
        </div>

        {detections.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '56px 20px', gap: 12,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Activity size={22} style={{ color: '#6d28d9' }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
              No detections yet
            </p>
            <p style={{ fontSize: 12, color: '#334155', textAlign: 'center', maxWidth: 360, lineHeight: 1.65 }}>
              Browse the web in the Entity X browser or paste a URL into Image / Video / Audio / Text Analyzer to start detecting.
            </p>
          </div>
        ) : (
          <table className="cx-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Source</th>
                <th>Risk</th>
                <th>AI Score</th>
              </tr>
            </thead>
            <tbody>
              {detections.slice(0, 20).map((detection, idx) => {
                const { type, data, timestamp } = detection
                const probability = getProb(detection)
                const risk = riskOf(probability)
                const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                return (
                  <tr
                    key={idx}
                    style={{ cursor: 'pointer' }}
                    onClick={() => onSelectEntity(data)}
                    title="Click to open Investigation"
                  >
                    <td>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={10} /> {time}
                      </span>
                    </td>
                    <td>
                      <span className={type === 'IMAGE' ? 'badge-img' : type === 'VIDEO' ? 'badge-video' : type === 'AUDIO' ? 'badge-audio' : 'badge-txt'}
                        style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px' }}>
                        {type}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 11, fontFamily: 'monospace', color: '#64748b',
                        maxWidth: 280, display: 'block', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                        title={type === 'IMAGE' ? (data.source_url || data.image_url) : (data.title || 'Article')}
                      >
                        {type === 'IMAGE' ? (data.source_url || data.image_url) : (data.title || 'Article')}
                      </span>
                    </td>
                    <td>
                      <span
                        className={risk === 'HIGH' ? 'badge-high threat-blink' : risk === 'MEDIUM' ? 'badge-medium' : 'badge-low'}
                        style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px' }}
                      >
                        {risk}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 90 }}>
                        <div className="prob-track" style={{ flex: 1 }}>
                          <div
                            className={risk === 'HIGH' ? 'prob-fill-high' : risk === 'MEDIUM' ? 'prob-fill-medium' : 'prob-fill-low'}
                            style={{ width: `${probability * 100}%` }}
                          />
                        </div>
                        <span style={{
                          fontSize: 11, fontWeight: 700, fontFamily: 'monospace', minWidth: 38, textAlign: 'right',
                          color: risk === 'HIGH' ? '#f87171' : risk === 'MEDIUM' ? '#fbbf24' : '#34d399',
                        }}>
                          {(probability * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, accent, blink }) {
  return (
    <div style={{
      background: 'rgba(17,17,32,0.9)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, padding: '14px 16px',
      position: 'relative', overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 80, height: 80,
        background: `radial-gradient(circle at top right, ${accent}14, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 11, color: '#475569', fontWeight: 500, marginBottom: 8 }}>
            {label}
          </p>
          <p style={{
            fontSize: 30, fontWeight: 700, fontFamily: 'monospace',
            color: accent, lineHeight: 1,
          }} className={blink ? 'threat-blink' : ''}>
            {value}
          </p>
        </div>
        <div style={{
          width: 34, height: 34, borderRadius: 8,
          background: `${accent}15`,
          border: `1px solid ${accent}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent, opacity: 0.9,
        }}>
          {icon}
        </div>
      </div>
    </div>
  )
}
