import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ArrowDownRight, ArrowRight, CalendarDays, Landmark } from 'lucide-react'
import { useMemo } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { FinanceLiquidityProjection } from '../../services/financeLiquidityProjection'
import { formatMxn } from '../../services/financeService'
import { paperChartAxisMxn, paperChartDomain } from '../dashboard/paperDashboardMetrics'
import './finance-overview-chart.css'

interface FinanceOverviewChartProps {
  projection: FinanceLiquidityProjection
  bufferCents: number
  onOpenDetails?: () => void
}

interface OverviewChartDay {
  date: string
  balance: number
  actual: number | null
  projected: number | null
  events: FinanceLiquidityProjection['events']
}

const dateLabel = (date: string, pattern = 'd MMM') => format(parseISO(date), pattern, { locale: es })

function OverviewTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: OverviewChartDay }> }) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  return <div className="finance-overview-plot__tooltip">
    <strong>{dateLabel(row.date, "EEEE d 'de' MMMM")}</strong>
    {row.actual != null && <div><span>Disponible real</span><b>{formatMxn(Math.round(row.actual * 100))}</b></div>}
    {row.projected != null && <div><span>Con compromisos previstos</span><b>{formatMxn(Math.round(row.projected * 100))}</b></div>}
    {row.events.length > 0 && <ul>{row.events.map(event => <li key={event.id}><span>{event.label}{event.isOverdue ? ' · pendiente previo' : ''}</span><em data-kind={event.amountCents >= 0 ? 'income' : 'expense'}>{event.amountCents >= 0 ? '+' : '−'}{formatMxn(Math.abs(event.amountCents))}</em></li>)}</ul>}
  </div>
}

