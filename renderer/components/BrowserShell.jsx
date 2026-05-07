/**
 * BrowserShell — Full futuristic HUD browser chrome
 * Each tab has its own <webview> (shown/hidden), so switching tabs is instant
 * and navigation is 100% imperative (no JSX src feedback loop).
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, RotateCcw, Home, Shield, Globe, Lock,
  Plus, X, Zap, Wifi, MessageSquare, AlertTriangle, Eye,
  Send, Bot, User, Loader, Sparkles, StopCircle,
} from 'lucide-react'

/* ─── helpers ─── */
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}
function isHttps(url) { return url?.startsWith('https://') }
function formatUrl(url) {
  try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + u.pathname.slice(0, 40) }
  catch { return url }
}

const PRESETS = [
  { label: 'Google',   url: 'https://www.google.com' },
  { label: 'BBC',       url: 'https://bbc.com' },
  { label: 'Reuters',   url: 'https://reuters.com' },
  { label: 'Wikipedia', url: 'https://en.wikipedia.org' },
]

let _tabId = 0
function mkTab(url) {
  return { id: ++_tabId, url, initialUrl: url, title: getDomain(url), loading: false }
}

export default function BrowserShell({
  initialUrl = 'https://www.google.com',
  onUrlChange,
  onChatToggle,
  threatCount = 0,
  highThreatCount = 0,
}) {
  /* One ref map for all webviews: tabId → DOM element */
  const webviewRefs = useRef({})

  const [preloadPath, setPreloadPath] = useState(null)
  const [tabs, setTabs]               = useState([mkTab(initialUrl)])
  const [activeTab, setActiveTab]     = useState(_tabId)
  const [inputUrl, setInputUrl]       = useState(initialUrl)
  const [focused, setFocused]         = useState(false)
  const [loading, setLoading]         = useState(false)
  const [scanActive, setScanActive]   = useState(false)
  const [canBack, setCanBack]         = useState(false)
  const [canFwd, setCanFwd]           = useState(false)
  const [secure, setSecure]           = useState(isHttps(initialUrl))
  const [hudMsg, setHudMsg]           = useState('MONITORING ACTIVE')
  const [pulseHud, setPulseHud]       = useState(false)
  const inputRef = useRef(null)

  const activeTabObj = tabs.find(t => t.id === activeTab)

  /* ── AI Agent panel state ── */
  const [agentOpen,    setAgentOpen]    = useState(false)
  const [agentMsgs,    setAgentMsgs]    = useState([
    { role: 'assistant', content: "Hi! I'm your browser agent. Tell me where to go or what to do — I'll take care of it." }
  ])
  const [agentInput,   setAgentInput]   = useState('')
  const [agentBusy,    setAgentBusy]    = useState(false)
  const agentEndRef  = useRef(null)
  const agentInputRef = useRef(null)

  /* Auto-scroll chat to bottom */
  useEffect(() => {
    agentEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [agentMsgs])

  /* Extract current page context from the active webview */
  const getPageContext = useCallback(async () => {
    const wv = webviewRefs.current[activeTab]
    if (!wv) return { url: inputUrl, title: '', text: '', elements: {} }
    try {
      const raw = await wv.executeJavaScript(`
        (() => {
          try {
            const text = (document.body?.innerText || '').replace(/\\s+/g,' ').substring(0, 3000);
            const links = Array.from(document.querySelectorAll('a[href]'))
              .slice(0, 30).map(a => ({ text: (a.innerText||'').trim().substring(0,60), href: a.href }))
              .filter(l => l.text && l.href.startsWith('http'));
            const buttons = Array.from(document.querySelectorAll('button,[role="button"]'))
              .slice(0,20).map(b => (b.innerText||b.getAttribute('aria-label')||'').trim().substring(0,50))
              .filter(Boolean);
            const inputs = Array.from(document.querySelectorAll('input,textarea'))
              .slice(0,8).map(i => ({ type:i.type, placeholder:i.placeholder, name:i.name, id:i.id }));
            return JSON.stringify({ title: document.title, text, links, buttons, inputs });
          } catch(e) { return JSON.stringify({ title: document.title, text:'', links:[], buttons:[], inputs:[] }); }
        })()
      `)
      const parsed = JSON.parse(raw)
      return { url: wv.getURL?.() || inputUrl, ...parsed, elements: { links: parsed.links, buttons: parsed.buttons, inputs: parsed.inputs } }
    } catch {
      return { url: inputUrl, title: '', text: '', elements: {} }
    }
  }, [activeTab, inputUrl])

  /* ── Nav action — defined early so executeAction can reference it ── */
  const navigate = useCallback((rawUrl) => {
    let url = rawUrl.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) {
      url = url.includes('.') && !url.includes(' ')
        ? 'https://' + url
        : `https://www.google.com/search?q=${encodeURIComponent(url)}`
    }
    setInputUrl(url)
    setSecure(isHttps(url))
    /* Imperative only — never via JSX src prop to avoid feedback loop */
    const wv = webviewRefs.current[activeTab]
    if (wv) wv.src = url
    setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, url } : t))
    onUrlChange?.(url)
    flashHud('NAVIGATING')
  }, [activeTab, onUrlChange])

  /* Execute a single action returned by the AI */
  const executeAction = useCallback(async (action) => {
    const wv = webviewRefs.current[activeTab]
    if (!wv) return

    switch (action.type) {
      case 'navigate':
        if (action.url) { navigate(action.url) }
        break

      case 'search': {
        const engines = {
          google:     q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
          youtube:    q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
          bing:       q => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
          duckduckgo: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
          wikipedia:  q => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
        }
        const builder = engines[action.engine?.toLowerCase()] || engines.google
        navigate(builder(action.query || ''))
        break
      }

      case 'click':
        try {
          if (action.selector) {
            await wv.executeJavaScript(`
              (() => { const el = document.querySelector(${JSON.stringify(action.selector)}); if(el){el.click();return 'ok';} return 'not_found'; })()
            `)
          } else if (action.text) {
            await wv.executeJavaScript(`
              (() => {
                const needle = ${JSON.stringify((action.text||'').toLowerCase())};
                const all = [...document.querySelectorAll('a,button,[role="button"],h1,h2,h3,li')];
                const match = all.find(el => (el.innerText||'').toLowerCase().includes(needle));
                if(match){match.click();return 'ok';} return 'not_found';
              })()
            `)
          }
        } catch { /* non-fatal */ }
        break

      case 'type':
        try {
          const sel = JSON.stringify(action.selector || 'input,textarea')
          const val = JSON.stringify(action.value || '')
          await wv.executeJavaScript(`
            (() => {
              const el = document.querySelector(${sel});
              if(!el) return 'not_found';
              el.focus();
              el.value = ${val};
              el.dispatchEvent(new Event('input',{bubbles:true}));
              el.dispatchEvent(new Event('change',{bubbles:true}));
              ${action.submit ? "el.form?.submit() || el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true}));" : ''}
              return 'ok';
            })()
          `)
        } catch { /* non-fatal */ }
        break

      case 'scroll':
        try {
          if (action.direction === 'top')    await wv.executeJavaScript(`window.scrollTo({top:0,behavior:'smooth'})`)
          else if (action.direction === 'bottom') await wv.executeJavaScript(`window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})`)
          else if (action.direction === 'up')  await wv.executeJavaScript(`window.scrollBy({top:${-(action.amount||600)},behavior:'smooth'})`)
          else                                  await wv.executeJavaScript(`window.scrollBy({top:${action.amount||600},behavior:'smooth'})`)
        } catch { /* non-fatal */ }
        break

      case 'back':
        wv.goBack?.()
        break

      case 'reload':
        wv.reload?.()
        flashHud('RELOADING')
        break

      case 'wait':
        await new Promise(r => setTimeout(r, Math.min(action.ms || 1000, 5000)))
        break

      default:
        break
    }
  }, [activeTab, navigate])

  /* Send a message to the AI agent */
  const sendAgentMessage = useCallback(async () => {
    const text = agentInput.trim()
    if (!text || agentBusy) return

    const userMsg = { role: 'user', content: text }
    setAgentMsgs(prev => [...prev, userMsg])
    setAgentInput('')
    setAgentBusy(true)

    // Add a thinking placeholder
    setAgentMsgs(prev => [...prev, { role: 'assistant', content: '', thinking: true }])

    try {
      const pageContext = await getPageContext()
      const history = agentMsgs.filter(m => !m.thinking).concat(userMsg).slice(-10)

      const res = await window.entityX.browserAgent(history, pageContext)

      // Replace placeholder with real reply
      setAgentMsgs(prev => {
        const withoutThinking = prev.filter(m => !m.thinking)
        const actionSummary = res.actions?.length
          ? `\n\n*${res.actions.length} action${res.actions.length > 1 ? 's' : ''} queued*`
          : ''
        return [...withoutThinking, { role: 'assistant', content: (res.reply || 'Done.') + actionSummary }]
      })

      // Execute actions in sequence
      if (res.actions?.length) {
        for (const action of res.actions) {
          await executeAction(action)
          if (action.type === 'navigate' || action.type === 'search') {
            await new Promise(r => setTimeout(r, 800))
          }
        }
      }
    } catch (e) {
      setAgentMsgs(prev => prev.filter(m => !m.thinking).concat({ role: 'assistant', content: `Sorry, something went wrong: ${e.message}` }))
    } finally {
      setAgentBusy(false)
      setTimeout(() => agentInputRef.current?.focus(), 100)
    }
  }, [agentInput, agentBusy, agentMsgs, getPageContext, executeAction])

  /* ── preload path (async, one-time) ── */
  useEffect(() => {
    if (window.entityX?.getWebviewPreloadPath) {
      window.entityX.getWebviewPreloadPath().then(p => setPreloadPath(p))
    } else {
      setPreloadPath('')
    }
  }, [])

  function flashHud(msg) {
    setHudMsg(msg)
    setPulseHud(true)
    setTimeout(() => { setHudMsg('MONITORING ACTIVE'); setPulseHud(false) }, 2000)
  }

  /* ── Attach events to the active webview.
   *    Runs when activeTab changes OR when tabs.length changes (new tab mounted). ── */
  useEffect(() => {
    const wv = webviewRefs.current[activeTab]
    if (!wv) return

    /* Sync UI from this webview's current state (important on tab switch) */
    try {
      const url = wv.getURL?.()
      if (url && url !== 'about:blank' && url !== '') {
        setInputUrl(url)
        setSecure(isHttps(url))
        setCanBack(wv.canGoBack?.() ?? false)
        setCanFwd(wv.canGoForward?.() ?? false)
      }
    } catch (_) {}

    const onStart = () => { setLoading(true); setScanActive(true) }
    const onStop  = () => {
      setLoading(false)
      setTimeout(() => setScanActive(false), 1200)
      const url = wv.getURL?.() || ''
      if (url) {
        setInputUrl(url)
        setSecure(isHttps(url))
        setCanBack(wv.canGoBack?.() ?? false)
        setCanFwd(wv.canGoForward?.() ?? false)
        setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, url, title: getDomain(url) } : t))
        onUrlChange?.(url)
        flashHud('URL CAPTURED')
      }
    }
    const onTitle = (e) => {
      const title = e.title || getDomain(wv.getURL?.() || '')
      setTabs(prev => prev.map(t => t.id === activeTab ? { ...t, title: title.slice(0, 24) } : t))
    }
    const onNav = (e) => {
      if (e.url) {
        setInputUrl(e.url)
        setSecure(isHttps(e.url))
        onUrlChange?.(e.url)
        if (window.entityX?.notifyNavigated) window.entityX.notifyNavigated(e.url)
      }
    }

    wv.addEventListener('did-start-loading',    onStart)
    wv.addEventListener('did-stop-loading',     onStop)
    wv.addEventListener('page-title-updated',   onTitle)
    wv.addEventListener('did-navigate',         onNav)
    wv.addEventListener('did-navigate-in-page', onNav)

    return () => {
      wv.removeEventListener('did-start-loading',    onStart)
      wv.removeEventListener('did-stop-loading',     onStop)
      wv.removeEventListener('page-title-updated',   onTitle)
      wv.removeEventListener('did-navigate',         onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [activeTab, tabs.length, onUrlChange]) // tabs.length triggers re-run when a new webview mounts

  const handleKey = (e) => {
    if (e.key === 'Enter') { navigate(inputUrl); inputRef.current?.blur() }
    if (e.key === 'Escape') { inputRef.current?.blur(); setInputUrl(activeTabObj?.url || '') }
  }

  const goBack  = () => webviewRefs.current[activeTab]?.goBack?.()
  const goFwd   = () => webviewRefs.current[activeTab]?.goForward?.()
  const reload  = () => { webviewRefs.current[activeTab]?.reload?.(); flashHud('RELOADING') }
  const goHome  = () => navigate('https://www.google.com')

  /* ── Tabs ── */
  const addTab = () => {
    const t = mkTab('https://www.google.com')
    setTabs(prev => [...prev, t])
    setActiveTab(t.id)
    setInputUrl(t.url)
    setSecure(isHttps(t.url))
    setCanBack(false)
    setCanFwd(false)
  }

  const closeTab = (id, e) => {
    e.stopPropagation()
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const fresh = mkTab('https://www.google.com')
        setActiveTab(fresh.id)
        setInputUrl(fresh.url)
        return [fresh]
      }
      if (id === activeTab) {
        const idx = prev.findIndex(t => t.id === id)
        const fallback = prev[idx + 1] || prev[idx - 1]
        if (fallback) switchToTab(fallback)
      }
      return next
    })
    /* Clean up the webview ref */
    delete webviewRefs.current[id]
  }

  const switchToTab = (tab) => {
    setActiveTab(tab.id)
    /* Read webview's ACTUAL current URL (may differ from saved tab.url after navigation) */
    const wv = webviewRefs.current[tab.id]
    if (wv) {
      try {
        const url = wv.getURL?.() || tab.url
        setInputUrl(url || tab.url)
        setSecure(isHttps(url || tab.url))
        setCanBack(wv.canGoBack?.() ?? false)
        setCanFwd(wv.canGoForward?.() ?? false)
      } catch (_) {
        setInputUrl(tab.url)
        setSecure(isHttps(tab.url))
      }
    } else {
      setInputUrl(tab.url)
      setSecure(isHttps(tab.url))
    }
  }

  if (preloadPath === null) {
    return (
      <div style={{ flex: 1, background: '#060610', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#8b5cf6', fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', animation: 'pulse 1.5s ease-in-out infinite' }}>
          Initializing HUD…
        </div>
      </div>
    )
  }

  const isHighThreat = highThreatCount > 0

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* ══════════════════════════════════════════
          CHROME — top bar + tabs + URL
          ══════════════════════════════════════════ */}
      <div style={{
        background: 'rgba(2,8,20,0.99)',
        borderBottom: `1px solid ${isHighThreat ? 'rgba(255,45,85,0.3)' : 'rgba(255,255,255,0.07)'}`,
        flexShrink: 0,
        transition: 'border-color 0.4s',
      }}>

        {/* ── ROW 1: HUD Status strip ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 0,
          height: 22,
          borderBottom: '1px solid rgba(139,92,246,0.06)',
          padding: '0 10px',
          background: 'rgba(0,212,255,0.02)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 14 }}>
            <div style={{
              width: 14, height: 14, background: 'rgba(0,212,255,0.1)',
              border: '1px solid rgba(139,92,246,0.38)', borderRadius: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 6px rgba(139,92,246,0.28)',
            }}>
              <Zap size={8} color="#8b5cf6" />
            </div>
            <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.18em', color: '#8b5cf6', textTransform: 'uppercase' }}>
              ENTITY<span style={{ color: 'rgba(139,92,246,0.5)' }}>X</span>
            </span>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '1px 8px', borderRadius: 2,
            background: pulseHud ? 'rgba(0,212,255,0.1)' : 'transparent',
            border: pulseHud ? '1px solid rgba(139,92,246,0.18)' : '1px solid transparent',
            transition: 'all 0.3s',
          }}>
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: isHighThreat ? '#f87171' : '#34d399',
              boxShadow: `0 0 5px ${isHighThreat ? '#f87171' : '#34d399'}`,
              animation: 'pulse 1.8s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 8, fontWeight: 700, color: isHighThreat ? '#f87171' : '#8b5cf6', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              {hudMsg}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {threatCount > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '1px 7px', borderRadius: 2,
                background: isHighThreat ? 'rgba(255,45,85,0.12)' : 'rgba(255,170,0,0.08)',
                border: `1px solid ${isHighThreat ? 'rgba(255,45,85,0.35)' : 'rgba(255,170,0,0.2)'}`,
              }}>
                <AlertTriangle size={7} color={isHighThreat ? '#f87171' : '#fbbf24'} />
                <span style={{ fontSize: 8, fontWeight: 800, color: isHighThreat ? '#f87171' : '#fbbf24', letterSpacing: '0.12em' }}>
                  {threatCount} DETECTED
                </span>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <Wifi size={9} color="rgba(139,92,246,0.5)" />
              <span style={{ fontSize: 7, color: '#475569', letterSpacing: '0.1em', fontFamily: 'monospace' }}>LIVE</span>
            </div>
          </div>
        </div>

        {/* ── ROW 2: TABS ── */}
        <div style={{
          display: 'flex', alignItems: 'center',
          height: 30, padding: '0 6px',
          borderBottom: '1px solid rgba(139,92,246,0.06)',
          gap: 2, overflowX: 'auto', overflowY: 'hidden',
        }}>
          {tabs.map(tab => {
            const isActive = tab.id === activeTab
            return (
              <div
                key={tab.id}
                onClick={() => switchToTab(tab)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  height: 22, padding: '0 8px 0 10px',
                  borderRadius: '4px 4px 0 0',
                  cursor: 'pointer', flexShrink: 0, minWidth: 80, maxWidth: 160,
                  background: isActive ? 'rgba(139,92,246,0.08)' : 'rgba(0,212,255,0.02)',
                  border: `1px solid ${isActive ? 'rgba(139,92,246,0.22)' : 'rgba(0,212,255,0.07)'}`,
                  borderBottom: isActive ? '1px solid rgba(2,8,20,0.99)' : '1px solid rgba(0,212,255,0.07)',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                {isActive && (
                  <div style={{
                    position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                    background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)',
                    boxShadow: '0 0 6px rgba(0,212,255,0.6)',
                  }} />
                )}
                <Globe size={9} color={isActive ? '#8b5cf6' : '#475569'} style={{ flexShrink: 0 }} />
                <span style={{
                  fontSize: 9, fontWeight: isActive ? 700 : 500,
                  color: isActive ? '#e2e8f0' : '#475569',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  letterSpacing: '0.05em', flex: 1,
                  transition: 'color 0.15s',
                }}>
                  {tab.title || 'New Tab'}
                </span>
                {tabs.length > 1 && (
                  <div
                    onClick={(e) => closeTab(tab.id, e)}
                    style={{
                      width: 12, height: 12, borderRadius: 2, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', color: '#475569', transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.15)'; e.currentTarget.style.color = '#f87171' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569' }}
                  >
                    <X size={8} />
                  </div>
                )}
              </div>
            )
          })}

          <button
            onClick={addTab}
            style={{
              width: 22, height: 22, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: '1px solid rgba(139,92,246,0.08)',
              cursor: 'pointer', color: '#475569', marginLeft: 2, transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.06)'; e.currentTarget.style.color = '#8b5cf6' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#475569' }}
            title="New Tab"
          >
            <Plus size={10} />
          </button>

          <div style={{ flex: 1 }} />

          {/* Presets — open in current tab */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', paddingRight: 4 }}>
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => navigate(p.url)}
                style={{
                  padding: '2px 7px', borderRadius: 3,
                  background: 'transparent', border: '1px solid rgba(139,92,246,0.08)',
                  cursor: 'pointer', color: '#2a4a65', fontSize: 8, fontWeight: 700,
                  letterSpacing: '0.1em', textTransform: 'uppercase', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.06)'; e.currentTarget.style.color = '#8b5cf6'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.22)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#2a4a65'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.08)' }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setAgentOpen(o => !o)}
            title="AI Browser Agent"
            style={{
              width: 24, height: 24, borderRadius: 4, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.25)',
              cursor: 'pointer', color: '#8b5cf6', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.18)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(139,92,246,0.3)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.boxShadow = 'none' }}
          >
            <MessageSquare size={12} />
          </button>
        </div>

        {/* ── ROW 3: URL BAR ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px' }}>
          {[
            { Icon: ChevronLeft,  action: goBack,  disabled: !canBack, title: 'Back'    },
            { Icon: ChevronRight, action: goFwd,   disabled: !canFwd,  title: 'Forward' },
            { Icon: RotateCcw,    action: reload,  disabled: false,    title: 'Reload', spin: loading },
            { Icon: Home,         action: goHome,  disabled: false,    title: 'Home'    },
          ].map(({ Icon, action, disabled, title, spin }, i) => (
            <button key={i} onClick={action} disabled={disabled} title={title}
              style={{
                width: 26, height: 26, borderRadius: 5, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: disabled ? 'transparent' : 'rgba(139,92,246,0.04)',
                border: `1px solid ${disabled ? 'rgba(139,92,246,0.06)' : 'rgba(0,212,255,0.14)'}`,
                cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? '#334155' : '#4a7aaa', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = 'rgba(0,212,255,0.1)'; e.currentTarget.style.color = '#8b5cf6' }}}
              onMouseLeave={e => { if (!disabled) { e.currentTarget.style.background = 'rgba(139,92,246,0.04)'; e.currentTarget.style.color = '#4a7aaa' }}}
            >
              <Icon size={12} style={spin ? { animation: 'spin 0.6s linear infinite' } : {}} />
            </button>
          ))}

          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', height: 28 }}>
            <div style={{ position: 'absolute', left: 9, zIndex: 3, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
              {secure
                ? <Lock size={10} color="#34d399" style={{ filter: 'drop-shadow(0 0 3px #34d399)' }} />
                : <Globe size={10} color="#475569" />
              }
            </div>
            <input
              ref={inputRef}
              type="text"
              value={focused ? inputUrl : formatUrl(inputUrl)}
              onChange={e => setInputUrl(e.target.value)}
              onKeyDown={handleKey}
              onFocus={() => { setFocused(true); setInputUrl(activeTabObj?.url || inputUrl); setTimeout(() => inputRef.current?.select(), 10) }}
              onBlur={() => { setFocused(false); setInputUrl(activeTabObj?.url || inputUrl) }}
              style={{
                width: '100%', height: '100%', padding: '0 36px 0 28px',
                background: focused ? 'rgba(139,92,246,0.06)' : 'rgba(0,212,255,0.025)',
                border: `1px solid ${focused ? 'rgba(0,212,255,0.45)' : isHighThreat ? 'rgba(255,45,85,0.2)' : 'rgba(255,255,255,0.07)'}`,
                borderRadius: 5, color: focused ? '#f1f5f9' : '#64748b',
                fontSize: 11, fontFamily: 'monospace', outline: 'none', transition: 'all 0.2s',
                letterSpacing: focused ? '0' : '0.02em',
              }}
              placeholder="Navigate to URL or search…"
            />
            <div style={{ position: 'absolute', right: 9, zIndex: 3, pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
              <Eye size={10} color={scanActive ? '#8b5cf6' : '#334155'} style={{ transition: 'color 0.3s', filter: scanActive ? 'drop-shadow(0 0 3px #8b5cf6)' : 'none' }} />
            </div>
            {(scanActive || loading) && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 1,
                background: 'linear-gradient(90deg, transparent 0%, #8b5cf6 50%, transparent 100%)',
                animation: 'scan-beam 1.2s linear infinite', borderRadius: '0 0 5px 5px', opacity: 0.8,
              }} />
            )}
            {focused && <>
              <div style={{ position: 'absolute', top: 1, left: 1,   width: 6, height: 6, borderTop:    '1px solid #8b5cf6', borderLeft:  '1px solid #8b5cf6', opacity: 0.7, borderRadius: '2px 0 0 0' }} />
              <div style={{ position: 'absolute', top: 1, right: 1,  width: 6, height: 6, borderTop:    '1px solid #8b5cf6', borderRight: '1px solid #8b5cf6', opacity: 0.7, borderRadius: '0 2px 0 0' }} />
              <div style={{ position: 'absolute', bottom: 1, left: 1,  width: 6, height: 6, borderBottom: '1px solid #8b5cf6', borderLeft:  '1px solid #8b5cf6', opacity: 0.7, borderRadius: '0 0 0 2px' }} />
              <div style={{ position: 'absolute', bottom: 1, right: 1, width: 6, height: 6, borderBottom: '1px solid #8b5cf6', borderRight: '1px solid #8b5cf6', opacity: 0.7, borderRadius: '0 0 2px 0' }} />
            </>}
          </div>

          <button onClick={() => navigate(inputUrl)}
            style={{
              width: 26, height: 26, borderRadius: 5, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.22)',
              cursor: 'pointer', color: '#8b5cf6', fontSize: 10, fontWeight: 800,
              letterSpacing: '0.1em', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.18)'; e.currentTarget.style.boxShadow = '0 0 10px rgba(139,92,246,0.28)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.08)'; e.currentTarget.style.boxShadow = 'none' }}
            title="Go"
          >↵</button>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            padding: '0 10px', height: 26, borderRadius: 5,
            background: secure ? 'rgba(0,255,149,0.06)' : 'rgba(61,100,145,0.08)',
            border: `1px solid ${secure ? 'rgba(0,255,149,0.2)' : 'rgba(61,100,145,0.15)'}`,
          }}>
            <Shield size={10} color={secure ? '#34d399' : '#475569'} />
            <span style={{ fontSize: 8, fontWeight: 700, color: secure ? '#34d399' : '#475569', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {secure ? 'SECURE' : 'HTTP'}
            </span>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════
          WEBVIEW AREA + AI AGENT PANEL (side-by-side)
          ══════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>

      {/* ── Webview container ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#060610' }}>

        {/* One <webview> per tab. src=initialUrl is set ONCE at mount. All subsequent
            navigation is imperative (wv.src = url). This prevents React from fighting
            with the browser's own navigation history. */}
        {preloadPath !== null && tabs.map(tab => (
          <webview
            key={tab.id}
            ref={el => { if (el) webviewRefs.current[tab.id] = el; else delete webviewRefs.current[tab.id] }}
            src={tab.initialUrl}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              display: tab.id === activeTab ? 'flex' : 'none',
            }}
            partition="persist:browser"
            preload={preloadPath || undefined}
            allowpopups="true"
          />
        ))}

        {/* ── HUD corner brackets ── */}
        <div style={{ position: 'absolute', top: 8, left: 8, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{ width: 20, height: 20, borderTop: '1.5px solid rgba(139,92,246,0.5)', borderLeft: '1.5px solid rgba(139,92,246,0.5)', borderRadius: '3px 0 0 0' }} />
          <div style={{ position: 'absolute', top: -2, left: 22, fontSize: 7, color: 'rgba(139,92,246,0.38)', fontFamily: 'monospace', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
            SCAN:{loading ? 'ACTIVE' : 'READY'}
          </div>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 8, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{ width: 20, height: 20, borderTop: '1.5px solid rgba(139,92,246,0.5)', borderRight: '1.5px solid rgba(139,92,246,0.5)', borderRadius: '0 3px 0 0', marginLeft: 'auto' }} />
          {threatCount > 0 && (
            <div style={{ position: 'absolute', top: -2, right: 22, fontSize: 7, color: isHighThreat ? 'rgba(255,45,85,0.7)' : 'rgba(255,170,0,0.6)', fontFamily: 'monospace', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
              {threatCount} THREAT{threatCount > 1 ? 'S' : ''} LOGGED
            </div>
          )}
        </div>
        <div style={{ position: 'absolute', bottom: 8, left: 8, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{ width: 20, height: 20, borderBottom: '1.5px solid rgba(139,92,246,0.28)', borderLeft: '1.5px solid rgba(139,92,246,0.28)', borderRadius: '0 0 0 3px' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 8, right: 8, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{ width: 20, height: 20, borderBottom: '1.5px solid rgba(139,92,246,0.28)', borderRight: '1.5px solid rgba(139,92,246,0.28)', borderRadius: '0 0 3px 0', marginLeft: 'auto' }} />
        </div>

        {loading && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 20, pointerEvents: 'none',
            background: 'linear-gradient(90deg, transparent 0%, rgba(0,212,255,0.8) 50%, transparent 100%)',
            animation: 'scan-sweep 1s linear infinite',
            boxShadow: '0 0 12px rgba(139,92,246,0.5), 0 0 30px rgba(139,92,246,0.18)',
          }} />
        )}

        {isHighThreat && (
          <div style={{
            position: 'absolute', top: 34, left: '50%', transform: 'translateX(-50%)',
            zIndex: 30, pointerEvents: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 14px', borderRadius: 4,
            background: 'rgba(255,45,85,0.12)', border: '1px solid rgba(255,45,85,0.4)',
            backdropFilter: 'blur(4px)', animation: 'threat-blink 2s ease-in-out infinite',
          }}>
            <AlertTriangle size={9} color="#f87171" />
            <span style={{ fontSize: 9, fontWeight: 800, color: '#f87171', letterSpacing: '0.18em', textTransform: 'uppercase' }}>
              HIGH RISK CONTENT DETECTED
            </span>
          </div>
        )}

        {loading && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5,
            background: 'linear-gradient(180deg, rgba(139,92,246,0.04) 0%, transparent 40%)',
          }} />
        )}
      </div>{/* end webview container */}

      {/* ══════════════════════════════════════════
          AI AGENT PANEL
          ══════════════════════════════════════════ */}
      {agentOpen && (
        <div style={{
          width: 320, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(4,6,18,0.98)',
          borderLeft: '1px solid rgba(139,92,246,0.2)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px', borderBottom: '1px solid rgba(139,92,246,0.12)',
            background: 'rgba(139,92,246,0.06)', flexShrink: 0,
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(139,92,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={12} color="#8b5cf6" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.06em' }}>AI Browser Agent</div>
              <div style={{ fontSize: 9, color: '#475569' }}>Tell me what to do</div>
            </div>
            <div style={{ flex: 1 }} />
            {agentBusy && <Loader size={11} color="#8b5cf6" style={{ animation: 'spin 1s linear infinite' }} />}
            <button onClick={() => setAgentOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 2, display: 'flex' }}>
              <X size={13} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {agentMsgs.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 2,
                  background: msg.role === 'user' ? 'rgba(139,92,246,0.2)' : 'rgba(0,212,255,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {msg.role === 'user'
                    ? <User size={11} color="#a78bfa" />
                    : <Bot  size={11} color="#22d3ee" />}
                </div>
                <div style={{
                  maxWidth: '80%',
                  padding: '8px 10px', borderRadius: msg.role === 'user' ? '10px 2px 10px 10px' : '2px 10px 10px 10px',
                  background: msg.role === 'user' ? 'rgba(139,92,246,0.14)' : 'rgba(0,212,255,0.05)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(139,92,246,0.2)' : 'rgba(0,212,255,0.1)'}`,
                  fontSize: 11, color: msg.thinking ? '#475569' : '#c8d6e8', lineHeight: 1.5,
                  fontStyle: msg.thinking ? 'italic' : 'normal',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {msg.thinking
                    ? <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Loader size={10} style={{ animation: 'spin 1s linear infinite' }} /> thinking…</span>
                    : msg.content}
                </div>
              </div>
            ))}
            <div ref={agentEndRef} />
          </div>

          {/* Quick actions */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid rgba(139,92,246,0.08)', display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
            {['Summarize this page', 'Find main article', 'Scroll down', 'Go back'].map(q => (
              <button key={q} onClick={() => { setAgentInput(q) }}
                style={{ fontSize: 9, padding: '3px 8px', borderRadius: 20, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.15)', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(139,92,246,0.1)', display: 'flex', gap: 6, flexShrink: 0 }}>
            <input
              ref={agentInputRef}
              value={agentInput}
              onChange={e => setAgentInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage() } }}
              placeholder="Tell the agent what to do…"
              disabled={agentBusy}
              style={{
                flex: 1, background: 'rgba(139,92,246,0.06)',
                border: '1px solid rgba(139,92,246,0.2)', borderRadius: 8,
                padding: '8px 10px', color: '#f1f5f9', fontSize: 11,
                outline: 'none', opacity: agentBusy ? 0.6 : 1,
              }}
            />
            <button onClick={sendAgentMessage} disabled={agentBusy || !agentInput.trim()}
              style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: agentBusy || !agentInput.trim() ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.2)',
                border: '1px solid rgba(139,92,246,0.25)',
                cursor: agentBusy || !agentInput.trim() ? 'not-allowed' : 'pointer',
                color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              <Send size={13} />
            </button>
          </div>
        </div>
      )}

      </div>{/* end outer flex (webview + agent panel) */}

      {/* ══════════════════════════════════════════
          STATUS BAR
          ══════════════════════════════════════════ */}
      <div style={{
        height: 18, background: 'rgba(2,5,14,0.98)',
        borderTop: `1px solid ${isHighThreat ? 'rgba(255,45,85,0.2)' : 'rgba(0,212,255,0.07)'}`,
        display: 'flex', alignItems: 'center', padding: '0 12px', gap: 16, flexShrink: 0,
      }}>
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#334155', letterSpacing: '0.1em' }}>
          {isHttps(inputUrl) ? '🔒' : '⚪'} {getDomain(inputUrl)}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 7, fontFamily: 'monospace', color: '#334155', letterSpacing: '0.12em' }}>
          {loading ? 'LOADING…' : 'READY'} · ENTITY-X MONITOR v1.4.2
        </span>
      </div>

      {/* ── animations ── */}
      <style>{`
        @keyframes scan-beam  { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes scan-sweep { 0% { top: 0%; } 100% { top: 100%; } }
        @keyframes spin        { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
