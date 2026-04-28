import { useState, useEffect } from 'react'
import { Globe, RefreshCw, TrendingUp, AlertTriangle, Shield, Search } from 'lucide-react'

function repColor(score) {
  if (score >= 70) return '#34d399'
  if (score >= 40) return '#fbbf24'
  return '#f87171'
}

function repLabel(score) {
  if (score >= 80) return 'TRUSTED'
  if (score >= 60) return 'FAIR'
  if (score >= 40) return 'RISKY'
  return 'DANGEROUS'
}

const S = {
  page: { minHeight: '100%', color: '#c8d8e8' },
  header: { marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 14 },
  headerIcon: { width: 40, height: 40, borderRadius: 8, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' },
  sub: { fontSize: 11, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },
  panel: { background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '18px 20px', marginBottom: 16 },
  panelTitle: { fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 14 },
  input: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 12px', color: '#e2e8f0', fontSize: 12, outline: 'none', width: '100%' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { fontSize: 9, fontWeight: 700, color: '#334155', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  td: { padding: '10px 10px', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.04)' },
}

export default function DomainReputation() {
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const data = await window.entityX.domainReputation()
      setDomains(data || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = domains.filter(d => !search || d.domain.toLowerCase().includes(search.toLowerCase()))

  const stats = {
    total: domains.length,
    dangerous: domains.filter(d => d.reputation_score < 40).length,
    risky: domains.filter(d => d.reputation_score >= 40 && d.reputation_score < 70).length,
    trusted: domains.filter(d => d.reputation_score >= 70).length,
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerIcon}><Globe size={18} color="#8b5cf6" /></div>
        <div style={{ flex: 1 }}>
          <div style={S.title}>Domain Reputation</div>
          <div style={S.sub}>Per-domain risk intelligence from your scan history</div>
        </div>
        <button onClick={load} style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 7, padding: '7px 12px', color: '#a78bfa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600 }}>
          <RefreshCw size={12} />Refresh
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Total Domains', value: stats.total, color: '#8b5cf6' },
          { label: 'Trusted', value: stats.trusted, color: '#34d399' },
          { label: 'Risky', value: stats.risky, color: '#fbbf24' },
          { label: 'Dangerous', value: stats.dangerous, color: '#f87171' },
        ].map(({ label, value, color }) => (
          <div key={label} style={S.panel}>
            <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={S.panel}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={S.panelTitle}>Domain Intelligence Table</div>
          <div style={{ marginLeft: 'auto', position: 'relative', width: 220 }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
            <input style={{ ...S.input, paddingLeft: 28 }} placeholder="Filter domains…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#475569', fontSize: 12 }}>Loading domain data…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <Shield size={32} color="rgba(139,92,246,0.15)" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontSize: 12, color: '#334155' }}>No domain data yet. Browse with Live Monitor to build your domain reputation database.</div>
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['Domain', 'Rep. Score', 'Total Scans', 'High Risk', 'Risk %', 'Avg Prob', 'Types', 'Last Seen'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, i) => {
                const rc = repColor(d.reputation_score)
                const rl = repLabel(d.reputation_score)
                return (
                  <tr key={d.domain} style={{ background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'}
                  >
                    <td style={{ ...S.td, color: '#e2e8f0', fontWeight: 600, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Globe size={11} color="#475569" />
                        {d.domain}
                      </div>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: `${rc}18`, border: `1px solid ${rc}40`, borderRadius: 5, padding: '3px 8px' }}>
                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: rc }} />
                        <span style={{ color: rc, fontSize: 10, fontWeight: 800, letterSpacing: '0.1em' }}>{rl}</span>
                        <span style={{ color: '#475569', fontSize: 10 }}>{d.reputation_score}</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, color: '#8b5cf6', fontWeight: 700 }}>{d.total_scans}</td>
                    <td style={{ ...S.td, color: d.high_risk > 0 ? '#f87171' : '#475569', fontWeight: d.high_risk > 0 ? 700 : 400 }}>{d.high_risk}</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', minWidth: 40 }}>
                          <div style={{ width: `${d.high_risk_pct}%`, height: '100%', background: d.high_risk_pct > 50 ? '#f87171' : d.high_risk_pct > 20 ? '#fbbf24' : '#34d399', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 11, color: d.high_risk_pct > 50 ? '#f87171' : d.high_risk_pct > 20 ? '#fbbf24' : '#34d399', fontWeight: 700, minWidth: 32 }}>{d.high_risk_pct}%</span>
                      </div>
                    </td>
                    <td style={{ ...S.td, color: d.avg_risk_prob > 0.6 ? '#f87171' : d.avg_risk_prob > 0.35 ? '#fbbf24' : '#94a3b8' }}>{(d.avg_risk_prob * 100).toFixed(1)}%</td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {d.types.map(t => (
                          <span key={t} style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', letterSpacing: '0.08em', fontWeight: 700 }}>{t}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ ...S.td, fontSize: 10, color: '#334155' }}>{d.last_seen ? new Date(d.last_seen).toLocaleDateString() : '—'}</td>
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
