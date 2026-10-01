import { BarChart3, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { faroCostObservatoryService, type FaroCostObservatory, type FaroObservabilityPeriod, type FaroObservabilitySurface } from '../../services/faroCostObservatoryService'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 5 })
const percent = (value: number) => `${Math.round(Number(value || 0) * 100)}%`
const quantity = (value: number | null | undefined) => Number(value ?? 0).toLocaleString('es-MX')
const latency = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${Math.round(Number(value))} ms`
const today = new Date().toISOString().slice(0, 10)
const monthStart = `${today.slice(0, 8)}01`

export function FaroCostObservatory() {
  const [period, setPeriod] = useState<FaroObservabilityPeriod>('today')
  const [surface, setSurface] = useState<FaroObservabilitySurface>('all')
  const [start, setStart] = useState(monthStart)
  const [end, setEnd] = useState(today)
  const [data, setData] = useState<FaroCostObservatory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try { setData(await faroCostObservatoryService.load(period, period === 'custom' ? { start, end } : undefined, surface)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos cargar la observabilidad.') }
    finally { setBusy(false) }
  }, [end, period, start, surface])
  const totals = data?.totals
  const skillRows = ['finance', 'calendar', 'backlog'].map((skill) => data?.bySkill.find((row) => row.skill === skill) ?? { skill, requests: 0, estimated_cost_usd: 0, success_rate: 0 })
  return <section className="faro-cost-observatory" aria-labelledby="faro-cost-observatory-title">
    <header><div><BarChart3 size={17}/><div><span>FARO AI COST OBSERVATORY V1</span><h3 id="faro-cost-observatory-title">Routing, costo y latencia</h3><p>Metadatos operacionales sin transcript ni argumentos de acciones.</p></div></div><div className="faro-cost-observatory__controls"><select aria-label="Surface" value={surface} onChange={(event) => setSurface(event.target.value as FaroObservabilitySurface)}><option value="all">Todas las surfaces</option><option value="lab">Lab</option><option value="web">Web</option><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select><select value={period} onChange={(event) => setPeriod(event.target.value as FaroObservabilityPeriod)}><option value="today">Hoy</option><option value="last_7_days">7 días</option><option value="month">Mes actual</option><option value="custom">Rango</option></select>{period === 'custom' && <><input aria-label="Inicio del rango" type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)}/><input aria-label="Fin del rango" type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)}/></>}<button type="button" onClick={() => void load()} disabled={busy || (period === 'custom' && (!start || !end || start > end))}><RefreshCw size={13}/> {busy ? 'Actualizando…' : 'Actualizar'}</button></div></header>
    {error && <p className="faro-cost-observatory__error" role="alert">{error}</p>}
    <div className="faro-cost-observatory__totals">
      <Metric label="Requests" value={quantity(totals?.requests)}/><Metric label="Sin LLM" value={percent(1 - Number(totals?.llm_rate ?? 0))}/><Metric label="Deterministic" value={percent(Number(totals?.deterministic_rate ?? 0))}/><Metric label="Costo estimado" value={money.format(Number(totals?.estimated_cost_usd ?? 0))}/><Metric label="Tokens" value={quantity(Number(totals?.input_tokens ?? 0) + Number(totals?.output_tokens ?? 0))}/><Metric label="p50 / p95" value={`${latency(totals?.latency_p50_ms)} / ${latency(totals?.latency_p95_ms)}`}/>
    </div>
    <div className="faro-cost-observatory__grids">
      <article><h4>Por ruta</h4>{(data?.byRoute ?? []).map((row) => <Row key={row.route} label={row.route} detail={`${quantity(row.requests)} req · ${percent(row.llm_rate)} LLM`} value={money.format(Number(row.estimated_cost_usd))}/>) || null}{!data?.byRoute.length && <Empty/>}</article>
      <article><h4>Por skill</h4>{skillRows.map((row) => <Row key={row.skill} label={row.skill} detail={`${quantity(row.requests)} req · ${percent(row.success_rate)} éxito`} value={money.format(Number(row.estimated_cost_usd))}/>)}</article>
      <article><h4>Proveedor / modelo</h4>{(data?.byProviderModel ?? []).map((row) => <Row key={`${row.provider}:${row.model}`} label={`${row.provider} / ${row.model}`} detail={`${quantity(row.input_tokens)} in · ${quantity(row.output_tokens)} out`} value={money.format(Number(row.estimated_cost_usd))}/>) || null}{!data?.byProviderModel.length && <Empty/>}</article>
      <article><h4>Baseline / router</h4>{(data?.byPipeline ?? []).map((row) => <Row key={row.pipeline} label={row.pipeline} detail={`${quantity(row.requests)} req · ${percent(row.llm_rate)} LLM · p95 ${latency(row.latency_p95_ms)}`} value={money.format(Number(row.estimated_cost_usd))}/>) || null}{!data?.byPipeline.length && <Empty/>}</article>
    </div>
  </section>
}

function Metric({ label, value }: { label: string; value: string }) { return <article><span>{label}</span><strong>{value}</strong></article> }
function Row({ label, detail, value }: { label: string; detail: string; value: string }) { return <div className="faro-cost-observatory__row"><div><strong>{label}</strong><span>{detail}</span></div><b>{value}</b></div> }
function Empty() { return <p className="faro-cost-observatory__empty">Sin tráfico en este periodo.</p> }
