import { X, Send, Zap, ChevronRight } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

/* Quick-action chips shown before the user types anything */
const QUICK_ACTIONS = [
  'Is this content real?',
  'Explain the risk level',
  'What are deepfake artifacts?',
  'How accurate is this scan?',
]

export default function ChatPanel({ onClose }) {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "Hello! I'm Entity X AI. I can help you analyze detected content, explain forensic findings, and provide insights about AI-generated media on the web.",
      ts: Date.now(),
    },
  ])
  const [input, setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const sendMessage = async (text) => {
    const content = (text || input).trim()
    if (!content) return
    const userMsg = { id: messages.length + 1, role: 'user', content, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    try {
      if (window.entityX?.aiChat) {
        const response = await window.entityX.aiChat(
          [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user', content }],
          null,
        )
        const reply = typeof response === 'string'
          ? response
          : response?.response || response?.content || JSON.stringify(response)
        setMessages(prev => [...prev, { id: prev.length + 1, role: 'assistant', content: reply, ts: Date.now() }])
      }
    } catch {
      setMessages(prev => [...prev, {
        id: prev.length + 1, role: 'assistant', ts: Date.now(),
        content: 'Sorry, I encountered an error. Please try again.',
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#080e1c',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', position: 'relative',
      fontFamily: 'inherit',
    }}>

      {/* ══ HEADER ══ */}
      <div style={{
        flexShrink: 0,
        background: 'linear-gradient(135deg, #0d0620 0%, #080e1c 100%)',
        borderBottom: '1px solid rgba(139,92,246,0.18)',
        padding: '14px 16px',
        position: 'relative',
      }}>
        {/* Top accent line */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: 'linear-gradient(90deg, #8b5cf6, #8b5cf6, #8b5cf6)',
          backgroundSize: '200% 100%',
          animation: 'cp-slide 3s linear infinite',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Avatar */}
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(0,212,255,0.1))',
            border: '1px solid rgba(139,92,246,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 16px rgba(139,92,246,0.25)',
            position: 'relative',
          }}>
            <Zap size={16} color="#a78bfa" style={{ filter: 'drop-shadow(0 0 4px #8b5cf6)' }} />
            {/* Online dot */}
            <div style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 9, height: 9, borderRadius: '50%',
              background: '#34d399', border: '2px solid #080e1c',
              boxShadow: '0 0 6px #34d399',
              animation: 'cp-pulse 2s ease-in-out infinite',
            }} />
          </div>

          {/* Name + subtitle */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 800, letterSpacing: '0.1em',
              background: 'linear-gradient(90deg, #c4a0ff, #60cfff)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              ENTITY X AI
            </div>
            <div style={{ fontSize: 9, color: '#4a3a7a', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>
              Forensic Intelligence · Online
            </div>
          </div>

          {/* Close */}
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: 6, flexShrink: 0,
              background: 'rgba(255,45,85,0.06)', border: '1px solid rgba(255,45,85,0.15)',
              cursor: 'pointer', color: '#4a2a3a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.15)'; e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(255,45,85,0.35)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,45,85,0.06)'; e.currentTarget.style.color = '#4a2a3a'; e.currentTarget.style.borderColor = 'rgba(255,45,85,0.15)' }}
            title="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ══ MESSAGES ══ */}
      <div
        className="chat-messages"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '16px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          minHeight: 0,           /* ← critical: lets flex child shrink and scroll */
        }}
      >

        {messages.map((msg) => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 4,
          }}>
            {/* Role label */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              ...(msg.role === 'user' ? { flexDirection: 'row-reverse' } : {}),
            }}>
              {/* Icon */}
              <div style={{
                width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                background: msg.role === 'user'
                  ? 'rgba(255,255,255,0.07)'
                  : 'rgba(139,92,246,0.14)',
                border: msg.role === 'user'
                  ? '1px solid rgba(139,92,246,0.28)'
                  : '1px solid rgba(139,92,246,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {msg.role === 'user'
                  ? <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#8b5cf6' }} />
                  : <Zap size={9} color="#a78bfa" />
                }
              </div>
              <span style={{
                fontSize: 9, fontWeight: 700,
                color: msg.role === 'user' ? '#3d7aaa' : '#6a3aaa',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}>
                {msg.role === 'user' ? 'You' : 'Entity X'}
              </span>
              <span style={{ fontSize: 8, color: '#1a2a3a' }}>{fmtTime(msg.ts)}</span>
            </div>

            {/* Bubble */}
            <div style={{
              maxWidth: '88%',
              padding: '10px 13px',
              borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
              fontSize: 12.5, lineHeight: 1.65,
              background: msg.role === 'user'
                ? 'linear-gradient(135deg, rgba(0,212,255,0.1) 0%, rgba(0,130,180,0.08) 100%)'
                : 'linear-gradient(135deg, rgba(18,10,36,0.9) 0%, rgba(30,16,56,0.8) 100%)',
              border: msg.role === 'user'
                ? '1px solid rgba(0,212,255,0.22)'
                : '1px solid rgba(139,92,246,0.16)',
              color: msg.role === 'user' ? '#c0d8f0' : '#b0c4dc',
              boxShadow: msg.role === 'user'
                ? '0 2px 12px rgba(139,92,246,0.06)'
                : '0 2px 12px rgba(0,0,0,0.25)',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 18, height: 18, borderRadius: 5,
                background: 'rgba(139,92,246,0.14)', border: '1px solid rgba(139,92,246,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Zap size={9} color="#a78bfa" />
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#6a3aaa', letterSpacing: '0.1em' }}>ENTITY X</span>
            </div>
            <div style={{
              padding: '10px 16px',
              background: 'linear-gradient(135deg, rgba(18,10,36,0.9), rgba(30,16,56,0.8))',
              border: '1px solid rgba(139,92,246,0.16)',
              borderRadius: '4px 12px 12px 12px',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {[0, 0.15, 0.30].map((delay, i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#8b5cf6',
                  animation: `cp-dot 1.2s ease-in-out ${delay}s infinite`,
                  boxShadow: '0 0 4px rgba(139,92,246,0.6)',
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* ══ QUICK ACTIONS ══ */}
      {messages.length <= 1 && !loading && (
        <div style={{
          padding: '0 14px 10px',
          flexShrink: 0,
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          <div style={{ fontSize: 8, color: '#2a3a5a', letterSpacing: '0.14em', marginBottom: 2, textTransform: 'uppercase' }}>
            Quick questions
          </div>
          {QUICK_ACTIONS.map((q, i) => (
            <button
              key={i}
              onClick={() => sendMessage(q)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '7px 11px', borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.12)',
                color: '#7a6aaa', fontSize: 11, transition: 'all 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.1)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.28)'; e.currentTarget.style.color = '#a78bfa' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.04)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.12)'; e.currentTarget.style.color = '#7a6aaa' }}
            >
              {q}
              <ChevronRight size={11} style={{ flexShrink: 0, marginLeft: 6, opacity: 0.5 }} />
            </button>
          ))}
        </div>
      )}

      {/* ══ INPUT ══ */}
      <div style={{
        flexShrink: 0,
        padding: '12px 14px 14px',
        borderTop: '1px solid rgba(139,92,246,0.12)',
        background: 'linear-gradient(0deg, rgba(5,3,14,0.98), rgba(8,14,28,0.96))',
      }}>
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-end',
          background: 'rgba(139,92,246,0.04)',
          border: '1px solid rgba(139,92,246,0.18)',
          borderRadius: 10, padding: '8px 8px 8px 12px',
          transition: 'all 0.2s',
        }}
          onFocusCapture={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.42)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(139,92,246,0.1)' }}
          onBlurCapture={e => { e.currentTarget.style.borderColor = 'rgba(139,92,246,0.18)'; e.currentTarget.style.boxShadow = 'none' }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => {
              setInput(e.target.value)
              /* auto-grow up to 4 rows */
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px'
            }}
            onKeyDown={handleKey}
            placeholder="Ask about this content…"
            disabled={loading}
            style={{
              flex: 1, resize: 'none', overflow: 'hidden',
              background: 'transparent', border: 'none', outline: 'none',
              color: '#c0d0e8', fontSize: 12.5, fontFamily: 'inherit',
              lineHeight: 1.5, padding: 0,
              minHeight: 20, maxHeight: 80,
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{
              width: 32, height: 32, borderRadius: 7, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: loading || !input.trim() ? 'transparent' : 'rgba(139,92,246,0.22)',
              border: `1px solid ${loading || !input.trim() ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.5)'}`,
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              color: loading || !input.trim() ? '#2a1a4a' : '#c4a0ff',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!loading && input.trim()) { e.currentTarget.style.background = 'rgba(139,92,246,0.35)'; e.currentTarget.style.boxShadow = '0 0 14px rgba(139,92,246,0.35)' }}}
            onMouseLeave={e => { e.currentTarget.style.background = loading || !input.trim() ? 'transparent' : 'rgba(139,92,246,0.22)'; e.currentTarget.style.boxShadow = 'none' }}
          >
            <Send size={13} />
          </button>
        </div>

        <div style={{ marginTop: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(139,92,246,0.3)' }} />
          <span style={{ fontSize: 8, color: '#1e2030', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Entity X · Multi-Model AI · Enter to send
          </span>
          <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(139,92,246,0.3)' }} />
        </div>
      </div>

      {/* ── keyframes ── */}
      <style>{`
        @keyframes cp-slide {
          0%   { background-position: 0% 0%; }
          100% { background-position: 200% 0%; }
        }
        @keyframes cp-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 6px #34d399; }
          50%       { opacity: 0.5; box-shadow: 0 0 2px #34d399; }
        }
        @keyframes cp-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1.2); opacity: 1; }
        }

        /* Custom scrollbar for the messages area */
        .chat-messages::-webkit-scrollbar { width: 4px; }
        .chat-messages::-webkit-scrollbar-track { background: transparent; }
        .chat-messages::-webkit-scrollbar-thumb { background: rgba(139,92,246,0.25); border-radius: 2px; }
        .chat-messages::-webkit-scrollbar-thumb:hover { background: rgba(139,92,246,0.45); }
      `}</style>
    </div>
  )
}
