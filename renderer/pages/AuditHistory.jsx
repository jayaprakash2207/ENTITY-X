import { useState, useEffect } from 'react'
import { Eye, RefreshCw, History, Database, Filter, ChevronUp, ChevronDown, ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react'

const RISK = {
  HIGH:   { color: '#f87171', fillClass: 'prob-fill-high'   },
  MEDIUM: { color: '#fbbf24', fillClass: 'prob-fill-medium' },
  LOW:    { color: '#34d399', fillClass: 'prob-fill-low'    },
}
const PAGE_SIZE = 15

export default function AuditHistory({ onSelectEntity }) {
  const [history,   setHistory]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filters,   setFilters]   = useState({ type: 'all', risk_level: 'all' })
  const [sortBy,    setSortBy]    = useState('detectedAt')   // 'detectedAt' | 'risk' | 'score'
  const [sortDir,   setSortDir]   = useState('desc')         // 'asc' | 'desc'
  const [page,      setPage]      = useState(0)

  useEffect(() => { loadHistory() }, [filters])
  useEffect(() => { setPage(0) }, [sortBy, sortDir, filters])

  const loadHistory = async () => {
    setLoading(true)
    try {
      if (window.entityX?.getHistory) {
        const data = await window.entityX.getHistory(filters)
        const rows = Array.isArray(data) ? data : (data?.records || [])
        setHistory(rows)
      }
    } catch (error) {
      console.error('[AuditHistory] Error loading history:', error)
    } finally {
      setLoading(false)
    }
  }

  /* ── Sort logic ── */
  const riskOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 }
  const sorted = [...history].sort((a, b) => {
    const mult = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'detectedAt') {
      const ta = new Date(a.detected_at || a.detected_timestamp || 0).getTime()
      const tb = new Date(b.detected_at || b.detected_timestamp || 0).getTime()
      return (ta - tb) * mult
    }
    if (sortBy === 'risk') {
      const ra = riskOrder[(a.risk_level || '').toUpperCase()] || 1
      const rb = riskOrder[(b.risk_level || '').toUpperCase()] || 1
      return (ra - rb) * mult
    }
    if (sortBy === 'score') {
      const pa = a.ai_generated_probability ?? a.fake_probability ?? 0
      const pb = b.ai_generated_probability ?? b.fake_probability ?? 0
      return (pa - pb) * mult
    }
    return 0
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const pageData   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return <ChevronDown size={9} style={{ color: '#334155', marginLeft: 3 }} />
    return sortDir === 'desc'
      ? <ChevronDown size={9} style={{ color: '#8b5cf6', marginLeft: 3 }} />
      : <ChevronUp   size={9} style={{ color: '#8b5cf6', marginLeft: 3 }} />
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Header ── */}
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:4, height:28, borderRadius:2, background:'linear-gradient(180deg,#8b5cf6,#8b5cf6)', boxShadow:'0 0 10px rgba(139,92,246,0.5)' }} />
          <div>
            <h1 style={{ fontSize:20, fontWeight:900, letterSpacing:'0.1em', color:'#f1f5f9', textTransform:'uppercase', margin:0 }}>
              Audit History
            </h1>
            <p style={{ fontSize:10, color:'#475569', margin:0 }}>Detection log &amp; analysis records</p>
          </div>
        </div>
        <button onClick={loadHistory}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.18)', borderRadius:5, color:'#8b5cf6', cursor:'pointer', fontSize:11, fontWeight:700, letterSpacing:'0.08em' }}>
          <RefreshCw size={12} /> REFRESH
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <Filter size={13} style={{ color:'#475569' }} />
        <select value={filters.type || 'all'}
          onChange={(e) => setFilters({ ...filters, type: e.target.value === 'all' ? undefined : e.target.value })}
          className="cx-select" style={{ minWidth:140 }}>
          <option value="all">All Types</option>
          <option value="IMAGE">Images</option>
          <option value="VIDEO">Videos</option>
          <option value="AUDIO">Audio</option>
          <option value="TEXT">Articles</option>
        </select>
        <select value={filters.risk_level || 'all'}
          onChange={(e) => setFilters({ ...filters, risk_level: e.target.value === 'all' ? undefined : e.target.value })}
          className="cx-select" style={{ minWidth:160 }}>
          <option value="all">All Risk Levels</option>
          <option value="HIGH">High Risk</option>
          <option value="MEDIUM">Medium Risk</option>
          <option value="LOW">Low Risk</option>
        </select>
        <span style={{ fontSize:10, color:'#475569', marginLeft:'auto' }}>
          {history.length} record{history.length !== 1 ? 's' : ''}
          {totalPages > 1 && ` · page ${page + 1} / ${totalPages}`}
        </span>
      </div>

      {/* ── Table ── */}
      <div style={{ background:'rgba(17,17,32,0.9)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:6, overflow:'hidden' }}>
        <div style={{ padding:'10px 18px', borderBottom:'1px solid rgba(139,92,246,0.08)', display:'flex', alignItems:'center', gap:8 }}>
          <Database size={12} style={{ color:'#8b5cf6' }} />
          <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.14em', color:'#8b5cf6', textTransform:'uppercase' }}>Detection Log</span>
          <span style={{ marginLeft:'auto', fontSize:9, color:'#475569' }}>Click column headers to sort</span>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table className="cx-table" style={{ width:'100%' }}>
            <thead>
              <tr>
                <th onClick={() => handleSort('detectedAt')} style={{ cursor:'pointer', userSelect:'none' }}>
                  <span style={{ display:'inline-flex', alignItems:'center' }}>Timestamp <SortIcon col="detectedAt" /></span>
                </th>
                <th>Type</th>
                <th>Source</th>
                <th onClick={() => handleSort('risk')} style={{ cursor:'pointer', userSelect:'none' }}>
                  <span style={{ display:'inline-flex', alignItems:'center' }}>Risk <SortIcon col="risk" /></span>
                </th>
                <th onClick={() => handleSort('score')} style={{ cursor:'pointer', userSelect:'none' }}>
                  <span style={{ display:'inline-flex', alignItems:'center' }}>AI Score <SortIcon col="score" /></span>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="6" style={{ textAlign:'center', padding:40, color:'#475569' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
                      <RefreshCw size={14} /> Loading records…
                    </div>
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign:'center', padding:52 }}>
                    <History size={32} style={{ margin:'0 auto 10px', display:'block', color:'#334155' }} />
                    <div style={{ fontSize:12, color:'#475569', marginBottom:6 }}>No detection records found</div>
                    <div style={{ fontSize:10, color:'#334155', lineHeight:1.7 }}>
                      Records appear here after browsing with the Entity X browser or<br />
                      analyzing content in the Image / Video / Audio / Text Analyzer.
                    </div>
                  </td>
                </tr>
              ) : pageData.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign:'center', padding:40, color:'#475569', fontSize:11 }}>
                    No records match the current filters.
                  </td>
                </tr>
              ) : (
                pageData.map((item, idx) => {
                  const entityType  = item.entity_type || item.type || 'UNKNOWN'
                  const detectedAt  = item.detected_at || item.detected_timestamp
                  const riskDirect  = (item.risk_level || '').toUpperCase()
                  const analysis    = item.analysis || {}
                  const probability = item.ai_generated_probability ?? item.fake_probability
                    ?? analysis.ai_generated_probability ?? analysis.fake_probability ?? 0
                  const riskLevel   = riskDirect || (probability > 0.7 ? 'HIGH' : probability > 0.4 ? 'MEDIUM' : 'LOW')
                  const risk        = RISK[riskLevel] || RISK.LOW
                  const sourceLabel = item.title || item.source_url || item.url || 'Unknown'
                  return (
                    <tr key={idx} style={{ cursor:'pointer' }} onClick={() => {
                      const a = item.analysis || {}
                      onSelectEntity({
                        ...a, ...item,
                        type: entityType, entity_type: entityType, risk_level: riskLevel,
                        fake_probability: item.fake_probability ?? a.fake_probability,
                        ai_generated_probability: item.ai_generated_probability ?? a.ai_generated_probability,
                        forensic_explanation: item.forensic_explanation || a.forensic_explanation || [],
                        trust_score: item.trust_score ?? a.trust_score ?? a.trust_score_after,
                        source_url: item.source_url || a.source_url || a.image_url || '',
                        image_url: item.image_url || a.image_url || '',
                      })
                    }} title="Click to investigate">
                      <td style={{ fontFamily:'monospace', fontSize:11, color:'#64748b' }}>
                        {detectedAt ? new Date(detectedAt).toLocaleString() : '—'}
                      </td>
                      <td>
                        <span className={entityType === 'IMAGE' ? 'badge-img' : entityType === 'VIDEO' ? 'badge-video' : entityType === 'AUDIO' ? 'badge-audio' : 'badge-txt'}>
                          {entityType}
                        </span>
                      </td>
                      <td style={{ maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color:'#e2e8f0', fontSize:12 }}
                        title={sourceLabel}>
                        {sourceLabel}
                      </td>
                      <td>
                        <span className={`badge-${riskLevel.toLowerCase()}`}
                          style={riskLevel === 'HIGH' ? { animation:'threat-blink 1.8s ease-in-out infinite' } : {}}>
                          {riskLevel}
                        </span>
                      </td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div className="prob-track" style={{ width:70 }}>
                            <div className={risk.fillClass} style={{ width:`${(probability*100).toFixed(0)}%` }} />
                          </div>
                          <span style={{ fontSize:11, fontWeight:700, color:risk.color, minWidth:38 }}>
                            {(probability*100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            const a = item.analysis || {}
                            onSelectEntity({
                              ...a, ...item,
                              type: entityType, entity_type: entityType, risk_level: riskLevel,
                              fake_probability: item.fake_probability ?? a.fake_probability,
                              ai_generated_probability: item.ai_generated_probability ?? a.ai_generated_probability,
                              forensic_explanation: item.forensic_explanation || a.forensic_explanation || [],
                              trust_score: item.trust_score ?? a.trust_score ?? a.trust_score_after,
                              source_url: item.source_url || a.source_url || a.image_url || '',
                              image_url: item.image_url || a.image_url || '',
                            })
                          }}
                          style={{ padding:'5px 7px', background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.18)', borderRadius:5, cursor:'pointer', color:'#8b5cf6' }}
                          title="Investigate">
                          <Eye size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'10px 18px', borderTop:'1px solid rgba(139,92,246,0.08)',
          }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:5, cursor: page === 0 ? 'not-allowed' : 'pointer', background:'rgba(139,92,246,0.05)', border:'1px solid rgba(139,92,246,0.12)', color: page === 0 ? '#334155' : '#8b5cf6', fontSize:10, fontWeight:700, opacity: page === 0 ? 0.4 : 1 }}>
              <ChevronLeft size={11} /> PREV
            </button>
            <div style={{ display:'flex', gap:4 }}>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  style={{
                    width:26, height:26, borderRadius:4, border:'1px solid',
                    cursor:'pointer', fontSize:10, fontWeight:700,
                    background: i === page ? 'rgba(139,92,246,0.12)' : 'transparent',
                    borderColor: i === page ? 'rgba(139,92,246,0.38)' : 'rgba(255,255,255,0.06)',
                    color: i === page ? '#8b5cf6' : '#475569',
                  }}>
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:5, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', background:'rgba(139,92,246,0.05)', border:'1px solid rgba(139,92,246,0.12)', color: page >= totalPages - 1 ? '#334155' : '#8b5cf6', fontSize:10, fontWeight:700, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
              NEXT <ChevronRightIcon size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
