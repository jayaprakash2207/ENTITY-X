import { useState } from 'react'
import {
  Send, AlertTriangle, Copy, Download, FileText,
  Scale, ArrowLeft, ChevronRight, MessageSquare,
  Shield, ChevronDown, ChevronUp, Loader
} from 'lucide-react'
import ExplainableForensics from '../components/ExplainableForensics'

function stripAds(text) {
  if (!text) return text
  return text
    .replace(/\n*[\*_]*Support\s+Pollinations[\s\S]*/i, '')
    .replace(/\n*[\*_]*Ad[\*_]*[\s\S]*Pollinations[\s\S]*/i, '')
    .trim()
}

function renderInline(text) {
  const parts = []
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`)/g
  let last = 0
  let match

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[2]) parts.push(<strong key={match.index}><em>{match[2]}</em></strong>)
    else if (match[3]) parts.push(<strong key={match.index}>{match[3]}</strong>)
    else if (match[4]) parts.push(<em key={match.index}>{match[4]}</em>)
    else if (match[5]) parts.push(<code key={match.index} style={{ background: 'rgba(139,92,246,0.15)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: '0.95em' }}>{match[5]}</code>)
    last = match.index + match[0].length
  }

  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownDoc({ text }) {
  if (!text) return null
  const lines = stripAds(text).split('\n')
  const elements = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    const heading = line.match(/^(#{1,6})\s+(.+)/)
    if (heading) {
      const level = heading[1].length
      const sizes = [18, 16, 14, 13, 12, 11]
      elements.push(
        <div key={i} style={{ fontSize: sizes[level - 1] || 13, fontWeight: 800, color: '#e2e8f0', marginTop: level <= 2 ? 18 : 12, marginBottom: 6, borderBottom: level <= 2 ? '1px solid rgba(139,92,246,0.2)' : 'none', paddingBottom: level <= 2 ? 4 : 0 }}>
          {renderInline(heading[2])}
        </div>
      )
      i += 1
      continue
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      elements.push(<hr key={i} style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)', margin: '12px 0' }} />)
      i += 1
      continue
    }

    const ordered = line.match(/^(\d+)\.\s+(.*)/)
    if (ordered) {
      const listItems = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const item = lines[i].match(/^\d+\.\s+(.*)/)
        listItems.push(<li key={i} style={{ color: 'inherit', lineHeight: 1.7, marginBottom: 3 }}>{renderInline(item[1])}</li>)
        i += 1
      }
      elements.push(<ol key={`ol-${i}`} style={{ margin: '6px 0', paddingLeft: 22, fontSize: 11.5, color: 'inherit' }}>{listItems}</ol>)
      continue
    }

    const unordered = line.match(/^[-*]\s+(.*)/)
    if (unordered) {
      const listItems = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        const item = lines[i].match(/^[-*]\s+(.*)/)
        listItems.push(<li key={i} style={{ color: 'inherit', lineHeight: 1.7, marginBottom: 3 }}>{renderInline(item[1])}</li>)
        i += 1
      }
      elements.push(<ul key={`ul-${i}`} style={{ margin: '6px 0', paddingLeft: 20, fontSize: 11.5, color: 'inherit' }}>{listItems}</ul>)
      continue
    }

    if (!line.trim()) {
      elements.push(<div key={i} style={{ height: 6 }} />)
      i += 1
      continue
    }

    elements.push(<p key={i} style={{ fontSize: 11.5, color: 'inherit', lineHeight: 1.7, margin: '2px 0' }}>{renderInline(line)}</p>)
    i += 1
  }

  return <div style={{ fontFamily: 'inherit' }}>{elements}</div>
}

function parseForensics(raw) {
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (!raw || !raw.trim()) return []
  return raw.split('\n').map((item) => item.trim()).filter(Boolean)
}

function Section({ title, icon: Icon, color = '#8b5cf6', children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div style={{ border: `1px solid ${color}22`, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', background: `${color}0d`, border: 'none', cursor: 'pointer', color }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={13} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{title}</span>
        </div>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && <div style={{ padding: '12px 16px', background: 'rgba(4,15,35,0.8)' }}>{children}</div>}
    </div>
  )
}

function field(label, children) {
  return (
    <div>
      <label style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#475569', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function ComplaintTab({ entity }) {
  const forensicLines = entity?.forensic_explanation || []
  const explainabilityProbability = entity?.fake_probability ?? entity?.ai_generated_probability ?? 0
  const explainabilityRisk =
    entity?.risk_level ||
    entity?.misinformation_risk ||
    (explainabilityProbability > 0.7 ? 'HIGH' : explainabilityProbability > 0.4 ? 'MEDIUM' : 'LOW')

  const [formData, setFormData] = useState({
    entityType: entity?.type || 'IMAGE',
    sourceUrl: entity?.source_url || '',
    contentTitle: entity?.title || '',
    aiProbability: entity ? Math.round((entity.fake_probability || entity.ai_generated_probability || 0) * 100) : 0,
    misinformationRisk: entity?.misinformation_risk || '',
    credibilityScore: entity ? Math.round((entity.credibility_score || 0) * 100) : '',
    forensicFindings: entity?.forensic_explanation?.join('\n') || '',
    aiSummary: entity?.ai_summary || '',
  })
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [pdfStatus, setPdfStatus] = useState(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [judgeLoading, setJudgeLoading] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const res = await window.entityX.generateLegal({
        entity_id: entity?.id || '',
        entity_type: formData.entityType,
        source_url: formData.sourceUrl,
        content_title: formData.contentTitle,
        ai_generated_probability: formData.aiProbability / 100,
        misinformation_risk: formData.misinformationRisk || undefined,
        credibility_score: formData.credibilityScore !== '' ? formData.credibilityScore / 100 : undefined,
        forensic_findings: parseForensics(formData.forensicFindings),
        ai_summary: formData.aiSummary || undefined,
      })
      setResult(res)
    } catch (error) {
      console.error('[LegalGenerator] generate error:', error)
      setResult({ complaint_draft: 'Error generating document. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = () => {
    const text = stripAds(result?.complaint_draft || '')
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleExport = async () => {
    if (!result) return
    setPdfLoading(true)
    setPdfStatus(null)
    try {
      const res = await window.entityX.exportPdf({
        entity_id: entity?.id || '',
        entity_type: formData.entityType || 'TEXT',
        source_url: formData.sourceUrl,
        content_title: formData.contentTitle,
        fake_probability: formData.aiProbability / 100,
        ai_generated_probability: formData.aiProbability / 100,
        risk_level: formData.misinformationRisk,
        credibility_score: formData.credibilityScore !== '' ? formData.credibilityScore / 100 : undefined,
        forensic_explanation: parseForensics(formData.forensicFindings),
        ai_summary: formData.aiSummary || undefined,
        complaint_draft: result.complaint_draft,
        detected_at: Date.now(),
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

  const handleJudgeReport = async () => {
    if (!result) return
    setJudgeLoading(true)
    try {
      const body = {
        entity_id:                entity?.id || 'N/A',
        entity_type:              formData.entityType || 'UNKNOWN',
        source_url:               formData.sourceUrl,
        content_title:            formData.contentTitle,
        detected_at:              entity?.timestamp || Date.now(),
        fake_probability:         formData.aiProbability / 100,
        ai_generated_probability: formData.aiProbability / 100,
        misinformation_risk:      formData.misinformationRisk || null,
        credibility_score:        formData.credibilityScore !== '' ? formData.credibilityScore / 100 : null,
        trust_score:              entity?.trust_score_after ?? null,
        forensic_findings:        parseForensics(formData.forensicFindings),
        key_claims:               entity?.key_claims || [],
        ai_summary:               formData.aiSummary || null,
        legal_complaint:          stripAds(result.complaint_draft || ''),
        include_provenance:       true,
        include_timeline:         true,
      }
      const r = await fetch('http://127.0.0.1:8000/api/legal/judge-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(await r.text())
      const html = await r.text()
      const win = window.open('', '_blank')
      if (win) { win.document.write(html); win.document.close() }
    } catch (err) {
      console.error('[JudgeReport]', err)
    } finally {
      setJudgeLoading(false)
    }
  }

  if (result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button onClick={() => setResult(null)} style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)', borderRadius: 4, cursor: 'pointer', padding: '5px 8px', color: '#8b5cf6' }}>
              <ArrowLeft size={13} />
            </button>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.08em' }}>DRAFT COMPLAINT</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCopy} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.22)', borderRadius: 4, color: '#8b5cf6', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
              <Copy size={11} />
              {copied ? 'COPIED!' : 'COPY'}
            </button>
            <button onClick={handleExport} disabled={pdfLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(0,255,149,0.08)', border: '1px solid rgba(0,255,149,0.25)', borderRadius: 5, color: '#34d399', cursor: pdfLoading ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, opacity: pdfLoading ? 0.6 : 1 }}>
              <Download size={11} />
              {pdfLoading ? 'Exporting...' : 'EXPORT PDF'}
            </button>
            <button onClick={handleJudgeReport} disabled={judgeLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 5, color: '#fbbf24', cursor: judgeLoading ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700, opacity: judgeLoading ? 0.6 : 1 }}>
              <Scale size={11} />
              {judgeLoading ? 'Generating...' : 'JUDGE REPORT'}
            </button>
          </div>
        </div>

        {pdfStatus && (
          <div style={{ fontSize: 11, padding: '7px 14px', borderRadius: 5, color: pdfStatus.ok ? '#34d399' : '#fbbf24', background: pdfStatus.ok ? 'rgba(0,255,149,0.08)' : 'rgba(255,170,0,0.08)', border: `1px solid ${pdfStatus.ok ? 'rgba(0,255,149,0.2)' : 'rgba(255,170,0,0.2)'}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            {pdfStatus.ok ? 'OK' : 'WARN'} {pdfStatus.msg}
          </div>
        )}

        <div style={{ background: 'rgba(255,45,85,0.06)', border: '1px solid rgba(255,45,85,0.2)', borderRadius: 5, padding: '10px 14px', display: 'flex', gap: 10 }}>
          <AlertTriangle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
          <p style={{ fontSize: 10, color: '#ffaab8', margin: 0, lineHeight: 1.6 }}>
            <strong style={{ color: '#f87171' }}>LEGAL DISCLAIMER: </strong>
            This generated text is not legal advice. Consult a qualified attorney before taking any legal action.
          </p>
        </div>

        <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={11} style={{ color: '#8b5cf6' }} />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#8b5cf6', textTransform: 'uppercase' }}>Draft Document</span>
          </div>
          <div style={{ padding: '16px 20px', maxHeight: 480, overflowY: 'auto' }}>
            <MarkdownDoc text={result.complaint_draft} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ExplainableForensics
        explain={forensicLines}
        probability={explainabilityProbability}
        riskLevel={String(explainabilityRisk).toUpperCase()}
        variant="legal"
      />

      <div style={{ background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.2)', borderRadius: 5, padding: '10px 14px', display: 'flex', gap: 10 }}>
        <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 10, color: '#ffd980', margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: '#fbbf24' }}>NOTE: </strong>
          Generated text is for reference only. Not legal advice. Consult a qualified attorney.
        </p>
      </div>

      <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={11} style={{ color: '#8b5cf6' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#a78bfa', textTransform: 'uppercase' }}>Case Information</span>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {field('Content Type',
            <select value={formData.entityType} onChange={(e) => setFormData({ ...formData, entityType: e.target.value })} className="cx-select" style={{ width: '100%' }}>
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
              <option value="TEXT">Article / Text</option>
            </select>
          )}

          {field('Source URL',
            <input type="url" placeholder="https://example.com/..." value={formData.sourceUrl} onChange={(e) => setFormData({ ...formData, sourceUrl: e.target.value })} className="cx-input" style={{ width: '100%' }} />
          )}

          {field('Title / Description',
            <input type="text" placeholder="Brief description of the content..." value={formData.contentTitle} onChange={(e) => setFormData({ ...formData, contentTitle: e.target.value })} className="cx-input" style={{ width: '100%' }} />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {field('AI Probability (%)',
              <input type="number" min="0" max="100" value={formData.aiProbability} onChange={(e) => setFormData({ ...formData, aiProbability: parseFloat(e.target.value) || 0 })} className="cx-input" style={{ width: '100%' }} />
            )}
            {field('Misinformation Risk',
              <select value={formData.misinformationRisk} onChange={(e) => setFormData({ ...formData, misinformationRisk: e.target.value })} className="cx-select" style={{ width: '100%' }}>
                <option value="">- Select -</option>
                <option value="HIGH">HIGH</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="LOW">LOW</option>
              </select>
            )}
          </div>

          {field('Forensic Findings (one per line)',
            <textarea
              placeholder="e.g. High spectral flatness detected&#10;Face region inconsistency&#10;GAN fingerprint found"
              rows="4"
              value={formData.forensicFindings}
              onChange={(e) => setFormData({ ...formData, forensicFindings: e.target.value })}
              className="cx-input"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
            />
          )}

          {field('AI Analysis Summary (optional)',
            <textarea
              placeholder="Brief summary from the AI analysis..."
              rows="2"
              value={formData.aiSummary}
              onChange={(e) => setFormData({ ...formData, aiSummary: e.target.value })}
              className="cx-input"
              style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
            />
          )}

          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '10px 0', borderRadius: 5, cursor: loading ? 'not-allowed' : 'pointer', background: loading ? 'rgba(139,92,246,0.12)' : 'linear-gradient(90deg,rgba(139,92,246,0.3),rgba(139,92,246,0.18))', border: '1px solid rgba(139,92,246,0.4)', color: '#f1f5f9', fontWeight: 800, fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}
          >
            {loading ? <><Loader size={13} style={{ animation: 'spin 0.8s linear infinite' }} /> Generating...</> : <><Send size={13} /> Generate Complaint <ChevronRight size={13} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}

function LegalChatTab({ entity }) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])

  const handleQuery = async () => {
    if (!query.trim()) return
    setLoading(true)
    try {
      const res = await window.entityX.legalChatQuery({
        entity_id: entity?.id || '',
        user_query: query,
        history: history.map((message) => ({ role: message.role, content: message.content })),
      })
      const displayText = stripAds(res?.guidance?.ai_explanation || res?.ai_response || '')
      if (displayText) {
        setHistory((items) => [
          ...items,
          { role: 'user', content: query },
          { role: 'assistant', content: displayText, guidance: res?.guidance },
        ])
        setQuery('')
      }
    } catch (error) {
      console.error('[LegalChat] query error:', error)
      setHistory((items) => [...items, { role: 'assistant', content: 'Error getting legal guidance. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: 'rgba(255,170,0,0.06)', border: '1px solid rgba(255,170,0,0.2)', borderRadius: 5, padding: '10px 14px', display: 'flex', gap: 10 }}>
        <Shield size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
        <p style={{ fontSize: 10, color: '#ffd980', margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: '#fbbf24' }}>AWARENESS ONLY: </strong>
          This chat provides general legal awareness. It is not legal advice.
        </p>
      </div>

      <div style={{ background: 'rgba(17,17,32,0.9)', border: '1px solid rgba(139,92,246,0.18)', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(0,212,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <MessageSquare size={11} style={{ color: '#8b5cf6' }} />
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#8b5cf6', textTransform: 'uppercase' }}>Ask Legal Question</span>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
            <textarea
              placeholder="e.g. What can I do about a deepfake image of me on social media?"
              rows="3"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) handleQuery() }}
              className="cx-input"
              style={{ fontFamily: 'inherit', fontSize: 12, resize: 'vertical' }}
            />
            <button onClick={handleQuery} disabled={loading || !query.trim()} style={{ padding: '10px 14px', borderRadius: 4, alignSelf: 'stretch', cursor: loading ? 'not-allowed' : 'pointer', background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.28)', color: '#8b5cf6', fontWeight: 800, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {loading ? <Loader size={12} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Send size={12} />}
            </button>
          </div>
          <p style={{ fontSize: 10, color: '#475569', margin: 0 }}>Ctrl+Enter to submit</p>
        </div>
      </div>

      {history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 500, overflowY: 'auto' }}>
          {history.map((message, index) => (
            <div key={index}>
              <div style={{ padding: '10px 14px', borderRadius: 6, background: message.role === 'user' ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.04)', border: message.role === 'user' ? '1px solid rgba(139,92,246,0.2)' : '1px solid rgba(139,92,246,0.12)' }}>
                <p style={{ fontSize: 10, fontWeight: 700, marginBottom: 5, color: message.role === 'user' ? '#a78bfa' : '#8b5cf6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {message.role === 'user' ? 'You' : 'Legal Advisor'}
                </p>
                {message.role === 'user'
                  ? <p style={{ fontSize: 11, color: '#c8b0ff', margin: 0, lineHeight: 1.7 }}>{message.content}</p>
                  : <div style={{ fontSize: 11, color: '#a8d0ee' }}><MarkdownDoc text={message.content} /></div>}
              </div>

              {message.role === 'assistant' && message.guidance && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingLeft: 8 }}>
                  {message.guidance.relevant_sections?.length > 0 && (
                    <Section title="Relevant Laws" icon={Shield} color="#8b5cf6" defaultOpen={false}>
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {message.guidance.relevant_sections.slice(0, 4).map((item, itemIndex) => (
                          <li key={itemIndex} style={{ fontSize: 10, color: '#c8b0ff', lineHeight: 1.6, marginBottom: 3 }}>{item}</li>
                        ))}
                      </ul>
                    </Section>
                  )}
                  {message.guidance.steps_to_proceed?.length > 0 && (
                    <Section title="Steps to Take" icon={FileText} color="#8b5cf6" defaultOpen={false}>
                      <ol style={{ margin: 0, paddingLeft: 16 }}>
                        {message.guidance.steps_to_proceed.slice(0, 4).map((item, itemIndex) => (
                          <li key={itemIndex} style={{ fontSize: 10, color: '#a8d0ee', lineHeight: 1.6, marginBottom: 3 }}>{item}</li>
                        ))}
                      </ol>
                    </Section>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LegalGenerator({ entity }) {
  const [activeTab, setActiveTab] = useState('complaint')

  const tabs = [
    { id: 'complaint', label: 'Generate Complaint', icon: FileText },
    { id: 'chat', label: 'Legal Chat', icon: MessageSquare },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(0,212,255,0.1)', paddingBottom: 14 }}>
        <Scale size={18} style={{ color: '#8b5cf6', filter: 'drop-shadow(0 0 5px #8b5cf6)' }} />
        <div style={{ width: 4, height: 22, borderRadius: 2, background: 'linear-gradient(180deg,#8b5cf6,#8b5cf6)', boxShadow: '0 0 8px rgba(139,92,246,0.5)' }} />
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.1em', color: '#f1f5f9', textTransform: 'uppercase', margin: 0 }}>Legal Suite</h1>
          <p style={{ fontSize: 10, color: '#475569', margin: 0 }}>Complaint generation . Legal awareness chat</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(139,92,246,0.08)', paddingBottom: 0 }}>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', background: active ? 'rgba(139,92,246,0.15)' : 'transparent', border: 'none', borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent', borderRadius: '4px 4px 0 0', color: active ? '#a78bfa' : '#475569', cursor: 'pointer', fontSize: 11, fontWeight: active ? 700 : 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'complaint' ? <ComplaintTab entity={entity} /> : <LegalChatTab entity={entity} />}
    </div>
  )
}
