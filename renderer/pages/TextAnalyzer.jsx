import { useState } from 'react'
import { Search, FileText, Loader, AlertTriangle, Shield, Download, Gavel, Globe, ChevronRight, Image, Video, Music, LayoutGrid, Radio, ExternalLink, CheckCircle, XCircle, HelpCircle, Newspaper } from 'lucide-react'

const S = {
  page: {
    minHeight: '100%',
    color: '#c8d8e8',
  },
  header: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  headerIcon: {
    width: 40, height: 40,
    borderRadius: 8,
    background: 'rgba(0,212,255,0.1)',
    border: '1px solid rgba(139,92,246,0.32)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 0 18px rgba(139,92,246,0.18)',
  },
  title: { fontSize: 18, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.06em' },
  sub:   { fontSize: 11, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 },

  panel: {
    background: 'rgba(17,17,32,0.9)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '18px 20px',
    marginBottom: 16,
  },
  panelTitle: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
    textTransform: 'uppercase', color: '#8b5cf6',
    marginBottom: 14, borderBottom: '1px solid rgba(0,212,255,0.1)',
    paddingBottom: 8,
  },

  tabRow: { display: 'flex', gap: 4, marginBottom: 16 },
  tab: (active) => ({
    padding: '6px 16px', borderRadius: 6, fontSize: 10, fontWeight: 700,
    letterSpacing: '0.1em', textTransform: 'uppercase', cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(139,92,246,0.38)' : 'rgba(0,212,255,0.1)'}`,
    background: active ? 'rgba(0,212,255,0.1)' : 'transparent',
    color: active ? '#8b5cf6' : '#475569',
    transition: 'all 0.15s',
  }),

  input: {
    width: '100%', background: 'rgba(139,92,246,0.04)',
    border: '1px solid rgba(0,212,255,0.18)', borderRadius: 7,
    padding: '9px 12px', color: '#c8d8e8', fontSize: 12,
    outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%', minHeight: 160, resize: 'vertical',
    background: 'rgba(139,92,246,0.04)',
    border: '1px solid rgba(0,212,255,0.18)', borderRadius: 7,
    padding: '9px 12px', color: '#c8d8e8', fontSize: 12,
    outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box',
    lineHeight: 1.6,
  },
  label: { fontSize: 10, fontWeight: 700, color: '#3d7aaa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5, display: 'block' },

  btn: (color = '#8b5cf6', disabled = false) => ({
    display: 'flex', alignItems: 'center', gap: 7,
    padding: '9px 18px', borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
    border: `1px solid ${disabled ? 'rgba(100,120,150,0.2)' : `rgba(${colorRgb(color)},0.4)`}`,
    background: disabled ? 'rgba(100,120,150,0.06)' : `rgba(${colorRgb(color)},0.1)`,
    color: disabled ? '#475569' : color,
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
    transition: 'all 0.18s',
    opacity: disabled ? 0.6 : 1,
  }),

  errorBox: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 14px', borderRadius: 7,
    background: 'rgba(255,45,85,0.08)', border: '1px solid rgba(255,45,85,0.25)',
    color: '#ff6680', fontSize: 12,
    marginBottom: 14,
  },

  resultSection: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
    marginBottom: 16,
  },

  scoreCard: {
    background: 'rgba(4,15,35,0.98)',
    border: '1px solid rgba(0,212,255,0.1)',
    borderRadius: 8, padding: '14px 16px',
  },
  scoreLabel: { fontSize: 9, fontWeight: 700, color: '#475569', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 },
  scoreValue: (color) => ({ fontSize: 22, fontWeight: 900, color, letterSpacing: '0.04em', lineHeight: 1 }),

  trackOuter: { height: 5, background: 'rgba(255,255,255,0.07)', borderRadius: 3, marginTop: 8, overflow: 'hidden' },
  trackFill: (pct, color) => ({ height: '100%', width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }),

  badge: (risk) => {
    const map = { HIGH: ['rgba(255,45,85,0.15)', '#f87171', 'rgba(255,45,85,0.35)'], MEDIUM: ['rgba(255,170,0,0.12)', '#fbbf24', 'rgba(255,170,0,0.3)'], LOW: ['rgba(0,255,149,0.08)', '#34d399', 'rgba(0,255,149,0.25)'] }
    const [bg, text, border] = map[risk] || map.LOW
    return { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 4, background: bg, border: `1px solid ${border}`, color: text, fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }
  },

  findingItem: {
    display: 'flex', gap: 10, padding: '8px 12px',
    background: 'rgba(139,92,246,0.04)', borderLeft: '2px solid rgba(139,92,246,0.28)',
    borderRadius: '0 5px 5px 0', marginBottom: 6, fontSize: 12, color: '#8ab8d8', lineHeight: 1.5,
  },
  findingNum: { fontSize: 10, fontWeight: 700, color: '#3d7aaa', flexShrink: 0, marginTop: 2, minWidth: 16 },

  claimItem: {
    display: 'flex', gap: 8, padding: '7px 11px',
    background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
    borderRadius: 5, marginBottom: 5, fontSize: 12, color: '#b8a0e8', lineHeight: 1.5,
  },
  claimTag: {
    fontSize: 9, fontWeight: 800, color: '#8b5cf6',
    background: 'rgba(139,92,246,0.15)', padding: '1px 5px', borderRadius: 3,
    flexShrink: 0, marginTop: 2, height: 'fit-content',
  },

  summaryBox: {
    background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 6, padding: '12px 14px', fontSize: 12, color: '#8ab8d8', lineHeight: 1.7,
  },

  actionRow: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(139,92,246,0.08)' },

  loadingOverlay: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '40px 20px',
    color: '#3d7aaa', fontSize: 13,
  },
}

