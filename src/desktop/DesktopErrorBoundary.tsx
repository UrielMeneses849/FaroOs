import { Component, type ErrorInfo, type ReactNode } from 'react'

interface DesktopErrorBoundaryState {
  error?: Error
}

/**
 * A native window must never become an unexplained black rectangle. React
 * errors that happen after mounting bypass the async entry-point catch, so
 * keep this boundary at the desktop root and offer a safe retry path.
 */
export class DesktopErrorBoundary extends Component<{ children: ReactNode }, DesktopErrorBoundaryState> {
  state: DesktopErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): DesktopErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FARO Desktop] React render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    const message = this.state.error.message || 'Error inesperado al cargar la interfaz.'
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', margin: 0, background: '#05070c', color: '#edf3ff', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' }}>
        <section style={{ maxWidth: 440, padding: 32, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 12px', fontSize: 24 }}>FARO no pudo cargar la interfaz</h1>
          <p style={{ margin: 0, color: '#aab7ce', lineHeight: 1.5 }}>Puedes reintentar sin cerrar la aplicación.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: 24, padding: '10px 16px', border: '1px solid #2864d7', borderRadius: 10, background: '#0b1c40', color: '#eef4ff', cursor: 'pointer' }}>Reintentar</button>
          <p style={{ marginTop: 24, color: '#ffabb5', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5 }}>{message}</p>
        </section>
      </main>
    )
  }
}
