import { ArrowUpRight, CheckCircle2, CircleDollarSign, Clock3, Gauge, RefreshCw, Route, Save, ShieldCheck, Sparkles, TriangleAlert, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/layout'
import { FINOPS_TIER_GOALS, AI_TIER, type AITier } from '../../supabase/functions/_shared/ai/config'
import { finOpsService, type FinOpsDashboard } from '../services/finOpsService'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 5 })
const dateTime = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' })
const tierOrder = [AI_TIER.DETERMINISTIC, AI_TIER.CHEAP, AI_TIER.STANDARD, AI_TIER.PREMIUM] as const
const tierLabels: Record<string, string> = {
  deterministic: 'Tier 0 · Deterministic', cheap: 'Tier 1 · Cheap', standard: 'Tier 2 · Standard', premium: 'Tier 3 · Premium',
}
const number = (value: unknown) => Number(value ?? 0)
const quantity = (value: unknown) => number(value).toLocaleString('es-MX')
const percent = (value: unknown) => `${Math.round(number(value) * 100)}%`
const latency = (value: number | null | undefined) => value == null ? '—' : `${Math.round(number(value))} ms`
const money = (value: unknown, unknownRequests = 0) => unknownRequests > 0 && number(value) === 0 ? 'Costo desconocido' : usd.format(number(value))
const loadDashboards = () => Promise.all([
  finOpsService.dashboard('today'), finOpsService.dashboard('last_7_days'), finOpsService.dashboard('month'),
])

function budgetTone(value: number | null) {
  if (value === null) return 'neutral'
  if (value >= 1) return 'danger'
  if (value >= .85) return 'warning'
  if (value >= .7) return 'notice'
  return 'good'
}

function ShareBar({ value, tone = 'blue' }: { value: number; tone?: string }) {
  return <span className={`finops-share finops-share--${tone}`}><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></span>
}