function colorRgb(hex) {
  if (hex === '#8b5cf6') return '139,92,246'
  if (hex === '#f87171') return '255,45,85'
  if (hex === '#fbbf24') return '255,170,0'
  if (hex === '#34d399') return '0,255,149'
  return '0,212,255'
}

function riskColor(risk) {
  if (risk === 'HIGH') return '#f87171'
  if (risk === 'MEDIUM') return '#fbbf24'
  return '#34d399'
}

function probColor(p) {
  if (p >= 0.7) return '#f87171'
  if (p >= 0.4) return '#fbbf24'
  return '#34d399'
}

function credColor(c) {
  if (c >= 0.7) return '#34d399'
  if (c >= 0.4) return '#fbbf24'
  return '#f87171'
}

export default function TextAnalyzer({ onSelectEntity, onNavigate }) {
  const [inputMode, setInputMode]   = useState('paste')  // 'paste' | 'url'
  const [text, setText]             = useState('')
  const [title, setTitle]           = useState('')
  const [url, setUrl]               = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [result, setResult]         = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfStatus, setPdfStatus]   = useState(null)

  // ── Web Verification state ──
  const [webQuery,   setWebQuery]   = useState('')
  const [webLoading, setWebLoading] = useState(false)
  const [webResult,  setWebResult]  = useState(null)
  const [webError,   setWebError]   = useState(null)

  const handleWebSearch = async (overrideQuery) => {
    const q = (overrideQuery || webQuery).trim()
    if (!q) return
    setWebLoading(true)
    setWebResult(null)
    setWebError(null)
    try {
      const res = await window.entityX.webSearch({ query: q })
      if (res?.success) setWebResult(res)
      else setWebError(res?.error || 'Search failed — check your internet connection.')
    } catch (e) {
      setWebError(e.message)
    } finally {
      setWebLoading(false)
    }
  }

  // Auto-fill web query when forensic result arrives
  const autoFillWebQuery = (entity) => {
    const q = entity?.content_title || entity?.title || entity?.url || ''
    if (q) setWebQuery(q.substring(0, 200))
  }

  const canSubmit = inputMode === 'paste'
    ? text.trim().length >= 50
    : url.trim().startsWith('http')

  const handleAnalyze = async () => {
    setError(null)
    setResult(null)
    setLoading(true)
    setPdfStatus(null)
    try {
      let res
      if (inputMode === 'paste') {
        res = await window.entityX.analyzeText({ text: text.trim(), title: title.trim() || undefined })
      } else {
        res = await window.entityX.analyzeUrl(url.trim())
      }
      if (res?.success && res.entity) {
        setResult(res.entity)
        autoFillWebQuery(res.entity)
      } else {
        setError(res?.error || 'Analysis failed. Make sure the app backend is running.')
      }
    } catch (e) {
      setError(e.message || 'Unexpected error during analysis.')
    } finally {
      setLoading(false)
    }
  }

  const handleExportPdf = async () => {
    if (!result) return
    setPdfLoading(true)
    setPdfStatus(null)
    try {
      const res = await window.entityX.exportPdf({
        entity_id: result.entity_id,
        entity_type: result.entity_type || 'TEXT',
        content_title: result.content_title,
        source_url: result.url || 'manual://input',
        risk_level: result.misinformation_risk || result.risk_level,
        ai_generated_probability: result.ai_generated_probability,
        fake_probability: result.ai_generated_probability,
        credibility_score: result.credibility_score,
        trust_score: result.trust_score,
        trust_score_delta: result.trust_score_delta,
        forensic_explanation: result.explanation || result.forensic_explanation || [],
        key_claims: result.key_claims || [],
        ai_summary: result.ai_summary,
        topic: result.topic,
        detected_at: result.detected_at || Date.now(),
        word_count: result.word_count,
      })
      if (res?.success) setPdfStatus(`Saved: ${res.path}`)
      else if (res?.canceled) setPdfStatus(null)
      else setPdfStatus(`Error: ${res?.error || 'Unknown error'}`)
    } catch (e) {
      setPdfStatus(`Error: ${e.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const handleOpenInvestigation = () => {
    if (result && onSelectEntity) onSelectEntity(result)
  }

  const handleGoLegal = () => {
    if (onNavigate) onNavigate('legal-generator', result)
  }

  const entity = result
  const aiProb = entity ? (entity.ai_generated_probability ?? 0) : 0
  const credScore = entity ? (entity.credibility_score ?? 0) : 0
  const trustScore = entity ? (entity.trust_score ?? 100) : 100
  const risk = entity ? (entity.misinformation_risk || 'LOW').toUpperCase() : 'LOW'
  const findings = entity ? (entity.explanation || entity.forensic_explanation || []) : []
  const claims   = entity ? (entity.key_claims || []) : []
  const media    = entity?.article_media || null

  // Compute overall article risk across text + all media
  const riskRank = { HIGH: 3, MEDIUM: 2, LOW: 1 }
  const overallRisk = (() => {
    if (!media) return risk
    const all = [
      risk,
      ...( media.images.map(i => (i.risk_level || 'LOW').toUpperCase()) ),
      ...( media.videos.map(v => (v.risk_level || 'LOW').toUpperCase()) ),
      ...( media.audio.map(a  => (a.risk_level || 'LOW').toUpperCase()) ),
    ]
    return all.reduce((best, r) => riskRank[r] > riskRank[best] ? r : best, 'LOW')
  })()

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerIcon}>
          <FileText size={18} color="#8b5cf6" />
        </div>
        <div>
          <div style={S.title}>Text &amp; Article Analyzer</div>
          <div style={S.sub}>Forensic AI analysis — paste text or enter a URL</div>
        </div>
      </div>

      {/* Input Panel */}
      <div style={S.panel}>
        <div style={S.panelTitle}>Input</div>

        {/* Mode tabs */}
        <div style={S.tabRow}>
          <button style={S.tab(inputMode === 'paste')} onClick={() => setInputMode('paste')}>
            <FileText size={10} style={{ display: 'inline', marginRight: 5 }} />
            Paste Text
          </button>
          <button style={S.tab(inputMode === 'url')} onClick={() => setInputMode('url')}>
            <Globe size={10} style={{ display: 'inline', marginRight: 5 }} />
            Analyze URL
          </button>
        </div>

        {inputMode === 'paste' ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Article Title (optional)</label>
              <input
                style={S.input}
                placeholder="e.g. Breaking: Scientists Discover New Planet…"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label style={S.label}>Article / Text Content</label>
              <textarea
                style={S.textarea}
                placeholder="Paste the full article, news story, social post, or any text content here (min. 50 characters)…"
                value={text}
                onChange={e => setText(e.target.value)}
              />
              <div style={{ fontSize: 10, color: text.trim().length >= 50 ? '#475569' : '#fbbf24', marginTop: 4, display: 'flex', gap: 10 }}>
                <span>{text.split(/\s+/).filter(w => w.length > 0).length} words</span>
                {text.trim().length < 50 && (
                  <span style={{ color: '#fbbf24' }}>· {50 - text.trim().length} more characters needed</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <div>
            <label style={S.label}>Article URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...S.input, flex: 1 }}
                placeholder="https://example.com/article"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canSubmit && !loading && handleAnalyze()}
              />
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
              The page will be loaded, and all text, images, video &amp; audio will be extracted and analyzed.
            </div>
          </div>
        )}

        {error && (
          <div style={{ ...S.errorBox, marginTop: 14, marginBottom: 0 }}>
            <AlertTriangle size={14} />
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button
            style={S.btn('#8b5cf6', !canSubmit || loading)}
            onClick={handleAnalyze}
            disabled={!canSubmit || loading}
          >
            {loading ? <Loader size={13} className="spin" /> : <Search size={13} />}
            {loading ? 'Analyzing…' : 'Run Forensic Analysis'}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div style={S.panel}>
          <div style={S.loadingOverlay}>
            <Loader size={28} color="#8b5cf6" style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontWeight: 700, color: '#8b5cf6', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 11 }}>
              {inputMode === 'url' ? 'Analyzing Article & Media' : 'Running Forensic Analysis'}
            </div>
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', maxWidth: 360 }}>
              {inputMode === 'url'
                ? 'Fetching page, extracting text, images, video and audio — then running AI forensic analysis on each. This may take 15–30 seconds.'
                : 'Gemini AI is performing deep forensic analysis — this may take 10–20 seconds.'}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {entity && !loading && (
        <>
          {/* Score Cards */}
          <div style={S.panel}>
            <div style={S.panelTitle}>Forensic Scores</div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={S.badge(risk)}>
                <AlertTriangle size={9} />
                {risk} Risk
              </div>
              {entity.topic && (
                <div style={{ fontSize: 10, color: '#3d7aaa', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 4, padding: '2px 8px', letterSpacing: '0.08em' }}>
                  {entity.topic}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#475569', marginLeft: 'auto' }}>
                ID: <span style={{ color: '#3d7aaa', fontFamily: 'monospace', fontSize: 10 }}>{entity.entity_id}</span>
              </div>
            </div>

            <div style={S.resultSection}>
              {/* AI Prob */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>AI-Generated Probability</div>
                <div style={S.scoreValue(probColor(aiProb))}>{(aiProb * 100).toFixed(1)}%</div>
                <div style={S.trackOuter}>
                  <div style={S.trackFill(aiProb * 100, probColor(aiProb))} />
                </div>
              </div>
              {/* Credibility */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>Credibility Score</div>
                <div style={S.scoreValue(credColor(credScore))}>{(credScore * 100).toFixed(1)}%</div>
                <div style={S.trackOuter}>
                  <div style={S.trackFill(credScore * 100, credColor(credScore))} />
                </div>
              </div>
              {/* Trust */}
              <div style={S.scoreCard}>
                <div style={S.scoreLabel}>Trust Score</div>
                <div style={S.scoreValue(trustScore >= 70 ? '#34d399' : trustScore >= 40 ? '#fbbf24' : '#f87171')}>
                  {trustScore.toFixed(0)}<span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>/100</span>
                </div>
                <div style={S.trackOuter}>
                  <div style={S.trackFill(trustScore, trustScore >= 70 ? '#34d399' : trustScore >= 40 ? '#fbbf24' : '#f87171')} />
                </div>
              </div>
              {/* Word Count */}
              {entity.word_count != null && (
                <div style={S.scoreCard}>
                  <div style={S.scoreLabel}>Word Count</div>
                  <div style={S.scoreValue('#8b5cf6')}>{Number(entity.word_count).toLocaleString()}</div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>words analyzed</div>
                </div>
              )}
            </div>

            {/* AI Summary */}
            {entity.ai_summary && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3d7aaa', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 7 }}>AI Forensic Summary</div>
                <div style={S.summaryBox}>{entity.ai_summary}</div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={S.actionRow}>
              <button style={S.btn('#8b5cf6', pdfLoading)} onClick={handleExportPdf} disabled={pdfLoading}>
                {pdfLoading ? <Loader size={12} /> : <Download size={12} />}
                Export Evidence PDF
              </button>
              <button style={S.btn('#fbbf24')} onClick={handleGoLegal}>
                <Gavel size={12} />
                Generate Legal Draft
              </button>
              <button style={S.btn('#8b5cf6')} onClick={handleOpenInvestigation}>
                <ChevronRight size={12} />
                Investigation View
              </button>
            </div>
            {pdfStatus && (
              <div style={{ marginTop: 10, fontSize: 11, color: pdfStatus.startsWith('Error') ? '#f87171' : '#34d399' }}>
                {pdfStatus}
              </div>
            )}
          </div>

          {/* Forensic Findings */}
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

          {/* Key Claims */}
          {claims.length > 0 && (
            <div style={S.panel}>
              <div style={S.panelTitle}>Key Claims Identified ({claims.length})</div>
              {claims.map((c, i) => (
                <div key={i} style={S.claimItem}>
                  <span style={S.claimTag}>C{i + 1}</span>
                  <span>{String(c)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Article Media Analysis — only for URL mode */}
          {inputMode === 'url' && media && (
            <div style={S.panel}>
              {/* Header row with overall risk */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <LayoutGrid size={14} color="#8b5cf6" />
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Article Media Analysis</div>
                <div style={{ marginLeft: 'auto', ...S.badge(overallRisk) }}>
                  <AlertTriangle size={9} />
                  Overall: {overallRisk}
                </div>
              </div>

              {/* Summary strip */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
                {[
                  { icon: <Image size={13} color="#22d3ee" />, label: 'Images', count: media.images.length, color: '#22d3ee' },
                  { icon: <Video size={13} color="#fb923c" />, label: 'Videos', count: media.videos.length, color: '#fb923c' },
                  { icon: <Music size={13} color="#34d399" />, label: 'Audio', count: media.audio.length, color: '#34d399' },
                ].map(({ icon, label, count, color }) => (
                  <div key={label} style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 7, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {icon}
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
                      <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>{label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Images */}
              {media.images.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Image size={10} color="#22d3ee" /> Images ({media.images.length})
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
                    {media.images.map((img, i) => {
                      const prob = img.fake_probability ?? img.ai_generated_probability ?? 0
                      const rl = (img.risk_level || 'LOW').toUpperCase()
                      const c = rl === 'HIGH' ? '#f87171' : rl === 'MEDIUM' ? '#fbbf24' : '#34d399'
                      return (
                        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${rl === 'HIGH' ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 7, overflow: 'hidden' }}>
                          <div style={{ height: 100, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', position: 'relative' }}>
                            <img src={img.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
                            <div style={{ position: 'absolute', top: 6, right: 6, ...S.badge(rl), fontSize: 8, padding: '2px 6px' }}>{rl}</div>
                          </div>
                          <div style={{ padding: '8px 10px' }}>
                            <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Fake Probability</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: c, lineHeight: 1, marginBottom: 5 }}>{(prob * 100).toFixed(1)}%</div>
                            <div style={S.trackOuter}>
                              <div style={S.trackFill(prob * 100, c)} />
                            </div>
                            {img.url && (
                              <div style={{ fontSize: 9, color: '#334155', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={img.url}>
                                {img.url.replace(/^https?:\/\//, '').substring(0, 40)}…
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Videos */}
              {media.videos.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#fb923c', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Video size={10} color="#fb923c" /> Videos ({media.videos.length})
                  </div>
                  {media.videos.map((vid, i) => {
                    const prob = vid.fake_probability ?? 0
                    const rl = (vid.risk_level || 'LOW').toUpperCase()
                    const c = rl === 'HIGH' ? '#f87171' : rl === 'MEDIUM' ? '#fbbf24' : '#34d399'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${rl === 'HIGH' ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 7, marginBottom: 8 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Video size={16} color="#fb923c" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5 }} title={vid.url}>{vid.url}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={S.badge(rl)}>{rl}</div>
                            <span style={{ fontSize: 10, color: c, fontWeight: 700 }}>{(prob * 100).toFixed(1)}% fake</span>
                            {vid.frames_analysed != null && <span style={{ fontSize: 9, color: '#475569' }}>{vid.frames_analysed} frames</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Audio */}
              {media.audio.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#34d399', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Music size={10} color="#34d399" /> Audio ({media.audio.length})
                  </div>
                  {media.audio.map((aud, i) => {
                    const prob = aud.fake_probability ?? aud.deepfake_probability ?? 0
                    const rl = (aud.risk_level || 'LOW').toUpperCase()
                    const c = rl === 'HIGH' ? '#f87171' : rl === 'MEDIUM' ? '#fbbf24' : '#34d399'
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${rl === 'HIGH' ? 'rgba(248,113,113,0.25)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 7, marginBottom: 8 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music size={16} color="#34d399" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 5 }} title={aud.url}>{aud.url}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={S.badge(rl)}>{rl}</div>
                            <span style={{ fontSize: 10, color: c, fontWeight: 700 }}>{(prob * 100).toFixed(1)}% deepfake</span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Empty state — no media found */}
              {media.images.length === 0 && media.videos.length === 0 && media.audio.length === 0 && (
                <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 11, color: '#334155' }}>
                  No analyzable media found in this article.
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!entity && !loading && (
        <div style={{ ...S.panel, textAlign: 'center', padding: '36px 20px' }}>
          <Shield size={32} color="rgba(139,92,246,0.18)" style={{ margin: '0 auto 12px' }} />
          <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
            Paste article text or enter a URL above to run a full forensic AI analysis.<br />
            Results include AI-generation probability, credibility scores, key claims, and a PDF-exportable evidence report.
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          WEB VERIFICATION — separate independent section
          ══════════════════════════════════════════════════════════════════ */}
      <div style={{
        background: 'rgba(17,17,32,0.9)',
        border: '1px solid rgba(34,211,238,0.18)',
        borderRadius: 10, padding: '18px 20px', marginTop: 8,
      }}>
        {/* Section header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(34,211,238,0.1)' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Radio size={14} color="#22d3ee" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.06em' }}>Web Verification</div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>Search the internet for this news — get live results + AI verdict</div>
          </div>
          {webResult && (
            <div style={{ marginLeft: 'auto', fontSize: 10, color: '#475569' }}>
              {webResult.total} source{webResult.total !== 1 ? 's' : ''} found
            </div>
          )}
        </div>

        {/* Query input */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            style={{ ...S.input, flex: 1, border: '1px solid rgba(34,211,238,0.2)', background: 'rgba(34,211,238,0.03)' }}
            placeholder="Paste a news headline, URL, or key claim to verify across the internet…"
            value={webQuery}
            onChange={e => setWebQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !webLoading && webQuery.trim() && handleWebSearch()}
          />
          <button
            onClick={() => handleWebSearch()}
            disabled={webLoading || !webQuery.trim()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 18px', borderRadius: 7, cursor: webLoading || !webQuery.trim() ? 'not-allowed' : 'pointer',
              border: `1px solid ${webLoading || !webQuery.trim() ? 'rgba(100,120,150,0.2)' : 'rgba(34,211,238,0.4)'}`,
              background: webLoading || !webQuery.trim() ? 'rgba(100,120,150,0.06)' : 'rgba(34,211,238,0.1)',
              color: webLoading || !webQuery.trim() ? '#475569' : '#22d3ee',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              opacity: webLoading || !webQuery.trim() ? 0.6 : 1, transition: 'all 0.18s', whiteSpace: 'nowrap',
            }}>
            {webLoading ? <Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Globe size={13} />}
            {webLoading ? 'Searching…' : 'Search Web'}
          </button>
        </div>

        {/* Error */}
        {webError && (
          <div style={{ ...S.errorBox, marginBottom: 12 }}>
            <AlertTriangle size={14} /> {webError}
          </div>
        )}

        {/* Loading */}
        {webLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 0', color: '#22d3ee' }}>
            <Loader size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Searching internet sources…</div>
            <div style={{ fontSize: 11, color: '#475569', textAlign: 'center' }}>Scanning Google News, DuckDuckGo and cross-referencing with AI fact-checker</div>
          </div>
        )}

        {/* Results */}
        {webResult && !webLoading && (() => {
          const hasResults = (webResult.results?.length > 0) || webResult.ddg_answer?.text
          const v = hasResults ? (webResult.verdict || 'UNVERIFIED') : null
          const verdictConfig = {
            CONFIRMED:   { color: '#34d399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.3)',  icon: <CheckCircle size={16} />, label: 'CONFIRMED' },
            DISPUTED:    { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)',  icon: <AlertTriangle size={16} />, label: 'DISPUTED' },
            MISLEADING:  { color: '#f87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', icon: <XCircle size={16} />, label: 'MISLEADING' },
            SATIRE:      { color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', border: 'rgba(167,139,250,0.3)', icon: <HelpCircle size={16} />, label: 'SATIRE' },
            UNVERIFIED:  { color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.2)', icon: <HelpCircle size={16} />, label: 'UNVERIFIED' },
          }
          const vc = verdictConfig[v] || verdictConfig.UNVERIFIED
          const conf = Math.round((webResult.confidence || 0.5) * 100)
          const resolvedQ = webResult.resolved_query
          const queryDiffers = resolvedQ && resolvedQ !== webQuery.trim()

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Resolved query banner */}
              {queryDiffers && (
                <div style={{ background: 'rgba(34,211,238,0.06)', border: '1px solid rgba(34,211,238,0.18)', borderRadius: 7, padding: '8px 14px', fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={11} color="#22d3ee" />
                  <span>Searching as: <strong style={{ color: '#22d3ee' }}>"{resolvedQ}"</strong></span>
                </div>
              )}

              {/* AI Verdict card — only when we have real results */}
              {hasResults && v && (
                <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
                  <div style={{ flex: '0 0 auto', minWidth: 160, background: vc.bg, border: `1px solid ${vc.border}`, borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <div style={{ color: vc.color }}>{vc.icon}</div>
                    <div style={{ fontSize: 15, fontWeight: 900, color: vc.color, letterSpacing: '0.12em' }}>{vc.label}</div>
                    <div style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>AI Verdict</div>
                    <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                      <div style={{ height: '100%', width: `${conf}%`, background: vc.color, borderRadius: 2, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ fontSize: 10, color: vc.color, fontFamily: 'monospace' }}>{conf}% confidence</div>
                  </div>

                  {webResult.ai_summary && (
                    <div style={{ flex: 1, background: 'rgba(34,211,238,0.03)', border: '1px solid rgba(34,211,238,0.1)', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.12em', textTransform: 'uppercase' }}>AI Analysis</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>{webResult.ai_summary}</div>
                      {webResult.key_sources?.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {webResult.key_sources.map((s, i) => (
                            <span key={i} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 20, background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.18)', color: '#22d3ee' }}>{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* DDG instant answer */}
              {webResult.ddg_answer?.text && (
                <div style={{ background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.15)', borderRadius: 8, padding: '12px 14px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#8b5cf6', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Quick Answer · {webResult.ddg_answer.source}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{webResult.ddg_answer.text}</div>
                  {webResult.ddg_answer.url && (
                    <a href={webResult.ddg_answer.url} target="_blank" rel="noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#8b5cf6', marginTop: 6, textDecoration: 'none' }}>
                      <ExternalLink size={9} /> View source
                    </a>
                  )}
                </div>
              )}

              {/* News articles */}
              {webResult.results?.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#22d3ee', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Newspaper size={10} color="#22d3ee" /> Internet Sources ({webResult.results.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {webResult.results.map((r, i) => (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 7, padding: '10px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(34,211,238,0.07)', border: '1px solid rgba(34,211,238,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          <Globe size={12} color="#22d3ee" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a href={r.url} target="_blank" rel="noreferrer"
                            style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', textDecoration: 'none', display: 'block', marginBottom: 4, lineHeight: 1.4 }}
                            title={r.title}>
                            {r.title}
                          </a>
                          {r.snippet && (
                            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5, marginBottom: 5 }}>{r.snippet}</div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#22d3ee', background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.15)', borderRadius: 3, padding: '1px 7px' }}>{r.source}</span>
                            {r.date && <span style={{ fontSize: 9, color: '#334155', fontFamily: 'monospace' }}>{r.date.replace(/\s*\+\d{4}/, '').trim()}</span>}
                            <a href={r.url} target="_blank" rel="noreferrer"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9, color: '#475569', marginLeft: 'auto', textDecoration: 'none' }}>
                              <ExternalLink size={9} /> Open
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No results */}
              {!hasResults && (
                <div style={{ textAlign: 'center', padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <Newspaper size={28} color="#334155" />
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>No matching articles found</div>
                  <div style={{ fontSize: 11, color: '#334155', maxWidth: 400, lineHeight: 1.6 }}>
                    Try pasting the full article headline or a short key claim instead of a URL.<br/>
                    Example: <em style={{ color: '#22d3ee', opacity: 0.7 }}>"India signs new climate deal at G20 summit"</em>
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
