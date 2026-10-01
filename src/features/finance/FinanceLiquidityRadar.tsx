import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CircleGauge, Landmark, Settings2, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Modal } from '../../components/common'
import type { FinanceData, FinanceLiquiditySnapshot } from './financeTypes'
import {
  financeLiquidityDeviation,
  financeLiquidityProjection,
  financeLiquidityStatusCopy,
  LIQUIDITY_MODERATION_MULTIPLIER,
  personalBudgetScenarioReservationCents,
  type FinanceLiquidityProjection,
  type LiquiditySimulationInput,
  type PersonalBudgetScenarioInput,
} from '../../services/financeLiquidityProjection'
import { formatMxn, personalBudgetCarryOverIntoPeriod, personalBudgetForDate } from '../../services/financeService'
import { fortnightPeriodForMonth } from '../../services/financeBudgetCycle'

interface FinanceLiquidityRadarProps {
  data: FinanceData
  month: Date
  availableTodayCents: number
  snapshot?: FinanceLiquiditySnapshot
  userId?: string
  onSaveMinimumBuffer: (amountCents: number) => Promise<void>
}

const dateLabel = (date: string, pattern = "d 'de' MMM") => format(parseISO(date), pattern, { locale: es })
const compactCurrency = (amountCents: number) => {
  const amount = amountCents / 100
  if (Math.abs(amount) >= 1000) return `${amount < 0 ? '−' : ''}$${(Math.abs(amount) / 1000).toFixed(Math.abs(amount) >= 10000 ? 0 : 1)}k`
  return formatMxn(amountCents)
}

function statusLabel(status: FinanceLiquidityProjection['status']) {
  if (status === 'stable') return 'Estable'
  if (status === 'moderation') return 'Moderación'
  return 'Crítico'
}

function statusMessage(projection: FinanceLiquidityProjection) {
  const minimumDate = dateLabel(projection.minimumDate, 'd MMM')
  if (projection.status === 'stable') return `El punto más bajo es ${formatMxn(projection.minimumBalanceCents)} el ${minimumDate}; se mantiene sobre tu colchón.`
  if (projection.status === 'moderation') return `El punto más bajo es ${formatMxn(projection.minimumBalanceCents)} el ${minimumDate}; entra en la zona cercana a tu colchón.`
  return `El punto más bajo es ${formatMxn(projection.minimumBalanceCents)} el ${minimumDate}; cruza tu colchón configurado.`
}

const reservationPreferenceKey = 'faro-finance-liquidity-reserve-personal'
const personalScenarioStorageKey = (userId: string | undefined, periodStart: string) =>
  `faro-finance-liquidity-q2-scenario:v1:${userId ?? 'local'}:${periodStart}`

