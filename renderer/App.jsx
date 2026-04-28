import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, X, WifiOff, Database } from 'lucide-react'
import TabBar from './components/TabBar'
import BrowserShell from './components/BrowserShell'
import ChatPanel from './components/ChatPanel'
import DetectionFeed from './components/DetectionFeed'
import ScanPopup from './components/ScanPopup'
import ErrorBoundary from './ErrorBoundary'
import ControlCenter from './pages/ControlCenter'
import Investigation from './pages/Investigation'
import ForensicLab from './pages/ForensicLab'
import AuditHistory from './pages/AuditHistory'
import LegalGenerator from './pages/LegalGenerator'
import TextAnalyzer from './pages/TextAnalyzer'
import VideoAnalyzer from './pages/VideoAnalyzer'
import AudioAnalyzer from './pages/AudioAnalyzer'
import DomainReputation from './pages/DomainReputation'
import AlertRules from './pages/AlertRules'
import SocialScanner from './pages/SocialScanner'
import CreatorShield from './pages/CreatorShield'
import ThreatMap from './pages/ThreatMap'
import CaseManager from './pages/CaseManager'
import CommunityDB from './pages/CommunityDB'
import NewsroomWorkspace from './pages/NewsroomWorkspace'
import TrustBadge from './pages/TrustBadge'
import WatchlistMonitor from './pages/WatchlistMonitor'
import PDFAnalyzer from './pages/PDFAnalyzer'
import ProvenanceChain from './pages/ProvenanceChain'

// ─── Page registry ────────────────────────────────────────────────────────────
// Defined outside component to avoid re-creation on every render.
const PAGE_REGISTRY = [
  { id: 'control-center',    label: 'Control Center',   component: ControlCenter   },
  { id: 'text-analyzer',     label: 'Text Analyzer',    component: TextAnalyzer    },
  { id: 'video-analyzer',    label: 'Video Analyzer',   component: VideoAnalyzer   },
  { id: 'audio-analyzer',    label: 'Audio Analyzer',   component: AudioAnalyzer   },
  { id: 'investigation',     label: 'Investigation',    component: Investigation   },
  { id: 'forensic-lab',      label: 'Forensic Lab',     component: ForensicLab     },
  { id: 'audit-history',     label: 'Audit History',    component: AuditHistory    },
  { id: 'legal-generator',   label: 'Legal Report',     component: LegalGenerator  },
  { id: 'domain-reputation', label: 'Domain Intel',     component: DomainReputation },
  { id: 'alert-rules',       label: 'Alert Rules',      component: AlertRules      },
  { id: 'social-scanner',    label: 'Social Scanner',   component: SocialScanner   },
  { id: 'creator-shield',    label: 'Creator Shield',   component: CreatorShield   },
  { id: 'threat-map',        label: 'Threat Map',       component: ThreatMap       },
  { id: 'case-manager',      label: 'Case Manager',     component: CaseManager     },
  { id: 'community-db',      label: 'Community DB',     component: CommunityDB     },
  { id: 'newsroom',          label: 'Newsroom',         component: NewsroomWorkspace },
  { id: 'trust-badge',       label: 'Trust Badge',      component: TrustBadge      },
  { id: 'watchlist',         label: 'Watchlist',        component: WatchlistMonitor },
  { id: 'pdf-analyzer',      label: 'PDF Analyzer',     component: PDFAnalyzer     },
  { id: 'provenance-chain',  label: 'Provenance Chain', component: ProvenanceChain },
]