export function FinOpsPage() {
  const [today, setToday] = useState<FinOpsDashboard | null>(null)
  const [week, setWeek] = useState<FinOpsDashboard | null>(null)
  const [month, setMonth] = useState<FinOpsDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [budgetInput, setBudgetInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [todayData, weekData, monthData] = await loadDashboards()
      setToday(todayData); setWeek(weekData); setMonth(monthData)
      setBudgetInput(monthData.budget.monthlyBudgetUsd == null ? '' : String(monthData.budget.monthlyBudgetUsd))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No pudimos cargar FinOps.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let active = true
    void loadDashboards()
      .then(([todayData, weekData, monthData]) => {
        if (!active) return
        setToday(todayData); setWeek(weekData); setMonth(monthData)
        setBudgetInput(monthData.budget.monthlyBudgetUsd == null ? '' : String(monthData.budget.monthlyBudgetUsd))
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'No pudimos cargar FinOps.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const saveBudget = async () => {
    const value = Number(budgetInput)
    if (!Number.isFinite(value) || value <= 0) { setError('Indica un presupuesto mensual mayor que cero.'); return }
    setSaving(true); setError('')
    try { await finOpsService.saveMonthlyBudget(value); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos guardar el presupuesto.') }
    finally { setSaving(false) }
  }

  const tiers = useMemo(() => tierOrder.map((tier) => month?.tiers.find((item) => item.tier === tier) ?? { tier, requests: 0, known_cost_usd: 0, unknown_cost_requests: 0, escalated_requests: 0 }), [month])
  const totalTierCost = tiers.reduce((sum, item) => sum + number(item.known_cost_usd), 0)
  const currentBudgetTone = budgetTone(month?.budget.percentageUsed ?? null)

  return <div className="page finops-page">
    <PageHeader eyebrow="Control de inteligencia" title="FinOps" description="Visibilidad real de costo, routing y eficiencia de IA en FARO." />
    {error && <div className="finops-alert" role="alert"><TriangleAlert size={16}/><span>{error}</span></div>}

    <section className="finops-hero" aria-label="Resumen FinOps">
      <div className="finops-metrics">
        <Metric icon={CircleDollarSign} label="Costo IA hoy" value={money(today?.totals.known_cost_usd, today?.totals.unknown_cost_requests)} note={today?.totals.unknown_cost_requests ? `${quantity(today.totals.unknown_cost_requests)} sin precio` : 'Uso con precio conocido'} />
        <Metric icon={CircleDollarSign} label="Costo esta semana" value={money(week?.totals.known_cost_usd, week?.totals.unknown_cost_requests)} note={week?.totals.unknown_cost_requests ? `${quantity(week.totals.unknown_cost_requests)} sin precio` : 'Uso con precio conocido'} />
        <Metric icon={CircleDollarSign} label="Costo este mes" value={money(month?.totals.known_cost_usd, month?.totals.unknown_cost_requests)} note={month?.totals.unknown_cost_requests ? `${quantity(month.totals.unknown_cost_requests)} sin precio` : 'Uso con precio conocido'} />
        <Metric icon={Sparkles} label="Solicitudes IA" value={quantity(month?.totals.ai_requests)} note={`${quantity(month?.totals.requests)} operaciones totales`} />
        <Metric icon={Gauge} label="Costo promedio" value={money(month?.totals.average_cost_usd)} note="Solo requests con precio conocido" />
        <Metric icon={Clock3} label="Latencia promedio" value={latency(month?.totals.average_latency_ms)} note={`p50 ${latency(month?.totals.latency_p50_ms)} · p95 ${latency(month?.totals.latency_p95_ms)}`} />
      </div>
      <button className="finops-refresh" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/>{loading ? 'Actualizando' : 'Actualizar'}</button>
    </section>

    <section className="finops-grid finops-grid--two">
      <article className="finops-panel finops-budget">
        <header><div><span className="eyebrow">Budget IA mensual</span><h2>{month?.budget.monthlyBudgetUsd == null ? 'Sin presupuesto configurado' : `${money(month.budget.monthKnownCostUsd, month.budget.monthUnknownCostRequests)} de ${money(month.budget.monthlyBudgetUsd)}`}</h2></div><ShieldCheck size={19}/></header>
        <div className={`finops-budget__status is-${currentBudgetTone}`}><ShareBar value={month?.budget.percentageUsed ?? 0} tone={currentBudgetTone}/><strong>{month?.budget.monthlyBudgetUsd == null ? 'Configura un límite para activar alertas al 70%, 85% y 100%.' : `${percent(month.budget.percentageUsed)} consumido · proyección ${money(month.budget.projectedKnownCostUsd)}`}</strong></div>
        <div className="finops-budget__form"><label>USD<input aria-label="Presupuesto mensual de IA en USD" inputMode="decimal" placeholder="Ej. 15" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} /></label><button type="button" onClick={() => void saveBudget()} disabled={saving}><Save size={14}/>{saving ? 'Guardando' : 'Guardar'}</button></div>
        {month?.budget.monthUnknownCostRequests ? <small className="finops-note">{quantity(month.budget.monthUnknownCostRequests)} requests mensuales tienen tokens o precio desconocido y no se suman al gasto mostrado.</small> : null}
      </article>
      <article className="finops-panel finops-opportunity">
        <header><div><span className="eyebrow">Oportunidad de optimización</span><h2>{quantity(month?.optimizationOpportunity.requests)} rutas podrían costar menos</h2></div><ArrowUpRight size={19}/></header>
        <p>{number(month?.optimizationOpportunity.requests) > 0 ? 'Solicitaron Cheap o Standard y usaron Premium porque todavía no hay un provider económico configurado.' : 'No hay fallback de Cheap/Standard a Premium en este periodo.'}</p>
        <div className="finops-opportunity__facts"><span><Route size={14}/> Premium rate <b>{percent(month?.totals.premium_rate)}</b></span><span><Zap size={14}/> Escalamientos <b>{quantity(month?.totals.escalations)}</b></span><span><CheckCircle2 size={14}/> Llamadas evitadas <b>{quantity(month?.totals.avoided_calls)}</b></span></div>
      </article>
    </section>

    <section className="finops-panel finops-tiers">
      <header><div><span className="eyebrow">Distribución por tier · mes actual</span><h2>La inteligencia justa para cada acción</h2></div><small>Metas experimentales; no fuerzan el routing.</small></header>
      <div className="finops-tier-list">
        {tiers.map((item) => <article key={item.tier}>
          <div className="finops-tier-list__name"><strong>{tierLabels[item.tier] ?? item.tier}</strong><span>{FINOPS_TIER_GOALS[item.tier as AITier]?.target ?? '—'} objetivo</span></div>
          <div className="finops-tier-list__bar"><ShareBar value={number(item.requests) / Math.max(1, number(month?.totals.requests))} tone={item.tier}/></div>
          <div><b>{quantity(item.requests)}</b><span>requests · {percent(number(item.requests) / Math.max(1, number(month?.totals.requests)))}</span></div>
          <div><b>{money(item.known_cost_usd, item.unknown_cost_requests)}</b><span>{percent(number(item.known_cost_usd) / Math.max(1e-12, totalTierCost))} del costo</span></div>
        </article>)}
      </div>
    </section>

    <section className="finops-grid finops-grid--two">
      <DataPanel title="Proveedor / modelo" eyebrow="Distribución y tokens" empty={!month?.providers.length} emptyText="Aún no hay inferencias registradas en este periodo.">
        <div className="finops-rows">{month?.providers.map((item) => <div className="finops-row" key={`${item.provider}:${item.model}`}><div><strong>{item.provider} <small>/ {item.model}</small></strong><span>{quantity(item.requests)} req · {quantity(item.input_tokens)} in · {quantity(item.output_tokens)} out · {quantity(item.cached_tokens)} cache</span></div><div><b>{money(item.known_cost_usd, item.unknown_cost_requests)}</b><span>{latency(item.average_latency_ms)}</span></div></div>)}</div>
      </DataPanel>
      <DataPanel title="Costo por módulo" eyebrow="Dónde se consume" empty={!month?.modules.length} emptyText="Aún no hay módulos con telemetría.">
        <div className="finops-rows">{month?.modules.map((item) => <div className="finops-row" key={item.module}><div><strong>{moduleLabel(item.module)}</strong><span>{quantity(item.requests)} req · {tierLabels[item.predominant_tier] ?? item.predominant_tier}</span></div><div><b>{money(item.known_cost_usd, item.unknown_cost_requests)}</b><ShareBar value={number(item.known_cost_usd) / Math.max(1e-12, number(month?.totals.known_cost_usd))}/></div></div>)}</div>
      </DataPanel>
    </section>

    <section className="finops-grid finops-grid--two">
      <DataPanel title="Costo por feature" eyebrow="Operaciones a vigilar" empty={!month?.features.length} emptyText="Aún no hay features con telemetría.">
        <div className="finops-rows">{month?.features.slice(0, 8).map((item) => <div className="finops-row" key={item.feature}><div><strong>{item.feature}</strong><span>{quantity(item.requests)} req · {tierLabels[item.predominant_tier] ?? item.predominant_tier} · {latency(item.average_latency_ms)}</span></div><div><b>{money(item.known_cost_usd, item.unknown_cost_requests)}</b><span>{money(item.average_cost_usd)} / req</span></div></div>)}</div>
      </DataPanel>
      <DataPanel title="Tokens" eyebrow="Evolución reciente" empty={!month?.tokensOverTime.length} emptyText="Los tokens aparecerán cuando OpenAI los devuelva.">
        <div className="finops-token-list">{month?.tokensOverTime.slice(-8).map((item) => <div key={item.day}><time>{String(item.day).slice(5)}</time><span><i style={{ width: `${Math.min(100, number(item.input_tokens) / Math.max(1, ...((month?.tokensOverTime ?? []).map((row) => number(row.input_tokens)))) * 100)}%` }}/></span><strong>{quantity(item.input_tokens)} in</strong><small>{quantity(item.output_tokens)} out · {quantity(item.cached_tokens)} cache</small></div>)}</div>
      </DataPanel>
    </section>

    <section className="finops-grid finops-grid--two">
      <DataPanel title="Escalamientos" eyebrow="Tier original → final" empty={!month?.escalations.length} emptyText="No hubo escalamientos en este periodo.">
        <div className="finops-rows">{month?.escalations.map((item, index) => <div className="finops-row" key={`${item.requested_tier}:${item.used_tier}:${index}`}><div><strong>{tierLabels[item.requested_tier] ?? item.requested_tier} → {tierLabels[item.used_tier] ?? item.used_tier}</strong><span>{item.reason}</span></div><b>{quantity(item.requests)} requests</b></div>)}</div>
      </DataPanel>
      <DataPanel title="Errores" eyebrow="Proveedor, timeouts y parseos" empty={!month?.errors.length} emptyText="No se registraron errores en este periodo.">
        <div className="finops-rows">{month?.errors.map((item, index) => <div className="finops-row finops-row--error" key={`${item.error_type}:${item.provider}:${index}`}><div><strong>{item.error_type}</strong><span>{item.provider}</span></div><b>{quantity(item.requests)} requests</b></div>)}</div>
      </DataPanel>
    </section>

    <section className="finops-panel finops-history">
      <header><div><span className="eyebrow">Historial de inferencias</span><h2>Metadata operacional, nunca prompts ni argumentos</h2></div><small>Últimas 100 en el periodo</small></header>
      {!month?.history.length ? <Empty text="Aún no hay historial de inferencias para mostrar." /> : <div className="finops-history__scroll"><table><thead><tr><th>Fecha</th><th>Módulo / feature</th><th>Intent</th><th>Tier</th><th>Provider / modelo</th><th>Tokens</th><th>Costo</th><th>Latencia</th><th>Estado</th></tr></thead><tbody>{month.history.map((item, index) => <tr key={`${item.created_at}:${index}`}><td>{dateTime.format(new Date(item.created_at))}</td><td><strong>{moduleLabel(item.module)}</strong><small>{item.feature}</small></td><td>{item.intent}</td><td><span className="finops-tier-badge">{tierLabels[item.tier_used] ?? item.tier_used}{item.escalated ? ' ↑' : ''}</span></td><td>{item.provider ? <><strong>{item.provider}</strong><small>{item.model}</small></> : '—'}</td><td>{item.input_tokens == null && item.output_tokens == null ? '—' : `${quantity(item.input_tokens)} / ${quantity(item.output_tokens)}`}</td><td>{item.cost_status === 'unknown' ? 'Desconocido' : item.cost_status === 'not_applicable' ? '—' : money(item.estimated_cost_usd)}</td><td>{latency(item.total_latency_ms)}</td><td className={item.success ? 'is-success' : 'is-error'}>{item.success ? 'OK' : item.error_type ?? 'Error'}</td></tr>)}</tbody></table></div>}
    </section>
  </div>
}

function Metric({ icon: Icon, label, value, note }: { icon: typeof CircleDollarSign; label: string; value: string; note: string }) {
  return <article><div><span>{label}</span><Icon size={15}/></div><strong>{value}</strong><small>{note}</small></article>
}
function DataPanel({ title, eyebrow, empty, emptyText, children }: { title: string; eyebrow: string; empty: boolean; emptyText: string; children: React.ReactNode }) {
  return <article className="finops-panel"><header><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></header>{empty ? <Empty text={emptyText}/> : children}</article>
}
function Empty({ text }: { text: string }) { return <p className="finops-empty">{text}</p> }
function moduleLabel(value: string) { return ({ finance: 'Finanzas', calendar: 'Calendario', backlog: 'Backlog', unknown: 'Assistant' } as Record<string, string>)[value] ?? value }