export function FinanceLiquidityRadar({ data, month, availableTodayCents, snapshot, userId, onSaveMinimumBuffer }: FinanceLiquidityRadarProps) {
  const [simulation, setSimulation] = useState<LiquiditySimulationInput>()
  const [personalBudgetScenario, setPersonalBudgetScenario] = useState<PersonalBudgetScenarioInput>()
  const [showSimulator, setShowSimulator] = useState(false)
  const [showBudgetScenario, setShowBudgetScenario] = useState(false)
  const [loadedScenarioKey, setLoadedScenarioKey] = useState('')
  const [includePersonalBudgetReservations, setIncludePersonalBudgetReservations] = useState(() => {
    if (typeof window === 'undefined') return false
    const stored = window.localStorage.getItem(reservationPreferenceKey)
    return stored == null ? true : stored === 'true'
  })
  const [bufferInput, setBufferInput] = useState(String(data.liquidityPreference.minimumOperatingBufferCents / 100))
  const [savingBuffer, setSavingBuffer] = useState(false)
  const [bufferError, setBufferError] = useState('')
  const q1Period = useMemo(() => fortnightPeriodForMonth(format(month, 'yyyy-MM-dd'), 'q1'), [month])
  const q2Period = useMemo(() => fortnightPeriodForMonth(format(month, 'yyyy-MM-dd'), 'q2'), [month])
  const q1Budget = useMemo(() => personalBudgetForDate(data.budgets, q1Period.periodStart), [data.budgets, q1Period.periodStart])
  const q2Budget = useMemo(() => personalBudgetForDate(data.budgets, q2Period.periodStart), [data.budgets, q2Period.periodStart])
  const q2CarryOverCents = useMemo(() => personalBudgetCarryOverIntoPeriod(data, q2Period.periodStart), [data, q2Period.periodStart])
  const q2DefaultTargetCents = q2Budget?.plannedAmountCents ?? q1Budget?.plannedAmountCents ?? 0
  const q2ScenarioKey = useMemo(() => personalScenarioStorageKey(userId, q2Period.periodStart), [q2Period.periodStart, userId])
  const baselineProjection = useMemo(() => financeLiquidityProjection({
    data,
    month,
    currentAvailableBalanceCents: availableTodayCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    simulation,
    includePersonalBudgetReservations,
  }), [availableTodayCents, data, includePersonalBudgetReservations, month, simulation])
  const projection = useMemo(() => financeLiquidityProjection({
    data,
    month,
    currentAvailableBalanceCents: availableTodayCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    simulation,
    personalBudgetScenario,
    includePersonalBudgetReservations,
  }), [availableTodayCents, data, includePersonalBudgetReservations, month, personalBudgetScenario, simulation])
  const comparisonProjection = useMemo(() => financeLiquidityProjection({
    data,
    month,
    currentAvailableBalanceCents: availableTodayCents,
    minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
    includePersonalBudgetReservations: true,
  }), [availableTodayCents, data, month])
  useEffect(() => {
    window.localStorage.setItem(reservationPreferenceKey, String(includePersonalBudgetReservations))
  }, [includePersonalBudgetReservations])
  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        const stored = window.localStorage.getItem(q2ScenarioKey)
        const parsed = stored ? JSON.parse(stored) as Partial<PersonalBudgetScenarioInput> : undefined
        const targetAmountCents = Number(parsed?.targetAmountCents)
        if (parsed
          && parsed.periodStart === q2Period.periodStart
          && parsed.periodEnd === q2Period.periodEnd
          && Number.isFinite(targetAmountCents)
          && targetAmountCents >= 0) {
          setPersonalBudgetScenario({
            periodStart: parsed.periodStart,
            periodEnd: parsed.periodEnd,
            targetAmountCents,
          })
          setIncludePersonalBudgetReservations(true)
        } else {
          setPersonalBudgetScenario(undefined)
        }
      } catch {
        setPersonalBudgetScenario(undefined)
      } finally {
        setLoadedScenarioKey(q2ScenarioKey)
      }
    })
    return () => { cancelled = true }
  }, [q2Period.periodEnd, q2Period.periodStart, q2ScenarioKey])
  useEffect(() => {
    if (typeof window === 'undefined' || loadedScenarioKey !== q2ScenarioKey) return
    if (personalBudgetScenario) {
      window.localStorage.setItem(q2ScenarioKey, JSON.stringify(personalBudgetScenario))
    } else {
      window.localStorage.removeItem(q2ScenarioKey)
    }
  }, [loadedScenarioKey, personalBudgetScenario, q2ScenarioKey])
  // Snapshots are captured with the canonical conservative policy. Keep the
  // comparison on that same basis so switches and what-if scenarios cannot
  // manufacture a fictitious deviation.
  const deviation = financeLiquidityDeviation(comparisonProjection.minimumBalanceCents, snapshot?.initialProjectedMinimumCents)
  const firstSensitivePeriod = projection.sensitivePeriods[0]
  const eventsByDay = projection.days.filter((day) => day.events.length)
  const openingSourceMonthLabel = projection.openingBalanceSourcePeriod
    ? dateLabel(projection.openingBalanceSourcePeriod, "MMMM 'de' yyyy")
    : ''
  const isHistorical = projection.periodMode === 'past'
  const openingMetric = projection.periodMode === 'current'
    ? { label: 'Disponible operativo hoy', value: projection.availableTodayCents, meta: dateLabel(projection.currentDate, 'd MMM') }
    : projection.periodMode === 'future'
      ? { label: 'Disponible operativo inicial', value: projection.openingBalanceCents, meta: `Cierre operativo de ${openingSourceMonthLabel}` }
      : { label: 'Disponible operativo inicial', value: projection.openingBalanceCents, meta: `Reconstruido al ${dateLabel(projection.periodStart, 'd MMM')}` }
  const projectionBasisCopy = projection.periodMode === 'current'
    ? 'Parte del saldo real de hoy; antes de hoy muestra movimientos realizados y después, compromisos pendientes.'
    : projection.periodMode === 'future'
      ? `Parte del cierre proyectado de ${openingSourceMonthLabel} e incorpora los compromisos de ${dateLabel(projection.periodStart, 'MMMM')}.`
      : 'Reconstruye el periodo sólo con movimientos realizados; los planes vencidos no alteran la historia.'
  const reservationCopy = isHistorical
    ? ''
    : includePersonalBudgetReservations
      ? ' También reserva el remanente del presupuesto personal sin duplicar pagos.'
      : ' No aparta presupuesto personal sin fecha.'

  const saveBuffer = async () => {
    const amount = Number(bufferInput.replace(/,/g, ''))
    if (!Number.isFinite(amount) || amount < 0) {
      setBufferError('Ingresa un colchón válido, igual o mayor a cero.')
      return
    }
    setSavingBuffer(true)
    setBufferError('')
    try {
      await onSaveMinimumBuffer(Math.round(amount * 100))
    } catch (error) {
      setBufferError(error instanceof Error ? error.message : 'No fue posible guardar el colchón.')
    } finally {
      setSavingBuffer(false)
    }
  }

  return <section className="liquidity-radar" aria-label="Radar de liquidez">
    <header className="liquidity-radar__head">
      <div>
        <span className="eyebrow">FARO Finanzas</span>
        <h2>Radar de liquidez</h2>
        <p>{statusMessage(projection)}</p>
      </div>
      <div className={`liquidity-radar__status liquidity-radar__status--${projection.status}`}>
        <CircleGauge size={16} />
        <span>{statusLabel(projection.status)}</span>
        <small>{isHistorical ? 'Resultado realizado frente a tu colchón configurado.' : financeLiquidityStatusCopy(projection.status)}</small>
      </div>
      <Button
        icon={<Sparkles size={15} />}
        disabled={isHistorical}
        title={isHistorical ? 'Los periodos cerrados muestran sólo movimientos realizados.' : undefined}
        onClick={() => setShowSimulator(true)}
      >Simular movimiento</Button>
    </header>

    <div className="liquidity-radar__metrics">
      <Metric label={openingMetric.label} value={openingMetric.value} meta={openingMetric.meta} icon={<Landmark size={17} />} />
      <Metric label={isHistorical ? 'Punto mínimo realizado' : 'Punto mínimo previsto'} value={projection.minimumBalanceCents} meta={dateLabel(projection.minimumDate, 'd MMM')} icon={<ArrowDownRight size={17} />} tone={projection.status === 'critical' ? 'negative' : 'neutral'} />
      <Metric label="Colchón mínimo" value={data.liquidityPreference.minimumOperatingBufferCents} icon={<Settings2 size={17} />} />
      <Metric label={isHistorical ? 'Margen mínimo realizado' : 'Margen libre proyectado'} value={projection.freeMarginCents} meta={projection.freeMarginCents >= 0 ? 'Antes de tocar el colchón' : 'Déficit frente al colchón'} icon={projection.freeMarginCents >= 0 ? <ArrowUpRight size={17} /> : <AlertTriangle size={17} />} tone={projection.freeMarginCents >= 0 ? 'positive' : 'negative'} />
    </div>

    <section className="liquidity-radar__chart-card">
      <header>
        <div className="liquidity-radar__chart-copy">
          <span className="eyebrow">Evolución temporal</span>
          <h3>{isHistorical ? 'Saldo realizado día a día' : includePersonalBudgetReservations ? 'Saldo de caja con presupuesto personal' : 'Saldo de caja día a día'}</h3>
          <p>{projectionBasisCopy}{reservationCopy}</p>
        </div>
        <div className="liquidity-radar__chart-controls">
          <button
            type="button"
            role="switch"
            aria-checked={!isHistorical && includePersonalBudgetReservations}
            aria-disabled={isHistorical}
            disabled={isHistorical}
            title={isHistorical ? 'Los periodos cerrados no incluyen reservas hipotéticas.' : undefined}
            className={`liquidity-radar__budget-switch${!isHistorical && includePersonalBudgetReservations ? ' is-active' : ''}`}
            onClick={() => setIncludePersonalBudgetReservations((current) => !current)}
          >
            <i aria-hidden="true"><span /></i>
            <span>Presupuesto personal</span>
            <small>{isHistorical ? 'Periodo cerrado · sólo realizado' : includePersonalBudgetReservations ? 'Reserva futura · sin duplicar pagos' : 'Sólo gastos con fecha'}</small>
          </button>
          <div className="liquidity-radar__scenario-slot">
            {!isHistorical && includePersonalBudgetReservations && personalBudgetScenario && <span className="liquidity-radar__saved-scenario">Q2 guardado · {formatMxn(personalBudgetScenario.targetAmountCents)}</span>}
          </div>
        </div>
        <div className="liquidity-radar__minimum"><small>Punto mínimo</small><strong>{formatMxn(projection.minimumBalanceCents)}</strong><span>{dateLabel(projection.minimumDate, "EEE d 'de' MMM")}</span></div>
      </header>
      <LiquidityChart
        projection={projection}
        bufferCents={data.liquidityPreference.minimumOperatingBufferCents}
        q2ReleaseDate={q2Period.periodStart}
        onQ2ReleaseClick={isHistorical ? undefined : () => {
          setIncludePersonalBudgetReservations(true)
          setShowBudgetScenario(true)
        }}
      />
      <footer>
        <span><i className="liquidity-radar__legend-dot liquidity-radar__legend-dot--line" />{isHistorical ? 'Saldo realizado' : 'Disponible operativo proyectado'}</span>
        <span><i className="liquidity-radar__legend-dot liquidity-radar__legend-dot--buffer" />Colchón mínimo</span>
        <span><i className="liquidity-radar__legend-dot liquidity-radar__legend-dot--event" />{isHistorical ? 'Impacto realizado' : 'Impacto programado'}</span>
      </footer>
    </section>

    <div className="liquidity-radar__below-chart">
      <section className="liquidity-radar__comparison">
        <header><span className="eyebrow">Desviación contra plan</span><h3>Proyección inicial vs actual</h3></header>
        {snapshot ? <div className="liquidity-radar__comparison-grid">
          <div><small>Mínimo inicial</small><strong>{formatMxn(snapshot.initialProjectedMinimumCents)}</strong><span>{dateLabel(snapshot.snapshotDate, 'd MMM')}</span></div>
          <div><small>Mínimo actual</small><strong>{formatMxn(comparisonProjection.minimumBalanceCents)}</strong><span>{dateLabel(comparisonProjection.minimumDate, 'd MMM')}</span></div>
          <div className={deviation && deviation < 0 ? 'is-negative' : 'is-positive'}><small>Desviación</small><strong>{deviation && deviation > 0 ? '+' : ''}{formatMxn(deviation ?? 0)}</strong><span>{deviation === 0 ? 'Sin cambio registrado' : `Punto mínimo ${deviation && deviation < 0 ? 'bajó' : 'subió'} frente al inicio`}</span></div>
        </div> : <p className="liquidity-radar__empty">Esta primera lectura se está guardando como referencia mensual. Nunca se sobrescribe al refrescar.</p>}
      </section>
      <section className="liquidity-radar__sensitive">
        <header><span className="eyebrow">Periodo sensible</span><h3>{firstSensitivePeriod ? `${dateLabel(firstSensitivePeriod.startDate, 'd MMM')} — ${dateLabel(firstSensitivePeriod.endDate, 'd MMM')}` : 'Sin periodo de moderación'}</h3></header>
        <p>{firstSensitivePeriod
          ? `Hay ${projection.sensitivePeriods.length > 1 ? 'varios tramos' : 'un tramo'} donde el saldo se mantiene en o bajo el 120% de tu colchón.`
          : 'No se anticipa un periodo cercano a tu colchón mínimo con el plan registrado.'}</p>
      </section>
    </div>

    <section className="liquidity-radar__impacts">
      <header><div><span className="eyebrow">{isHistorical ? 'Impactos realizados' : 'Próximos impactos'}</span><h3>Movimientos que explican la curva</h3></div>{!isHistorical && (simulation || personalBudgetScenario) && <button className="liquidity-radar__discard" onClick={() => { setSimulation(undefined); setPersonalBudgetScenario(undefined) }}>Descartar escenario temporal</button>}</header>
      {eventsByDay.length ? <div className="liquidity-radar__impact-table">
        <div className="liquidity-radar__impact-head"><span>Fecha</span><span>Movimiento</span><span>Impacto</span><span>Saldo después</span></div>
        {eventsByDay.map((day) => <div key={day.date} className={day.balanceCents === projection.minimumBalanceCents ? 'is-minimum' : ''}>
          <time>{dateLabel(day.date, 'EEE d MMM')}</time>
          <span>{day.events.map((event) => event.label).join(' · ')}{day.events.some((event) => event.isOverdue) && <small>Vencido: se aplica hoy</small>}</span>
          <strong className={day.incomeCents >= day.expenseCents ? 'positive' : 'negative'}>{day.incomeCents >= day.expenseCents ? '+' : '−'}{formatMxn(Math.abs(day.incomeCents - day.expenseCents))}</strong>
          <b>{formatMxn(day.balanceCents)}{day.balanceCents === projection.minimumBalanceCents && <em>Punto mínimo</em>}</b>
        </div>)}
      </div> : <p className="liquidity-radar__empty">No hay movimientos planeados o recurrentes con fecha en este periodo.</p>}
    </section>

    <section className="liquidity-radar__buffer">
      <div><span className="eyebrow">Configuración</span><h3>Colchón mínimo operativo</h3><p>Es una referencia de seguridad: FARO no aparta ni mueve este dinero.</p></div>
      <div className="liquidity-radar__buffer-control"><label htmlFor="liquidity-buffer">MXN</label><input id="liquidity-buffer" inputMode="decimal" value={bufferInput} onChange={(event) => setBufferInput(event.target.value)} /><Button loading={savingBuffer} onClick={() => void saveBuffer()}>Guardar colchón</Button>{bufferError && <small>{bufferError}</small>}</div>
    </section>

    <SimulationModal
      open={showSimulator}
      onClose={() => setShowSimulator(false)}
      baseline={projection}
      data={data}
      month={month}
      availableTodayCents={availableTodayCents}
      includePersonalBudgetReservations={includePersonalBudgetReservations}
      onApply={(next) => { setSimulation(next); setShowSimulator(false) }}
    />
    {showBudgetScenario && <PersonalBudgetScenarioModal
      open={showBudgetScenario}
      onClose={() => setShowBudgetScenario(false)}
      baseline={baselineProjection}
      data={data}
      month={month}
      availableTodayCents={availableTodayCents}
      includePersonalBudgetReservations
      periodStart={q2Period.periodStart}
      periodEnd={q2Period.periodEnd}
      carryOverCents={q2CarryOverCents}
      defaultTargetCents={personalBudgetScenario?.targetAmountCents ?? q2DefaultTargetCents}
      onApply={(next) => { setPersonalBudgetScenario(next); setIncludePersonalBudgetReservations(true); setShowBudgetScenario(false) }}
    />}
  </section>
}

