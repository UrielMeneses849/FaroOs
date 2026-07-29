import { AlertTriangle, LayoutDashboard, RefreshCw } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom'
import { Button } from '../../components/common/Button'

export function RouteErrorPage() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? `${error.status}: ${error.statusText}`
    : error instanceof Error ? error.message : 'La sección encontró un problema inesperado.'
  return <main className="route-error" role="alert">
    <div><AlertTriangle size={22} /></div>
    <span className="eyebrow">FARO OS</span>
    <h1>Esta sección perdió el rumbo</h1>
    <p>{message}</p>
    <nav><Button icon={<RefreshCw size={15} />} onClick={() => window.location.reload()}>Reintentar</Button><Link to="/dashboard"><LayoutDashboard size={15} />Volver al Dashboard</Link></nav>
  </main>
}
