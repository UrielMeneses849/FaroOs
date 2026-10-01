import { Activity, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { faroCostObservatoryService, type FaroCostObservatory, type FaroObservabilitySurface } from '../../services/faroCostObservatoryService'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 5 })
const percent = (value: number) => `${Math.round(value * 100)}%`

export function FaroRouterDashboardPanel() {
  const [surface, setSurface] = useState<FaroObservabilitySurface>('all')
  const [data, setData] = useState<FaroCostObservatory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setLoading(true); setError('')
    void faroCostObservatoryService.load('today', undefined, surface)
      .then(setData)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'No pudimos cargar FARO AI Routing.'))
      .finally(() => setLoading(false))
  }, [surface])
  useEffect(() => {
    let active = true
    void faroCostObservatoryService.load('today', undefined, surface)
      .then((result) => { if (active) setData(result) })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No pudimos cargar FARO AI Routing.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [surface])

  const totals = data?.totals
  const routes = data?.byRoute ?? []
  return <section className="faro-router-dashboard" aria-labelledby="faro-router-dashboard-title">
    <header><div><Activity size={16}/><div><span>FARO AI ROUTING · EN VIVO</span><h2 id="faro-router-dashboard-title">Costo y rutas de voz</h2></div></div><div><select aria-label="Surface de FARO AI" value={surface} onChange={(event) => setSurface(event.target.value as FaroObservabilitySurface)}><option value="all">Todas las surfaces</option><option value="web">Web</option><option value="lab">Lab</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select><button type="button" onClick={load} disabled={loading} aria-label="Actualizar FARO AI Routing"><RefreshCw size={13}/></button></div></header>
    {error ? <p className="faro-router-dashboard__error">{error}</p> : <><div className="faro-router-dashboard__metrics"><Metric label="Requests hoy" value={loading ? '—' : String(totals?.requests ?? 0)}/><Metric label="Deterministic" value={loading ? '—' : percent(Number(totals?.deterministic_rate ?? 0))}/><Metric label="Sin LLM" value={loading ? '—' : percent(1 - Number(totals?.llm_rate ?? 0))}/><Metric label="Costo estimado" value={loading ? '—' : usd.format(Number(totals?.estimated_cost_usd ?? 0))}/><Metric label="p95" value={loading || totals?.latency_p95_ms == null ? '—' : `${Math.round(Number(totals.latency_p95_ms))} ms`}/></div><div className="faro-router-dashboard__routes">{routes.length ? routes.map((route) => <span key={route.route}><b>{route.route}</b>{route.requests} req</span>) : <small>{loading ? 'Cargando métricas…' : 'Aún no hay tráfico trazado desde el despliegue.'}</small>}</div></>}
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article> }