// ─── Toast component ──────────────────────────────────────────────────────────
function Toast({ notif, onDismiss }) {
  return (
    <div className="toast toast-alert" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7,
          background: 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <AlertTriangle size={14} color="#fbbf24" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24', marginBottom: 2 }}>
            Rule Fired: {notif.name}
          </div>
          <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>
            {notif.detection?.type} · {notif.detection?.risk} risk
            {notif.action?.message ? ` · ${notif.action.message}` : ''}
          </div>
        </div>
        <button
          onClick={() => onDismiss(notif.id)}
          aria-label="Dismiss notification"
          style={{
            background: 'none', border: 'none', color: '#475569',
            cursor: 'pointer', padding: 2, lineHeight: 1, flexShrink: 0,
          }}
        >
          <X size={13} />
        </button>
      </div>
      {/* Progress bar showing time until auto-dismiss */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0,
        height: 2, borderRadius: '0 0 12px 12px',
        background: 'rgba(251,191,36,0.35)',
        animation: 'toast-progress 6s linear forwards',
        width: '100%',
      }} />
    </div>
  )
}

// ─── System banner (spawn/DB errors) ─────────────────────────────────────────
function SystemBanner({ alerts, onDismiss }) {
  if (!alerts.length) return null
  return (
    <div style={{ padding: '12px 28px 0' }}>
      {alerts.map(alert => (
        <div key={alert.id} className={`system-banner system-banner-${alert.type}`}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: alert.type === 'error'
              ? 'rgba(248,113,113,0.1)' : 'rgba(251,191,36,0.1)',
          }}>
            {alert.type === 'error'
              ? <WifiOff size={15} color="#f87171" />
              : <Database size={15} color="#fbbf24" />
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 12, fontWeight: 700, marginBottom: 2,
              color: alert.type === 'error' ? '#f87171' : '#fbbf24',
            }}>
              {alert.title}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              {alert.detail}
            </div>
          </div>
          <button
            onClick={() => onDismiss(alert.id)}
            aria-label="Dismiss alert"
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 2 }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [currentPage, setCurrentPage]         = useState('live-monitor')
  const [showChatPanel, setShowChatPanel]     = useState(false)
  const [detections, setDetections]           = useState([])
  const [currentUrl, setCurrentUrl]           = useState('https://unsplash.com')
  const [selectedEntity, setSelectedEntity]   = useState(null)
  const [showDetectionFeed, setShowDetectionFeed] = useState(true)
  const [scanPopupPayload, setScanPopupPayload]   = useState(null)
  const [backendReady, setBackendReady]       = useState(false)
  const [backendTimedOut, setBackendTimedOut] = useState(false)
  // Toasts for alert rule fires (auto-dismiss after 6 s)
  const [toasts, setToasts]                   = useState([])
  // System-level error banners (spawn failure, DB init failure)
  const [systemAlerts, setSystemAlerts]       = useState([])
  // Lazy page mounting — only render a page the first time it's visited
  const [mountedPages, setMountedPages]       = useState(new Set())

  // ── Mount the current page on first visit ──────────────────────────────────
  useEffect(() => {
    if (currentPage !== 'live-monitor') {
      setMountedPages(prev => {
        if (prev.has(currentPage)) return prev
        const next = new Set(prev)
        next.add(currentPage)
        return next
      })
    }
  }, [currentPage])

  // ── Backend readiness ──────────────────────────────────────────────────────
  useEffect(() => {
    const timeoutId = window.setTimeout(() => setBackendTimedOut(true), 12000)
    const unsub = window.backendBus?.onReady?.(() => {
      window.clearTimeout(timeoutId)
      setBackendReady(true)
      setBackendTimedOut(false)
    })
    if (!window.backendBus?.onReady) {
      window.clearTimeout(timeoutId)
      setBackendTimedOut(true)
    }
    return () => { window.clearTimeout(timeoutId); unsub?.() }
  }, [])

  // ── System error events (backend spawn / DB init) ──────────────────────────
  useEffect(() => {
    const unsubs = [
      window.systemBus?.onSpawnError?.((err) => {
        setSystemAlerts(prev => [...prev, {
          id: Date.now(),
          type: 'error',
          title: 'Backend Failed to Start',
          detail: err?.message || 'The Python backend could not launch. Analysis features are unavailable.',
        }])
      }),
      window.systemBus?.onDbInitError?.((err) => {
        setSystemAlerts(prev => [...prev, {
          id: Date.now(),
          type: 'warning',
          title: 'Database Unavailable',
          detail: err?.message || 'Detection history will not be saved this session.',
        }])
      }),
    ]
    return () => unsubs.forEach(fn => fn?.())
  }, [])

  // ── Alert rule triggers — with auto-dismiss ────────────────────────────────
  useEffect(() => {
    const unsub = window.entityX?.onAlertRuleTriggered?.((triggered) => {
      const newToasts = triggered.map(t => ({
        ...t,
        id: `${Date.now()}-${Math.random()}`,
        ts: Date.now(),
      }))
      setToasts(prev => [...newToasts, ...prev].slice(0, 5))
      newToasts.forEach(t => {
        window.setTimeout(() => dismissToast(t.id), 6000)
      })
    })
    return () => unsub?.()
  }, [])

  // ── Context-scan popup ─────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = window.entityX?.onScanPopupOpen?.((payload) => {
      setScanPopupPayload(payload)
    })
    return () => unsub?.()
  }, [])

  // ── All media monitors — consolidated into one effect ─────────────────────
  useEffect(() => {
    const monitors = [
      [window.imageMonitor, 'IMAGE'],
      [window.textMonitor,  'TEXT' ],
      [window.videoMonitor, 'VIDEO'],
      [window.audioMonitor, 'AUDIO'],
    ]
    const unsubs = monitors
      .filter(([m]) => m?.onAnalysis)
      .map(([m, type]) =>
        m.onAnalysis(data =>
          setDetections(prev => [
            { type, data, timestamp: new Date().toISOString() },
            ...prev.slice(0, 49),
          ])
        )
      )
    return () => unsubs.forEach(fn => fn?.())
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────
  const dismissToast  = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), [])
  const dismissAlert  = useCallback((id) => setSystemAlerts(prev => prev.filter(a => a.id !== id)), [])

  const handlePageNavigate = useCallback((page, entityOverride) => {
    if (entityOverride) setSelectedEntity(entityOverride)
    setCurrentPage(page)
  }, [])

  const handleSelectEntity = useCallback((entity) => {
    setSelectedEntity(entity)
    setCurrentPage('investigation')
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────
  const isBrowserPage     = currentPage === 'live-monitor'
  const highThreatCount   = detections.filter(d => {
    const p = d.type === 'IMAGE' ? d.data?.fake_probability : d.data?.ai_generated_probability
    return p > 0.7
  }).length
  const showBackendBanner = !isBrowserPage && !backendReady
  const backendBanner = backendTimedOut
    ? { title: 'Backend still starting', detail: 'Investigation mode is available, but live analysis may stay limited until the Python API responds on 127.0.0.1:8000.', border: '1px solid rgba(251,191,36,0.26)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }
    : { title: 'Connecting to backend', detail: 'The UI is ready. Analysis features will unlock automatically as soon as the backend responds.', border: '1px solid rgba(139,92,246,0.24)', background: 'rgba(139,92,246,0.08)', color: '#a78bfa' }

  return (
    <div className="flex h-screen w-screen" style={{ background: '#060610' }}>
      {/* ── Left Sidebar ── */}
      <TabBar
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        detectionCount={detections.length}
        highThreatCount={highThreatCount}
        backendReady={backendReady}
      />

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Live browser page */}
        {isBrowserPage && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <BrowserShell
              initialUrl={currentUrl}
              onUrlChange={setCurrentUrl}
              onChatToggle={() => setShowChatPanel(p => !p)}
              threatCount={detections.length}
              highThreatCount={highThreatCount}
            />
            {showDetectionFeed && (
              <DetectionFeed
                detections={detections}
                onSelectDetection={handleSelectEntity}
                onClose={() => setShowDetectionFeed(false)}
              />
            )}
          </div>
        )}

        {/* All non-browser pages — lazy mounted, kept in DOM once visited */}
        <div
          className="flex-1 overflow-auto"
          style={{ position: 'relative', display: isBrowserPage ? 'none' : 'flex', flexDirection: 'column' }}
        >
          {/* Backend connecting banner */}
          {showBackendBanner && (
            <div style={{
              margin: '20px 28px 0',
              padding: '11px 14px',
              borderRadius: 10,
              border: backendBanner.border,
              background: backendBanner.background,
              display: 'flex', alignItems: 'flex-start', gap: 12,
            }}>
              <div style={{
                width: 9, height: 9, marginTop: 5, borderRadius: '50%',
                background: backendBanner.color,
                boxShadow: `0 0 14px ${backendBanner.color}`,
                flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>
                  {backendBanner.title}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: '#94a3b8' }}>
                  {backendBanner.detail}
                </div>
              </div>
            </div>
          )}

          {/* System error banners (spawn failure / DB init failure) */}
          <SystemBanner alerts={systemAlerts} onDismiss={dismissAlert} />

          {/* Pages — lazy mounted, page-enter animation on each reveal */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {PAGE_REGISTRY.map(({ id, label, component: PageComponent }) => {
              if (!mountedPages.has(id)) return null
              return (
                <div
                  key={id}
                  style={{
                    display: currentPage === id ? 'block' : 'none',
                    padding: showBackendBanner ? '16px 28px 24px' : '24px 28px',
                    minHeight: '100%',
                  }}
                >
                  <ErrorBoundary label={label}>
                    <div className={currentPage === id ? 'page-enter' : undefined}>
                      <PageComponent
                        entity={selectedEntity}
                        onClose={() => setCurrentPage('live-monitor')}
                        onSelectEntity={handleSelectEntity}
                        onNavigate={handlePageNavigate}
                      />
                    </div>
                  </ErrorBoundary>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Copilot slide-in chat panel ── */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 370, zIndex: 1000,
        transform: showChatPanel ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
        boxShadow: showChatPanel ? '-8px 0 40px rgba(0,0,0,0.6)' : 'none',
        willChange: 'transform',
      }}>
        <ChatPanel onClose={() => setShowChatPanel(false)} />
      </div>

      {/* Dim backdrop when chat is open on non-browser pages */}
      {!isBrowserPage && showChatPanel && (
        <div
          role="presentation"
          onClick={() => setShowChatPanel(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(1px)' }}
        />
      )}

      {/* ── AI chat toggle button ── */}
      <button
        onClick={() => setShowChatPanel(p => !p)}
        aria-label={showChatPanel ? 'Close AI assistant' : 'Open AI assistant'}
        aria-expanded={showChatPanel}
        style={{
          position: 'fixed', bottom: 22,
          right: showChatPanel ? 386 : 22,
          zIndex: 1001, width: 42, height: 42, borderRadius: 12,
          background: showChatPanel
            ? 'linear-gradient(135deg,#7c3aed,#8b5cf6)'
            : 'rgba(139,92,246,0.13)',
          border: `1.5px solid ${showChatPanel ? 'rgba(139,92,246,0.7)' : 'rgba(139,92,246,0.35)'}`,
          color: '#a78bfa', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: showChatPanel
            ? '0 4px 24px rgba(139,92,246,0.55)'
            : '0 2px 12px rgba(139,92,246,0.2)',
          transition: 'all 0.28s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* ── Context-scan popup ── */}
      {scanPopupPayload && (
        <ScanPopup
          payload={scanPopupPayload}
          onClose={() => setScanPopupPayload(null)}
          onNavigate={(page, entity) => {
            setScanPopupPayload(null)
            handlePageNavigate(page, entity)
          }}
        />
      )}

      {/* ── Toast notifications (alert rule fires, auto-dismiss 6 s) ── */}
      <div
        role="region"
        aria-live="polite"
        aria-label="Alert notifications"
        style={{
          position: 'fixed', bottom: 80, right: 24,
          zIndex: 2000,
          display: 'flex', flexDirection: 'column-reverse', gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(notif => (
          <div key={notif.id} style={{ pointerEvents: 'auto' }}>
            <Toast notif={notif} onDismiss={dismissToast} />
          </div>
        ))}
      </div>
    </div>
  )
}