export function FinanceOverviewChart({ projection, bufferCents, onOpenDetails }: FinanceOverviewChartProps) {
  const chart = useMemo<OverviewChartDay[]>(() => projection.days.map(day => ({
    date: day.date,
    balance: day.balanceCents / 100,
    // Today's real balance excludes unpaid commitments already applied to the
    // forecast. Future months never gain a fabricated actual series.
    actual: day.date === projection.currentDate ? projection.availableTodayCents / 100
      : day.date < projection.currentDate ? day.balanceCents / 100 : null,
    projected: day.date >= projection.currentDate ? day.balanceCents / 100 : null,
    events: day.events,
  })), [projection])
  const ticks = chart.filter((_day, index) => [0, 7, 14, 21, chart.length - 1].includes(index)).map(day => day.date)
  const domain = paperChartDomain([...chart.map(day => day.balance), ...chart.flatMap(day => day.actual == null ? [] : [day.actual]), bufferCents / 100])
  const hasActual = chart.some(day => day.actual != null)
  const hasProjected = chart.some(day => day.projected != null)
  const singleProjectedPoint = chart.filter(day => day.projected != null).length === 1
  const checkpoint = projection.days.find(day => day.date.endsWith('-15'))
  const checkpointIsActual = Boolean(checkpoint && checkpoint.date < projection.currentDate)
  const historical = projection.periodMode === 'past'
  const minimumIsActual = projection.minimumDate < projection.currentDate
  const minimumSignal = projection.status === 'critical' ? 'Bajo tu colchón' : projection.status === 'moderation' ? 'Cerca del colchón' : 'Sobre tu colchón'
  const monthLabel = dateLabel(projection.periodStart, "MMMM 'de' yyyy")
  return <section className="finance-overview-plot" aria-label="Tu disponible en el tiempo">
    <header className="finance-overview-plot__header"><div><span>Evolución del disponible</span><h3>Tu disponible en el tiempo</h3><p>{historical ? 'Tus movimientos realizados durante' : 'Tu flujo y compromisos de'} {monthLabel}.</p></div><div className="finance-overview-plot__legend" aria-label="Series de la gráfica">{hasActual && <span><i aria-hidden="true" />Real</span>}{hasProjected && <span><i className="is-projected" aria-hidden="true" />Proyectado</span>}</div></header>
    <div className="finance-overview-plot__canvas" role="img" aria-label={`Disponible operativo ${hasActual && hasProjected ? 'real y proyectado' : hasActual ? 'realizado' : 'proyectado'} durante ${monthLabel}. Cierre ${historical ? 'realizado' : 'previsto'}: ${formatMxn(projection.closingBalanceCents)}.`}>
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} accessibilityLayer margin={{ top: 20, right: 12, bottom: 6, left: 3 }}>
        <CartesianGrid vertical={false} stroke="#e3e8ef" strokeDasharray="2 4" />
        <XAxis dataKey="date" ticks={ticks} tickFormatter={(date: string) => dateLabel(date)} tickLine={false} axisLine={{ stroke: '#e3e8ef' }} tick={{ fill: '#637085', fontSize: 12 }} dy={9} minTickGap={24} />
        <YAxis domain={domain} tickFormatter={paperChartAxisMxn} tickCount={4} width={58} tickLine={false} axisLine={false} tick={{ fill: '#637085', fontSize: 12 }} />
        <ReferenceLine y={bufferCents / 100} stroke="#bcc8d6" strokeWidth={1} strokeDasharray="3 5" />
        <Tooltip content={<OverviewTooltip />} cursor={{ stroke: '#a1b2c8', strokeDasharray: '3 4' }} />
        <Area isAnimationActive={false} type="monotone" dataKey="balance" fill="#eaf0f8" stroke="none" fillOpacity={0.65} tooltipType="none" name="Disponible" />
        <Line isAnimationActive={false} type="monotone" dataKey="actual" stroke="#123c72" strokeWidth={2.3} dot={false} activeDot={{ r: 4, fill: '#123c72', stroke: '#fff', strokeWidth: 2 }} name="Real" connectNulls={false} />
        <Line isAnimationActive={false} type="monotone" dataKey="projected" stroke="#123c72" strokeWidth={2.3} strokeDasharray="5 4" dot={singleProjectedPoint ? { r: 3, fill: '#123c72', stroke: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 4, fill: '#123c72', stroke: '#fff', strokeWidth: 2 }} name="Proyectado" connectNulls={false} />
      </ComposedChart></ResponsiveContainer>
    </div>
    <div className="finance-overview-plot__cards" aria-label="Proyecciones del periodo">
      <article className="finance-overview-plot__metric" data-tone="checkpoint"><header><i><CalendarDays size={17} aria-hidden="true" /></i><span>Disponible al 15</span></header><strong>{checkpoint ? formatMxn(checkpoint.balanceCents) : '—'}<small>MXN</small></strong><footer><span>{checkpointIsActual ? 'Realizado' : 'Previsto'} · {checkpoint ? dateLabel(checkpoint.date) : monthLabel}</span></footer></article>
      <article className="finance-overview-plot__metric" data-tone={projection.closingBalanceCents >= bufferCents ? 'closing' : 'attention'}><header><i><Landmark size={17} aria-hidden="true" /></i><span>{historical ? 'Disponible al cierre' : 'Disponible previsto al cierre'}</span></header><strong>{formatMxn(projection.closingBalanceCents)}<small>MXN</small></strong><footer><span>{historical ? 'Realizado' : 'Previsto'} · {dateLabel(projection.periodEnd)}</span></footer></article>
      <article className="finance-overview-plot__metric" data-tone={projection.status === 'critical' ? 'attention' : 'minimum'}><header><i>{projection.status === 'critical' ? <AlertTriangle size={17} aria-hidden="true" /> : <ArrowDownRight size={17} aria-hidden="true" />}</i><span>Mínimo del periodo</span></header><strong>{formatMxn(projection.minimumBalanceCents)}<small>MXN</small></strong><footer><span>{minimumIsActual ? 'Realizado' : 'Previsto'} · {dateLabel(projection.minimumDate)}</span><b>{minimumSignal}</b></footer></article>
    </div>
    <footer className="finance-overview-plot__note"><p>{historical ? 'Historia reconstruida con tus movimientos realizados.' : 'Proyección con tus compromisos y las reservas activas de este periodo.'}<span>Colchón mínimo: {formatMxn(bufferCents)}.</span></p>{onOpenDetails && <button type="button" onClick={onOpenDetails}>Ver detalle <ArrowRight size={14} aria-hidden="true" /></button>}</footer>
  </section>
}