function Metric({ label, value, meta, icon, tone = 'neutral' }: { label: string; value: number; meta?: string; icon: React.ReactNode; tone?: 'neutral' | 'positive' | 'negative' }) {
  return <article className={`liquidity-radar__metric liquidity-radar__metric--${tone}`}><i>{icon}</i><span>{label}</span><strong>{formatMxn(value)}</strong>{meta && <small>{meta}</small>}</article>
}

function LiquidityChart({ projection, bufferCents, q2ReleaseDate, onQ2ReleaseClick }: {
  projection: FinanceLiquidityProjection
  bufferCents: number
  q2ReleaseDate: string
  onQ2ReleaseClick?: () => void
}) {
  const rows = projection.days.map((day) => ({
    ...day,
    balance: day.balanceCents / 100,
    hasEvent: day.events.length > 0,
    isQ2Release: Boolean(onQ2ReleaseClick && day.date === q2ReleaseDate),
  }))
  const values = rows.map((row) => row.balance)
  const buffer = bufferCents / 100
  const minimum = Math.min(...values, buffer)
  const maximum = Math.max(...values, buffer * LIQUIDITY_MODERATION_MULTIPLIER)
  const gap = Math.max(1_000, maximum - minimum)
  const domain: [number, number] = [Math.floor((minimum - gap * .12) / 1000) * 1000, Math.ceil((maximum + gap * .12) / 1000) * 1000]
  const marker = (props: { cx?: number; cy?: number; payload?: { hasEvent?: boolean; isCurrent?: boolean; isQ2Release?: boolean; balance?: number } }) => {
    if (!props.payload?.hasEvent && !props.payload?.isCurrent && !props.payload?.isQ2Release) return <g />
    if (props.payload?.isQ2Release) {
      return <circle
        cx={props.cx}
        cy={props.cy}
        r={6}
        fill="#0d2036"
        stroke="#8f6cff"
        strokeWidth={2.4}
        style={{ cursor: 'pointer' }}
        onClick={(event) => { event.stopPropagation(); onQ2ReleaseClick?.() }}
      />
    }
    return <circle cx={props.cx} cy={props.cy} r={props.payload.isCurrent ? 5 : 3.4} fill={props.payload.isCurrent ? '#f5fbff' : '#dba44f'} stroke={props.payload.isCurrent ? '#3d8cff' : '#111a22'} strokeWidth={2} />
  }
  return <div className="liquidity-radar__chart">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 16, right: 18, bottom: 4, left: 10 }}>
        <defs><linearGradient id="liquidity-radar-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#3f8dff" stopOpacity=".28" /><stop offset="1" stopColor="#3f8dff" stopOpacity="0" /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="#172638" strokeDasharray="3 5" />
        <ReferenceArea y1={buffer * LIQUIDITY_MODERATION_MULTIPLIER} y2={domain[1]} fill="#173628" fillOpacity={.2} />
        <ReferenceArea y1={buffer} y2={buffer * LIQUIDITY_MODERATION_MULTIPLIER} fill="#4a4123" fillOpacity={.15} />
        <ReferenceArea y1={domain[0]} y2={buffer} fill="#482126" fillOpacity={.15} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={26} tick={{ fill: '#7e91a7', fontSize: 9 }} tickFormatter={(date: string) => dateLabel(date, 'd')} />
        <YAxis domain={domain} axisLine={false} tickLine={false} width={56} tick={{ fill: '#7e91a7', fontSize: 9 }} tickFormatter={(value: number) => compactCurrency(Math.round(value * 100))} />
        <ReferenceLine y={buffer} stroke="#8796a7" strokeWidth={1.2} strokeDasharray="5 4" label={{ value: 'Colchón mínimo', fill: '#9ba8b7', fontSize: 9, position: 'insideTopLeft' }} />
        {onQ2ReleaseClick && <ReferenceLine x={q2ReleaseDate} stroke="#8f6cff" strokeDasharray="3 4" strokeOpacity={.62} label={{ value: 'Q2 · simular', fill: '#ad94ff', fontSize: 8, position: 'insideTop' }} />}
        <Tooltip content={<LiquidityTooltip periodStart={projection.periodStart} openingBalanceCents={projection.openingBalanceCents} openingIsProjected={projection.openingBalanceSource === 'prior_projected_close'} />} cursor={{ stroke: '#7795b5', strokeDasharray: '3 4' }} />
        <Area type="monotone" dataKey="balance" stroke="#4d9cff" strokeWidth={2.6} fill="url(#liquidity-radar-fill)" dot={marker} activeDot={{ r: 5, fill: '#dcecff', stroke: '#3986ff', strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  </div>
}

function LiquidityTooltip({ active, payload, periodStart, openingBalanceCents, openingIsProjected }: {
  active?: boolean
  payload?: Array<{ payload: { date: string; balance: number; incomeCents: number; expenseCents: number; events: Array<{ label: string; amountCents: number; isOverdue?: boolean }> } }>
  periodStart: string
  openingBalanceCents: number
  openingIsProjected: boolean
}) {
  const row = active ? payload?.[0]?.payload : undefined
  if (!row) return null
  const showOpening = openingIsProjected && row.date === periodStart
  return <div className="liquidity-radar__tooltip"><strong>{dateLabel(row.date, "EEEE d 'de' MMM")}</strong><small>Saldo después</small><b>{formatMxn(Math.round(row.balance * 100))}</b>{(showOpening || row.events.length > 0) && <ul>{showOpening && <li><span>Disponible operativo inicial</span><em className="positive">{formatMxn(openingBalanceCents)}</em></li>}{row.events.map((event) => <li key={`${event.label}-${event.amountCents}`}><span>{event.label}{event.isOverdue ? ' · vencido' : ''}</span><em className={event.amountCents >= 0 ? 'positive' : 'negative'}>{event.amountCents >= 0 ? '+' : '−'}{formatMxn(Math.abs(event.amountCents))}</em></li>)}</ul>}</div>
}

function SimulationModal({ open, onClose, baseline, data, month, availableTodayCents, includePersonalBudgetReservations, onApply }: {
  open: boolean
  onClose: () => void
  baseline: FinanceLiquidityProjection
  data: FinanceData
  month: Date
  availableTodayCents: number
  includePersonalBudgetReservations: boolean
  onApply: (simulation: LiquiditySimulationInput) => void
}) {
  const [type, setType] = useState<'expense' | 'income'>('expense')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(baseline.currentDate >= baseline.periodStart && baseline.currentDate <= baseline.periodEnd ? baseline.currentDate : baseline.periodStart)
  const [description, setDescription] = useState('')
  const amountCents = Math.round(Number(amount || 0) * 100)
  const candidate = amountCents > 0 ? { type, amountCents, date, description } satisfies LiquiditySimulationInput : undefined
  const preview = useMemo(() => candidate ? financeLiquidityProjection({ data, month, currentAvailableBalanceCents: availableTodayCents, minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents, simulation: candidate, includePersonalBudgetReservations }) : undefined, [availableTodayCents, candidate, data, includePersonalBudgetReservations, month])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (candidate) onApply(candidate)
  }
  return <Modal open={open} title="Simular movimiento" onClose={onClose} panelClassName="liquidity-simulator-modal">
    <form className="liquidity-simulator" onSubmit={submit}>
      <p>Este escenario se mantiene sólo en esta vista y no registra un movimiento real.</p>
      <div className="liquidity-simulator__fields">
        <label>Tipo<select value={type} onChange={(event) => setType(event.target.value as 'expense' | 'income')}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></label>
        <label>Monto (MXN)<input required min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Fecha<input required type="date" min={baseline.periodStart} max={baseline.periodEnd} value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Descripción <small>opcional</small><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={type === 'expense' ? 'Ej. Celular' : 'Ej. Cobro extraordinario'} /></label>
      </div>
      <SimulationComparison before={baseline} after={preview} />
      <footer><Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!candidate}>Aplicar simulación</Button></footer>
    </form>
  </Modal>
}

