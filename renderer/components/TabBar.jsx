import {
  Activity, History, Lock, Zap, BarChart3, FileText, Shield,
  ScanText, Video, Mic, TrendingUp, BellRing, Globe, Rss,
  FolderOpen, Users, Newspaper, BadgeCheck, Eye, FileScan, GitBranch,
} from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Monitor',
    items: [
      { id: 'live-monitor',   label: 'Live Monitor',   icon: Activity,   showBadge: true },
      { id: 'audit-history',  label: 'Audit History',  icon: History  },
      { id: 'control-center', label: 'Control Center', icon: Zap      },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { id: 'text-analyzer',  label: 'Text',   icon: ScanText },
      { id: 'video-analyzer', label: 'Video',  icon: Video    },
      { id: 'audio-analyzer', label: 'Audio',  icon: Mic      },
    ],
  },
  {
    label: 'Investigate',
    items: [
      { id: 'investigation',   label: 'Investigation', icon: BarChart3 },
      { id: 'forensic-lab',    label: 'Forensic Lab',  icon: Lock      },
      { id: 'legal-generator', label: 'Legal Report',  icon: FileText  },
    ],
  },
  {
    label: 'Protect',
    items: [
      { id: 'creator-shield', label: 'Creator Shield', icon: Shield   },
      { id: 'social-scanner', label: 'Social Scanner', icon: Rss      },
      { id: 'alert-rules',    label: 'Alert Rules',    icon: BellRing },
    ],
  },
  {
    label: 'Intel',
    items: [
      { id: 'threat-map',        label: 'Threat Map',   icon: Globe      },
      { id: 'domain-reputation', label: 'Domain Intel', icon: TrendingUp },
    ],
  },
  {
    label: 'Cases',
    items: [
      { id: 'case-manager', label: 'Case Manager', icon: FolderOpen  },
      { id: 'community-db', label: 'Community DB', icon: Users       },
      { id: 'newsroom',     label: 'Newsroom',     icon: Newspaper   },
      { id: 'trust-badge',  label: 'Trust Badge',  icon: BadgeCheck  },
    ],
  },
  {
    label: 'New Features',
    items: [
      { id: 'watchlist',        label: 'Watchlist',    icon: Eye       },
      { id: 'pdf-analyzer',     label: 'PDF Analyzer', icon: FileScan  },
      { id: 'provenance-chain', label: 'Provenance',   icon: GitBranch },
    ],
  },
]

export default function TabBar({
  currentPage,
  onPageChange,
  detectionCount = 0,
  highThreatCount = 0,
  backendReady = false,
}) {
  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      style={{
        width: 216,
        background: 'rgba(8,8,18,0.98)',
        borderRight: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* ── Logo ── */}
      <div style={{
        padding: '20px 16px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'linear-gradient(135deg,rgba(139,92,246,0.25),rgba(139,92,246,0.1))',
            border: '1px solid rgba(139,92,246,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(139,92,246,0.2)',
            flexShrink: 0,
          }}>
            <Shield size={16} color="#a78bfa" aria-hidden="true" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: '#f1f5f9' }}>
              Entity{' '}
              <span style={{
                background: 'linear-gradient(135deg,#a78bfa,#8b5cf6)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>X</span>
            </div>
            <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.08em', marginTop: 1 }}>
              Digital Integrity
            </div>
          </div>
        </div>
      </div>

      {/* ── Nav items ── */}
      <div
        role="list"
        style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}
      >
        {NAV_GROUPS.map(group => (
          <div key={group.label} role="listitem" style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: '#334155',
              padding: '8px 8px 4px',
              userSelect: 'none',
            }}>
              {group.label}
            </div>

            {group.items.map(tab => {
              const Icon = tab.icon
              const active = currentPage === tab.id
              const showCount = tab.showBadge && detectionCount > 0

              return (
                <button
                  key={tab.id}
                  role="button"
                  aria-current={active ? 'page' : undefined}
                  aria-label={tab.label}
                  onClick={() => onPageChange(tab.id)}
                  className={`nav-item${active ? ' active' : ''}`}
                >
                  <Icon
                    size={14}
                    className="nav-icon"
                    aria-hidden="true"
                  />
                  <span className="nav-label">{tab.label}</span>

                  {/* Detection count badge on Live Monitor */}
                  {showCount && (
                    <span className={`nav-badge${highThreatCount > 0 ? ' danger' : ''}`}>
                      {highThreatCount > 0 ? `${highThreatCount}!` : detectionCount}
                    </span>
                  )}

                  {/* Active dot indicator */}
                  {active && !showCount && (
                    <div className="nav-active-dot" aria-hidden="true" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Status footer ── */}
      <div style={{
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 16px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            aria-label={backendReady ? 'Backend online' : 'Backend connecting'}
            title={backendReady ? 'Backend online' : 'Connecting…'}
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: backendReady ? '#34d399' : '#fbbf24',
              boxShadow: backendReady
                ? '0 0 8px rgba(52,211,153,0.5)'
                : '0 0 8px rgba(251,191,36,0.5)',
              flexShrink: 0,
              transition: 'background 0.4s, box-shadow 0.4s',
            }}
          />
          <span style={{ fontSize: 11, color: '#475569', fontWeight: 500 }}>
            {backendReady ? 'System Online' : 'Connecting…'}
          </span>
        </div>
        <div style={{
          fontSize: 10, color: '#1e293b', marginTop: 3,
          fontFamily: 'monospace', letterSpacing: '0.04em',
        }}>
          v1.4.4
        </div>
      </div>
    </nav>
  )
}
