import { ChevronLeft, ChevronRight, RotateCcw, MessageSquare, Scan, Wifi } from 'lucide-react'
import { useRef, useState } from 'react'

export default function Navbar({ currentUrl, onUrlChange, onChatToggle }) {
  const inputRef = useRef(null)
  const [focused, setFocused] = useState(false)

  const handleNavigate = (url) => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    onUrlChange(url)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') handleNavigate(e.target.value)
  }

  return (
    <div style={{
      background: 'rgba(2,8,20,0.97)',
      borderBottom: '1px solid rgba(139,92,246,0.12)',
      padding: '6px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    }}>
      {/* Nav buttons */}
      <button className="btn-icon" title="Back">
        <ChevronLeft size={14} />
      </button>
      <button className="btn-icon" title="Forward">
        <ChevronRight size={14} />
      </button>
      <button className="btn-icon" title="Reload">
        <RotateCcw size={14} />
      </button>

      {/* ── URL Bar ── */}
      <div style={{
        flex: 1,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
      }}>
        {/* scan icon */}
        <div style={{
          position: 'absolute', left: 10, zIndex: 2,
          color: focused ? '#8b5cf6' : '#475569',
          transition: 'color 0.2s',
          pointerEvents: 'none',
        }}>
          <Scan size={12} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={currentUrl}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyPress={handleKeyPress}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            width: '100%',
            padding: '7px 12px 7px 30px',
            background: focused ? 'rgba(139,92,246,0.07)' : 'rgba(139,92,246,0.03)',
            border: `1px solid ${focused ? 'rgba(139,92,246,0.5)' : 'rgba(139,92,246,0.15)'}`,
            borderRadius: 4,
            color: '#e2e8f0',
            fontSize: 12,
            fontFamily: 'monospace',
            outline: 'none',
            transition: 'all 0.2s',
            boxShadow: focused ? '0 0 12px rgba(139,92,246,0.15)' : 'none',
          }}
          placeholder="Navigate to URL..."
        />
        {/* animated bottom border when focused */}
        {focused && (
          <div style={{
            position: 'absolute', bottom: 0, left: '10%', right: '10%',
            height: 1,
            background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)',
            animation: 'scan-line 1.5s linear infinite',
          }} />
        )}
      </div>

      {/* ── Status Badge ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 12px',
        background: 'rgba(139,92,246,0.06)',
        border: '1px solid rgba(139,92,246,0.2)',
        borderRadius: 4,
        flexShrink: 0,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#34d399',
          boxShadow: '0 0 6px rgba(0,255,149,0.8)',
        }} className="animate-pulse" />
        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
          color: '#8b5cf6', textTransform: 'uppercase',
        }}>
          Scanning
        </span>
        <Wifi size={10} style={{ color: '#8b5cf6', opacity: 0.7 }} />
      </div>

      {/* ── Assistant Button ── */}
      <button
        onClick={onChatToggle}
        className="btn-icon"
        title="Open Entity X AI Assistant"
        style={{ color: '#8b5cf6', borderColor: 'rgba(123,47,255,0.35)', background: 'rgba(123,47,255,0.08)' }}
      >
        <MessageSquare size={14} />
      </button>
    </div>
  )
}
