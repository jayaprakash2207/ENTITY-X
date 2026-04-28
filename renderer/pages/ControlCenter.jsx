import { Settings, Zap, Database, Bell, Eye } from 'lucide-react'
import { useState } from 'react'

const SETTINGS_KEY = 'entityx:control-center-settings'
const DEFAULT_SETTINGS = {
  autoAnalyze: true,
  detectImages: true,
  detectVideos: true,
  detectArticles: true,
  sensitivity: 'medium',
  notifications: true,
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch {}
}

export default function ControlCenter() {
  const [settings, setSettings] = useState(loadSettings)
  const [testLog, setTestLog] = useState('')

  const handleToggle = (key) => setSettings((prev) => {
    const next = { ...prev, [key]: !prev[key] }
    saveSettings(next)
    return next
  })
  const handleChange = (key, value) => setSettings((prev) => {
    const next = { ...prev, [key]: value }
    saveSettings(next)
    return next
  })

  const testImageAnalysis = async () => {
    const testUrl = 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg'
    setTestLog(`Testing: ${testUrl}...`)
    try {
      if (window.entityX?.analyzeUrl) {
        const result = await window.entityX.analyzeUrl(testUrl)
        setTestLog((p) => p + `\n✅ ${JSON.stringify(result, null, 2)}`)
      } else {
        setTestLog((p) => p + '\n❌ analyzeUrl not available')
      }
    } catch (error) {
      setTestLog((p) => p + `\n❌ Error: ${error.message}`)
    }
  }

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:20,maxWidth:760 }}>
      {/* ── Header ── */}
      <div style={{ display:'flex',alignItems:'center',gap:12,borderBottom:'1px solid rgba(0,212,255,0.1)',paddingBottom:14 }}>
        <Settings size={18} style={{ color:'#8b5cf6',filter:'drop-shadow(0 0 5px #8b5cf6)' }} />
        <div style={{ width:4,height:22,borderRadius:2,background:'linear-gradient(180deg,#8b5cf6,#8b5cf6)',boxShadow:'0 0 8px rgba(139,92,246,0.38)' }} />
        <div>
          <h1 style={{ fontSize:20,fontWeight:900,letterSpacing:'0.1em',color:'#f1f5f9',textTransform:'uppercase',margin:0 }}>
            Control Center
          </h1>
          <p style={{ fontSize:10,color:'#475569',margin:0 }}>System configuration &amp; detection parameters</p>
        </div>
      </div>

      {/* ── Monitoring ── */}
      <Section icon={<Eye size={13} style={{ color:'#8b5cf6' }} />} title="Monitoring" accent="#8b5cf6">
        <ToggleRow label="Auto-Analyze Content"    desc="Automatically analyze detected content"    checked={settings.autoAnalyze}     onChange={() => handleToggle('autoAnalyze')} />
        <ToggleRow label="Detect Images"            desc="Monitor images for AI-generation"          checked={settings.detectImages}    onChange={() => handleToggle('detectImages')} />
        <ToggleRow label="Detect Videos"            desc="Monitor videos for deepfakes"              checked={settings.detectVideos}    onChange={() => handleToggle('detectVideos')} />
        <ToggleRow label="Detect Articles"          desc="Monitor articles for AI-authored content"  checked={settings.detectArticles}  onChange={() => handleToggle('detectArticles')} />
      </Section>

      {/* ── Detection Sensitivity ── */}
      <Section icon={<Zap size={13} style={{ color:'#fbbf24' }} />} title="Detection Sensitivity" accent="#fbbf24">
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:'#475569',textTransform:'uppercase',display:'block',marginBottom:6 }}>
            Sensitivity Level
          </label>
          <select value={settings.sensitivity} onChange={(e) => handleChange('sensitivity', e.target.value)}
            className="cx-select" style={{ width:'100%' }}>
            <option value="low">Low — Fewer false positives</option>
            <option value="medium">Medium — Balanced</option>
            <option value="high">High — More detections</option>
          </select>
        </div>
        <ToggleRow label="Notify on Detection" desc="Show notifications for detected content" checked={settings.notifications} onChange={() => handleToggle('notifications')} />
      </Section>

      {/* ── System Info ── */}
      <Section icon={<Database size={13} style={{ color:'#34d399' }} />} title="System Information" accent="#34d399">
        <div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:10 }}>
          {[
            { label:'Version',           value:'1.0.0',   color:'#e2e8f0' },
            { label:'Status',            value:'Active',  color:'#34d399' },
            { label:'Detections Today',  value:'—',       color:'#e2e8f0' },
            { label:'Database Size',     value:'—',       color:'#e2e8f0' },
          ].map((item) => (
            <div key={item.label} style={{ padding:'10px 14px',background:'rgba(139,92,246,0.03)',borderRadius:4,borderLeft:'2px solid rgba(139,92,246,0.12)' }}>
              <p style={{ fontSize:9,color:'#475569',margin:'0 0 4px',letterSpacing:'0.1em',textTransform:'uppercase' }}>{item.label}</p>
              <p style={{ fontSize:14,fontWeight:800,color:item.color,margin:0,fontFamily:'monospace' }}>{item.value}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Backend Test ── */}
      <Section icon={<Bell size={13} style={{ color:'#8b5cf6' }} />} title="Backend Test" accent="#8b5cf6">
        <button onClick={testImageAnalysis}
          style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 18px',background:'rgba(139,92,246,0.1)',border:'1px solid rgba(139,92,246,0.35)',borderRadius:5,color:'#a78bfa',cursor:'pointer',fontSize:11,fontWeight:700,letterSpacing:'0.1em',marginBottom:12 }}>
          <Zap size={13} /> RUN TEST
        </button>
        {testLog && (
          <pre style={{ background:'rgba(0,0,0,0.5)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:5,padding:'12px 16px',fontSize:11,color:'#34d399',fontFamily:'monospace',whiteSpace:'pre-wrap',maxHeight:180,overflowY:'auto',margin:0 }}>
            {testLog}
          </pre>
        )}
      </Section>
    </div>
  )
}

function Section({ icon, title, accent, children }) {
  return (
    <div style={{ background:'rgba(17,17,32,0.9)',border:`1px solid ${accent}22`,borderRadius:6,overflow:'hidden' }}>
      <div style={{ padding:'10px 18px',borderBottom:`1px solid ${accent}18`,display:'flex',alignItems:'center',gap:8 }}>
        {icon}
        <span style={{ fontSize:10,fontWeight:700,letterSpacing:'0.14em',color:accent,textTransform:'uppercase' }}>{title}</span>
      </div>
      <div style={{ padding:'14px 18px',display:'flex',flexDirection:'column',gap:10 }}>
        {children}
      </div>
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange }) {
  return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',gap:16 }}>
      <div>
        <p style={{ fontSize:13,fontWeight:600,color:'#e2e8f0',margin:'0 0 2px' }}>{label}</p>
        <p style={{ fontSize:10,color:'#475569',margin:0 }}>{desc}</p>
      </div>
      <button onClick={onChange} className={checked ? 'toggle-track on' : 'toggle-track'} style={{ flexShrink:0 }}>
        <span className="toggle-dot" />
      </button>
    </div>
  )
}