function PersonalBudgetScenarioModal({ open, onClose, baseline, data, month, availableTodayCents, includePersonalBudgetReservations, periodStart, periodEnd, carryOverCents, defaultTargetCents, onApply }: {
  open: boolean
  onClose: () => void
  baseline: FinanceLiquidityProjection
  data: FinanceData
  month: Date
  availableTodayCents: number
  includePersonalBudgetReservations: boolean
  periodStart: string
  periodEnd: string
  carryOverCents: number
  defaultTargetCents: number
  onApply: (scenario: PersonalBudgetScenarioInput) => void
}) {
  const [amount, setAmount] = useState(() => defaultTargetCents ? String(defaultTargetCents / 100) : '')
  const targetAmountCents = Math.round(Number(amount || 0) * 100)
  const hasCandidate = targetAmountCents >= 0 && amount.trim() !== ''
  const candidate = hasCandidate
    ? { periodStart, periodEnd, targetAmountCents } satisfies PersonalBudgetScenarioInput
    : undefined
  const reservationCents = candidate ? personalBudgetScenarioReservationCents(data, candidate) : 0
  const preview = useMemo(() => {
    const previewTargetCents = Math.round(Number(amount || 0) * 100)
    if (previewTargetCents < 0 || amount.trim() === '') return undefined
    return financeLiquidityProjection({
      data,
      month,
      currentAvailableBalanceCents: availableTodayCents,
      minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
      personalBudgetScenario: { periodStart, periodEnd, targetAmountCents: previewTargetCents },
      includePersonalBudgetReservations,
    })
  }, [amount, availableTodayCents, data, includePersonalBudgetReservations, month, periodEnd, periodStart])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (candidate) onApply(candidate)
  }
  return <Modal open={open} title="Escenario de presupuesto Q2" onClose={onClose} panelClassName="liquidity-simulator-modal">
    <form className="liquidity-simulator liquidity-budget-simulator" onSubmit={submit}>
      <p>Este cálculo sólo vive en el Radar. No crea ni modifica tu presupuesto real.</p>
      <div className="liquidity-budget-simulator__context">
        <span>Se libera el {dateLabel(periodStart, "d 'de' MMMM")}</span>
        <strong>Arrastre disponible de Q1 <b>{formatMxn(carryOverCents)}</b></strong>
      </div>
      <label>Presupuesto nuevo para Q2 (MXN)<input autoFocus required min="0" step=".01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Ej. 5000" /></label>
      {candidate && <p className="liquidity-budget-simulator__formula">Nuevo Q2 {formatMxn(candidate.targetAmountCents)} se aparta completo. El arrastre de Q1 se conserva aparte y los gastos ya fechados permanecen visibles como movimientos independientes. Reserva aplicada en este punto: <b>{formatMxn(reservationCents)}</b>.</p>}
      <SimulationComparison before={baseline} after={preview} />
      <footer><Button variant="ghost" type="button" onClick={onClose}>Cancelar</Button><Button type="submit" disabled={!candidate}>Ver en la curva</Button></footer>
    </form>
  </Modal>
}

function SimulationComparison({ before, after }: { before: FinanceLiquidityProjection; after?: FinanceLiquidityProjection }) {
  return <section className="liquidity-simulator__comparison"><header><span className="eyebrow">Comparación temporal</span><h3>Antes y después</h3></header><div><SimulationMetrics label="Antes" projection={before} />{after ? <SimulationMetrics label="Después" projection={after} /> : <p>Ingresa un monto válido para calcular el escenario.</p>}</div></section>
}

function SimulationMetrics({ label, projection }: { label: string; projection: FinanceLiquidityProjection }) {
  return <article><strong>{label}</strong><span>Mínimo <b>{formatMxn(projection.minimumBalanceCents)}</b></span><span>Cierre <b>{formatMxn(projection.closingBalanceCents)}</b></span><span>Margen <b className={projection.freeMarginCents < 0 ? 'negative' : 'positive'}>{formatMxn(projection.freeMarginCents)}</b></span></article>
}
