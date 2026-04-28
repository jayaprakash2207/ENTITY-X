import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * React error boundary — wraps any page or component.
 * Catches render-phase errors and shows a recovery UI instead of a blank crash.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { label = 'this page' } = this.props

    return (
      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100%', minHeight: 320,
        gap: 16, padding: 32,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertTriangle size={22} color="#f87171" />
        </div>

        <div style={{ textAlign: 'center', maxWidth: 380 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
            {label} failed to render
          </div>
          <div style={{
            fontSize: 12, color: '#64748b', lineHeight: 1.6,
            background: 'rgba(248,113,113,0.04)',
            border: '1px solid rgba(248,113,113,0.1)',
            borderRadius: 8, padding: '8px 12px',
            fontFamily: 'monospace',
          }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
        </div>

        <button
          className="btn-cx"
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{ display: 'flex', alignItems: 'center', gap: 7 }}
        >
          <RefreshCw size={12} />
          Retry
        </button>
      </div>
    )
  }
}
