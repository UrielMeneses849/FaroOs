import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, Archive, ArrowDownLeft, ArrowLeft, ArrowRight, Bike, CalendarDays, CheckCircle2, CircleDollarSign, Flag, History, Link2, Pencil, Plus, Settings2, ShieldCheck, Store, Trash2, Wallet } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, ConfirmDialog, EmptyState, Modal, ProgressBar } from '../../components/common'
import type { FinanceDebt, DebtPlanPreferences } from './debtTypes'
import type { FinanceData, FinanceTransaction } from './financeTypes'
import { financeDebtRepository } from '../../repositories/financeDebtRepository'
import { financeLiquidityRepository } from '../../repositories/financeRepositories'
import { accountBalance, calculateFinanceMetrics, financeFrequencyLabel, formatMxn } from '../../services/financeService'
import { debtPlanAvailableCents, debtPlanBalanceCents } from '../../services/debtPlanBalance'
import { debtPayments, debtWithLatestQuote, debtRemainingCents, projectDebtPlan, debtPlanAdvanceDays, validSettlementQuote, type DebtPlanEvent } from '../../services/debtPlanService'
import './debt-plan.css'

const dateKey = () => format(new Date(), 'yyyy-MM-dd')
const labelDate = (date?: string, pattern = 'd MMM yyyy') => date ? format(parseISO(date), pattern, { locale: es }) : 'Por definir'
const cents = (value: string) => Math.round(Number(value) * 100)
const moneyInput = (value?: number) => value == null ? '' : String(value / 100)
const DebtIcon = ({ debt }: { debt: FinanceDebt }) => debt.kind === 'purchase' ? <Store size={18} /> : debt.kind === 'loan' ? <Bike size={18} /> : <CircleDollarSign size={18} />
const debtScheduleLabel = (debt: FinanceDebt) => debt.frequency === 'monthly'
  ? `Cada día ${parseISO(debt.nextPaymentDate).getDate()} del mes · ${formatMxn(debt.paymentCents)}`
  : `${financeFrequencyLabel[debt.frequency]} · ${formatMxn(debt.paymentCents)}`
const plannedPayoff = (debt: FinanceDebt, event: DebtPlanEvent) => Boolean(debt.deadline && event.date === debt.deadline && event.closes)
const strategyLabels = { minimum: 'Pagos actuales', balanced: 'Equilibrado', fast: 'Ataque total' } as const
type PlanEntry = NonNullable<FinanceData['debtPlan']>['entries'][number]
type Dialog = 'debt' | 'fund' | 'settings' | 'scenarios' | 'payment' | 'links' | 'history' | 'forecast' | null

export function DebtPlanPanel({ data, userId, onRefresh, onEditMovement, onDeleteMovement }: { data: FinanceData; userId: string; onRefresh: () => Promise<void>; onEditMovement?: (item: FinanceTransaction) => void; onDeleteMovement?: (item: FinanceTransaction) => void }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [selected, setSelected] = useState<FinanceDebt>()
  const [paymentEvent, setPaymentEvent] = useState<DebtPlanEvent>()
  const [editingEntry, setEditingEntry] = useState<PlanEntry>()
  const [deletingEntry, setDeletingEntry] = useState<PlanEntry>()
  const [deleting, setDeleting] = useState<FinanceDebt>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [chartMode, setChartMode] = useState<'debt' | 'cash'>('debt')
  const [calendarScale, setCalendarScale] = useState<'month' | 'week'>('month')
  const [offset, setOffset] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  const [monthlyDraft, setMonthlyDraft] = useState<number>()
  const preferences = data.debtPlan?.preferences
  const reference = useMemo(() => new Date(), [])
  const projection = useMemo(() => projectDebtPlan(data, { reference, monthlyContributionCents: monthlyDraft }), [data, reference, monthlyDraft])
  const baseline = useMemo(() => projectDebtPlan(data, { reference, strategy: 'minimum' }), [data, reference])
  const fundBalance = debtPlanAvailableCents(data)
  const debts = (data.debtPlan?.debts ?? []).map(debt => debtWithLatestQuote(debt, data)).filter(debt => showArchived || debt.status !== 'archived')
  const active = debts.filter(debt => debt.status === 'active' && debtRemainingCents(debt, data) > 0)
  const remaining = debts.filter(debt => debt.status !== 'archived').reduce((sum, debt) => sum + debtRemainingCents(debt, data), 0)
  const original = debts.filter(debt => debt.status !== 'archived').reduce((sum, debt) => sum + debt.balanceCents, 0)
  const progress = original ? Math.max(0, Math.min(100, (original - remaining) / original * 100)) : 0
  const next = projection.events[0]
  const weeks = useMemo(() => Array.from({ length: 16 }, (_, index) => addDays(startOfWeek(addMonths(reference, offset), { weekStartsOn: 1 }), index * 7)), [offset, reference])
  const months = useMemo(() => Array.from({ length: 5 }, (_, index) => startOfMonth(addMonths(reference, offset + index))), [offset, reference])
  const periods = calendarScale === 'month' ? months : weeks
  const screenStart = format(periods[0], 'yyyy-MM-dd')
  const screenEnd = format(calendarScale === 'month' ? endOfMonth(periods.at(-1)!) : addDays(periods.at(-1)!, 6), 'yyyy-MM-dd')
  const maxOffset = calendarScale === 'month' ? 13 : 15
  const chart = projection.days.filter(day => day.date >= screenStart && day.date <= screenEnd)
  const advance = debtPlanAdvanceDays(baseline, projection)
  const saved = async (message: string, close = true) => {
    await onRefresh()
    window.dispatchEvent(new Event('faro:finance-updated'))
    if (close) setDialog(null)
    setNotice(message); setError('')
  }
  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar. Intenta nuevamente.') }
    finally { setBusy(false) }
  }
  const openDebt = (debt?: FinanceDebt) => { setSelected(debt); setDialog('debt'); setError('') }
  const openPayment = (event?: DebtPlanEvent, debt?: FinanceDebt) => {
    setSelected(debt ?? data.debtPlan?.debts.find(item => item.id === event?.debtId) ?? active[0])
    setPaymentEvent(event); setDialog('payment'); setError('')
  }
  if (!data.debtPlan) return <EmptyState title="Plan no está disponible" description={data.debtPlanError ?? 'Actualiza tus finanzas para cargar el plan.'} action={<Button onClick={() => void onRefresh()}>Reintentar</Button>} />
  return <section className="debt-plan" aria-label="Plan de liquidación">
    {notice && <div className="dp-notice" role="status"><CheckCircle2 size={16} />{notice}<button onClick={() => setNotice('')} aria-label="Cerrar aviso">Cerrar</button></div>}
    {error && <p className="dp-error" role="alert">{error}</p>}
    <header className="dp-hero">
      <div className="dp-hero-copy"><span className="dp-eyebrow">PLAN DE LIQUIDACIÓN</span><h2>Deuda bajo control, <br />libertad más cerca.</h2><p>Tu meta: {labelDate(preferences?.targetDate)} <button aria-label="Configurar Plan" onClick={() => setDialog('settings')}><Settings2 size={14} /></button></p></div>
      <div className="dp-hero-metrics">
        <Summary icon={<Wallet />} label="Deuda restante" value={formatMxn(remaining)} detail={`${active.length} deudas activas`} />
        <Summary icon={<CalendarDays />} label="Siguiente pago" value={formatMxn(next?.amountCents ?? 0)} detail={next ? labelDate(next.date) : 'Añade tu primera deuda'} />
        <Summary icon={<Flag />} label="Fecha estimada" value={projection.finishDate ? labelDate(projection.finishDate) : active.length ? 'Más de 18 meses' : 'Sin deuda activa'} detail={advance ? `${advance} días antes` : 'Según tus reglas actuales'} />
        <Summary icon={<CheckCircle2 />} label="Progreso total" value={`${progress.toFixed(0)}%`} detail={`${formatMxn(Math.max(0, original - remaining))} liquidados`} />
      </div>
    </header>
    <div className="dp-workspace">
      <aside className="dp-debts dp-surface">
        <div className="dp-section-head"><h3>Tus deudas y reglas</h3><button aria-label="Añadir deuda" className="dp-icon-action" onClick={() => openDebt()}><Plus size={17} /></button></div>
        {!debts.length && <div className="dp-empty"><Store size={26} /><strong>Tu ruta empieza aquí</strong><p>Agrega cada producto de Coppel, tu moto o una deuda negociable.</p><Button size="sm" onClick={() => openDebt()}>Añadir deuda</Button></div>}
        <div className="dp-debt-list">{debts.map(debt => {
          const balance = debtRemainingCents(debt, data)
          const linked = data.recurring.filter(item => item.debtId === debt.id).length
          const paid = !balance
          return <article key={debt.id} className={`dp-debt${paid ? ' is-paid' : ''}`}>
            <header><span className="dp-debt-icon"><DebtIcon debt={debt} /></span><div><button onClick={() => { setSelected(debt); setDialog('history') }}>{debt.name}</button><small>{debt.creditor || 'Sin acreedor'} · {paid ? 'Liquidada' : debt.status === 'paused' ? 'Pausada' : debt.status === 'archived' ? 'Archivada' : financeFrequencyLabel[debt.frequency]}</small></div>{paid && <CheckCircle2 size={15} />}</header>
            <div className="dp-debt-balance"><span>Saldo a plazo</span><strong>{formatMxn(balance)}</strong></div>
            <ProgressBar value={Math.min(100, (debt.balanceCents - balance) / debt.balanceCents * 100)} />
            {!paid && debt.settlementCents != null && <div className="dp-rule"><span>Liquidación cotizada</span><b>{formatMxn(debt.settlementCents)}</b><small>{validSettlementQuote(debt, data, dateKey()) ? `Vigente · ${labelDate(debt.quoteValidUntil ?? debt.quoteDate)}` : 'Requiere actualizar cotización'}</small></div>}
            {!paid && debt.agreementStatus !== 'none' && <div className="dp-agreement">Convenio {debt.agreementStatus === 'confirmed' ? 'confirmado' : 'propuesto'} · {debt.agreementPayments} pagos</div>}
            {!paid && <div className="dp-rule"><span>Pago habitual</span><b>{formatMxn(debt.paymentCents)}</b><small>{debtScheduleLabel(debt)}</small><small>{projection.payoffDates[debt.id] ? `Fin estimado · ${labelDate(projection.payoffDates[debt.id])}` : `Próximo · ${labelDate(debt.nextPaymentDate)}`}</small></div>}
            {!paid && projection.events.some(event => event.debtId === debt.id && plannedPayoff(debt, event)) && <div className="dp-payoff-rule"><Flag size={13} /><span>Liquidar el {labelDate(debt.deadline, "d 'de' MMMM yyyy")}</span></div>}
            {!paid && debt.kind === 'loan' && <p className="dp-hint">{balance <= 1500000 ? 'Ya estás en el rango de $15,000 o menos para evaluar liquidar.' : (() => { const milestone = projection.events.find(event => event.debtId === debt.id && event.remainingCents <= 1500000); return milestone ? `Llegarías a $15,000 o menos el ${labelDate(milestone.date)}.` : 'Aún no llega a $15,000 en esta proyección.' })()}</p>}
            <footer><button onClick={() => openDebt(debt)}><Pencil size={12} />Editar</button><button aria-label={`Eliminar ${debt.name}`} onClick={() => setDeleting(debt)}><Trash2 size={12} />Eliminar</button><button onClick={() => { setSelected(debt); setDialog('links') }}><Link2 size={12} />{linked ? `${linked} vínculos` : 'Vincular'}</button><button aria-label={`Historial de ${debt.name}`} onClick={() => { setSelected(debt); setDialog('history') }}><History size={13} /></button></footer>
          </article>
        })}</div>
        <button className="dp-text-action" onClick={() => setShowArchived(value => !value)}>{showArchived ? 'Ocultar archivadas' : 'Ver archivadas'}</button>
      </aside>
      <div className="dp-calendar dp-surface">
        <div className="dp-section-head"><div><h3>Calendario de pagos</h3><small>{strategyLabels[preferences!.strategy]} · fechas exactas en cada pago</small></div><div className="dp-chart-switch" aria-label="Vista del calendario"><button aria-pressed={calendarScale === 'month'} onClick={() => { setCalendarScale('month'); setOffset(value => Math.min(13, value)) }}>Mensual</button><button aria-pressed={calendarScale === 'week'} onClick={() => setCalendarScale('week')}>Semanal</button></div><div className="dp-calendar-controls"><button aria-label="Periodo anterior del plan" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 3))}><ArrowLeft size={15} /></button><span>{labelDate(screenStart, 'MMM yyyy')} — {labelDate(screenEnd, 'MMM yyyy')}</span><button aria-label="Periodo siguiente del plan" disabled={offset >= maxOffset} onClick={() => setOffset(value => Math.min(maxOffset, value + 3))}><ArrowRight size={15} /></button></div></div>
        <div className="dp-timeline-scroll" tabIndex={0} role="region" aria-label="Calendario de pagos"><div className={`dp-timeline${calendarScale === 'month' ? ' dp-timeline--monthly' : ''}`} role="table" aria-label="Pagos por deuda y fecha">
          <div className="dp-timeline-row" role="row"><div className="dp-timeline-label" role="columnheader">Deuda / {calendarScale === 'month' ? 'mes' : 'semana'}</div>{periods.map(period => <div className="dp-week" role="columnheader" key={format(period, 'yyyy-MM-dd')}><strong>{format(period, calendarScale === 'month' ? 'MMMM' : 'd MMM', { locale: es })}</strong><small>{calendarScale === 'month' ? format(period, 'yyyy') : `Hasta ${format(addDays(period, 6), 'd MMM', { locale: es })}`}</small></div>)}</div>
          {active.map(debt => <TimelineRow key={debt.id} debt={debt} periods={periods} scale={calendarScale} events={projection.events.filter(event => event.debtId === debt.id)} onPayment={event => { setSelected(debt); setPaymentEvent(event); setDialog('forecast') }} />)}
          {!active.length && <div className="dp-timeline-empty"><CalendarDays size={34} /><strong>{debts.length ? 'Tus deudas están liquidadas o pausadas' : 'Tu calendario tomará forma con la primera deuda'}</strong><p>Los pagos, abonos extra y liquidaciones aparecerán aquí.</p></div>}
        </div></div>
        <div className="dp-liquidity"><div className="dp-section-head"><h3>{chartMode === 'debt' ? 'Cómo disminuye tu deuda' : 'Disponible después de pagar'}</h3><div className="dp-chart-switch"><button aria-pressed={chartMode === 'debt'} onClick={() => setChartMode('debt')}>Deuda restante</button><button aria-pressed={chartMode === 'cash'} onClick={() => setChartMode('cash')}>Disponible</button></div></div><div className="dp-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}><CartesianGrid stroke="var(--finance-chart-grid, #222c40)" vertical={false} /><XAxis dataKey="date" tickFormatter={date => labelDate(date, 'd MMM')} tick={{ fill: 'var(--finance-chart-tick, #8995aa)', fontSize: 10 }} minTickGap={50} /><YAxis width={64} tickFormatter={value => `$${Math.round(value / 100).toLocaleString('es-MX')}`} tick={{ fill: 'var(--finance-chart-tick, #8995aa)', fontSize: 10 }} /><Tooltip labelFormatter={label => labelDate(String(label))} formatter={value => formatMxn(Number(value))} contentStyle={{ background: 'var(--finance-tooltip-bg, #111925)', color: 'var(--finance-tooltip-text, #e5eeff)', border: '1px solid var(--finance-tooltip-border, #314565)', borderRadius: 8 }} />{chartMode === 'cash' && <ReferenceLine y={data.liquidityPreference.minimumOperatingBufferCents} stroke="#d5ac64" strokeDasharray="5 4" />}<Area name={chartMode === 'debt' ? 'Deuda restante' : 'Disponible'} type="stepAfter" dataKey={chartMode === 'debt' ? 'debtCents' : 'balanceCents'} stroke="var(--finance-chart-line, #729cff)" fill="var(--finance-chart-area, #182747)" fillOpacity={0.65} strokeWidth={2} /></AreaChart></ResponsiveContainer></div></div>
        <div className="dp-calendar-footer"><span><CalendarDays size={13} />Pago habitual</span><span className="dp-green"><CheckCircle2 size={13} />Liquidación</span><span><Plus size={13} />Abono extra</span><button onClick={() => setDialog('scenarios')}>Comparar escenarios <ArrowRight size={13} /></button></div>
      </div>
      <aside className="dp-actions">
        <section className="dp-surface dp-fund"><div className="dp-section-head"><h3>Tu dinero en Plan</h3><Wallet size={17} /></div><strong className="dp-big">{formatMxn(fundBalance)}</strong><p>Reservado en tus cuentas para atacar deudas.</p><Button icon={<Plus size={15} />} disabled={!data.accounts.some(account => account.isActive && account.currency === 'MXN')} onClick={() => { setSelected(undefined); setEditingEntry(undefined); setError(''); setDialog('fund') }}>Aportar a Plan</Button><button className="dp-text-action" onClick={() => { setSelected(undefined); setDialog('history') }}>Ver aportaciones y liberar dinero</button></section>
        <section className="dp-surface dp-next"><div className="dp-section-head"><h3>Tu siguiente movimiento</h3></div>{next ? <><small className="dp-blue">{labelDate(next.date, "EEEE, d 'de' MMMM")}</small><h4>{data.debtPlan.debts.find(debt => debt.id === next.debtId)?.name}</h4><strong className="dp-big">{formatMxn(next.amountCents)}</strong><div className="dp-rule"><span>Saldo después del pago</span><b>{formatMxn(next.remainingCents)}</b></div><Button onClick={() => openPayment(next)}>Registrar pago</Button></> : <p>Agrega una deuda activa para preparar tu primer pago.</p>}<button className="dp-text-action" disabled={!active.length} onClick={() => openPayment()}>Añadir pago extra</button></section>
        <section className="dp-surface dp-extra"><h3>Ritmo de aportación</h3><p>Simula una aportación mensual para acelerar la salida.</p><label className="dp-slider">Aportación mensual prevista<input aria-label="Simular aportación mensual" type="range" min="0" max={Math.max(20000, (preferences?.monthlyContributionCents ?? 0) * 2 / 100)} step="100" value={(monthlyDraft ?? preferences?.monthlyContributionCents ?? 0) / 100} onChange={event => setMonthlyDraft(Number(event.target.value) * 100)} /></label><strong className="dp-medium">{formatMxn(monthlyDraft ?? preferences?.monthlyContributionCents ?? 0)}</strong><p className="dp-hint">La proyección no aparta dinero.</p>{monthlyDraft != null && monthlyDraft !== preferences?.monthlyContributionCents && <Button size="sm" loading={busy} onClick={() => void run(async () => { await financeDebtRepository.savePreferences({ ...preferences!, monthlyContributionCents: monthlyDraft }, userId); setMonthlyDraft(undefined); await saved('Ritmo mensual actualizado.', false) })}>Aplicar ritmo</Button>}<div className="dp-impact"><span><Flag size={14} />{projection.finishDate ? labelDate(projection.finishDate) : 'Sin fecha dentro de 18 meses'}</span><span><CheckCircle2 size={14} />{advance ? `${Math.floor(advance / 7)} semanas antes` : 'Mismo plazo que el plan actual'}</span><span><CircleDollarSign size={14} />{formatMxn(projection.avoidedCostCents)} de costo futuro evitado</span></div><button className="dp-text-action" onClick={() => setDialog('settings')}><Settings2 size={13} />Ajustar montos y meta</button></section>
      </aside>
    </div>
    <div className="dp-guardrail"><ShieldCheck size={24} /><div><strong>Tu colchón protegido · {formatMxn(data.liquidityPreference.minimumOperatingBufferCents)}</strong><p>Los pagos extra del escenario equilibrado respetan los compromisos conocidos de los siguientes 30 días.</p></div><button onClick={() => setDialog('settings')}>Editar</button></div>
    {projection.warnings.length > 0 && <details className="dp-assumptions"><summary><AlertTriangle size={15} />Condiciones de esta proyección · {projection.warnings.length}</summary>{projection.warnings.map(warning => <p key={warning}>{warning}</p>)}<p>El saldo usa los importes capturados; el interés de cada pago se puede separar al registrarlo. Los ahorros sólo se calculan con cotizaciones o convenios confirmados.</p></details>}
    {dialog === 'debt' && <DebtEditor initial={selected} busy={busy} error={error} onClose={() => setDialog(null)} onSave={debt => run(async () => { await financeDebtRepository.save(debt, userId); await saved('Deuda guardada. El calendario se recalculó.') })} onDelete={debt => { setDialog(null); setDeleting(debt) }} />}
    {dialog === 'fund' && <PlanFundsDialog data={data} initial={editingEntry} busy={busy} error={error} onClose={() => { setEditingEntry(undefined); setDialog(null) }} onSave={input => run(async () => { if (editingEntry) await financeDebtRepository.reviseEntry(input, userId); else await financeDebtRepository.allocate(input, userId); setEditingEntry(undefined); await saved(editingEntry ? 'Reserva de Plan actualizada.' : input.amountCents > 0 ? 'Dinero reservado en Plan.' : 'Dinero liberado de Plan.') })} />}
    {dialog === 'settings' && <PlanSettings data={data} busy={busy} error={error} onClose={() => setDialog(null)} onSave={(input, buffer) => run(async () => { await financeDebtRepository.savePreferences(input, userId); await financeLiquidityRepository.saveMinimumOperatingBuffer(buffer, userId); setMonthlyDraft(undefined); await saved('Plan y colchón actualizados.') })} />}
    {dialog === 'scenarios' && <Modal open title="Compara tu ruta de salida" panelClassName="dp-modal dp-scenarios-modal" onClose={() => setDialog(null)}><div className="dp-scenarios">{(['minimum', 'balanced', 'fast'] as const).map(strategy => {
      const scenario = strategy === 'minimum' ? baseline : projectDebtPlan(data, { reference, strategy })
      return <article key={strategy}><h3>{strategyLabels[strategy]}</h3><p>{strategy === 'minimum' ? 'Mantiene tus pagos habituales.' : strategy === 'balanced' ? 'Usa Plan para acelerar y protege el colchón.' : 'Usa Plan hasta el disponible; permite bajar del colchón.'}</p><Summary label="Fecha estimada" value={scenario.finishDate ? labelDate(scenario.finishDate) : 'Más de 18 meses'} /><Summary label="Total de pagos futuros" value={formatMxn(scenario.totalPaidCents)} /><Summary label="Costo evitado" value={formatMxn(scenario.avoidedCostCents)} /><Summary label="Mínimo disponible" value={formatMxn(scenario.minimumCashCents)} />{scenario.minimumCashCents < data.liquidityPreference.minimumOperatingBufferCents && <small className="dp-amber">Cruza el colchón · {labelDate(scenario.minimumDate)}</small>}<Button loading={busy} variant={preferences?.strategy === strategy ? 'primary' : 'secondary'} onClick={() => void run(async () => { await financeDebtRepository.savePreferences({ ...preferences!, strategy }, userId); await saved('Estrategia aplicada. Revisa los próximos pagos.') })}>{preferences?.strategy === strategy ? 'Plan actual' : 'Usar este plan'}</Button></article>
    })}</div>{error && <p role="alert" className="dp-error">{error}</p>}</Modal>}
    {dialog === 'forecast' && selected && paymentEvent && <DebtForecastDialog key={paymentEvent.id} debt={selected} event={paymentEvent} data={data} reference={reference} monthlyContributionCents={monthlyDraft} onClose={() => setDialog(null)} onRegister={() => openPayment(paymentEvent, selected)} />}
    {dialog === 'payment' && selected && <DebtPaymentDialog key={paymentEvent?.id ?? selected.id} debt={selected} data={data} event={paymentEvent} busy={busy} error={error} onClose={() => setDialog(null)} onSave={input => run(async () => {
      await financeDebtRepository.pay(input, paymentEvent?.occurrenceId, userId)
      await saved('Pago registrado una sola vez. Se actualizaron tu deuda y Plan.')
    })} />}
    {dialog === 'links' && selected && <DebtLinks debt={selected} data={data} busy={busy} error={error} onClose={() => setDialog(null)} onLink={(debtId, source) => run(async () => { await financeDebtRepository.link(debtId, source, userId); await saved('Vínculo actualizado. Los pagos completados desde la fecha del saldo ya cuentan para la deuda.', false) })} />}
    {dialog === 'history' && <DebtHistory debt={selected} data={data} onEditEntry={entry => { setEditingEntry(entry); setDialog('fund') }} onDeleteEntry={entry => { setDialog(null); setDeletingEntry(entry) }} onEditMovement={onEditMovement ? item => { setDialog(null); onEditMovement(item) } : undefined} onDeleteMovement={onDeleteMovement ? item => { setDialog(null); onDeleteMovement(item) } : undefined} onClose={() => setDialog(null)} onEdit={() => openDebt(selected)} onPayment={() => openPayment(undefined, selected)} onFunds={() => { setEditingEntry(undefined); setDialog('fund') }} />}
    <ConfirmDialog open={Boolean(deletingEntry)} title="Eliminar reserva de Plan" description="Se recalculará el dinero reservado. Si parte ya se utilizó en pagos y no queda saldo suficiente, FARO bloqueará el cambio para conservar tus saldos." confirmLabel="Eliminar reserva" onClose={() => setDeletingEntry(undefined)} onConfirm={async () => { const entry = deletingEntry; if (!entry || busy) return; setDeletingEntry(undefined); await run(async () => { await financeDebtRepository.reviseEntry({ id: entry.id, remove: true }, userId); await saved('Reserva de Plan eliminada.') }) }} />
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar deuda" description="Sólo se elimina si no tiene pagos ni recurrentes vinculados. Si conserva historial, puedes archivarla desde Editar." onClose={() => setDeleting(undefined)} onConfirm={async () => { const debt = deleting; setDeleting(undefined); if (debt) await run(async () => { await financeDebtRepository.remove(debt.id, userId); await saved('Deuda eliminada.') }) }} />
  </section>
}

function Summary({ icon, label, value, detail }: { icon?: ReactNode; label: string; value: string; detail?: string }) {
  return <div className="dp-summary">{icon}<span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
}

function TimelineRow({ debt, periods, scale, events, onPayment }: { debt: FinanceDebt; periods: Date[]; scale: 'month' | 'week'; events: DebtPlanEvent[]; onPayment: (event: DebtPlanEvent) => void }) {
  return <div className="dp-timeline-row" role="row"><div className="dp-lane-label" role="rowheader"><DebtIcon debt={debt} /><div><strong>{debt.name}</strong><small>{debtScheduleLabel(debt)}</small>{debt.deadline && events.some(event => plannedPayoff(debt, event)) && <small className="dp-green">Liquidar el {labelDate(debt.deadline, 'd MMM')}</small>}</div></div>{periods.map(period => {
    const start = format(period, 'yyyy-MM-dd'); const end = format(scale === 'month' ? endOfMonth(period) : addDays(period, 6), 'yyyy-MM-dd')
    const items = events.filter(event => event.date >= start && event.date <= end)
    const closedBefore = events.find(event => event.closes && event.date < start)
    return <div className="dp-lane-cell" role="cell" aria-label={`${debt.name} · ${labelDate(start, scale === 'month' ? 'MMMM yyyy' : 'd MMM yyyy')}`} key={`${debt.id}:${start}`}>{items.map(event => {
      const payoff = plannedPayoff(debt, event)
      return <button key={event.id} className={`dp-event dp-event--${event.kind}${debt.frequency === 'monthly' ? ' dp-event--monthly' : ''}${event.closes ? ' is-closing' : ''}`} onClick={() => onPayment(event)} title={`${labelDate(event.date)} · ${formatMxn(event.amountCents)}${payoff ? ' · Liquidación prevista' : event.closes ? ' · Último pago previsto' : ''}`} aria-label={`Ver proyección ${debt.name} ${labelDate(event.date)} ${formatMxn(event.amountCents)}`}>
        {event.closes ? <Flag size={11} /> : event.kind === 'extra' ? <Plus size={11} /> : <CalendarDays size={11} />}<b>{formatMxn(event.amountCents).replace('.00', '')}</b><small className="dp-event-date">{labelDate(event.date, 'd MMM')}</small>{payoff && <small className="dp-event-intent">Liquidación prevista</small>}<small>Quedan {formatMxn(event.remainingCents).replace('.00', '')}</small>
      </button>
    })}{scale === 'month' && !items.length && <span className={`dp-month-empty${closedBefore ? ' dp-green' : ''}`}>{closedBefore ? <>Sin pagos<br />Liquidada en el plan</> : 'Sin pago previsto'}</span>}</div>
  })}</div>
}

function DebtForecastDialog({ debt, event, data, reference, monthlyContributionCents, onClose, onRegister }: {
  debt: FinanceDebt; event: DebtPlanEvent; data: FinanceData; reference: Date; monthlyContributionCents?: number; onClose: () => void; onRegister: () => void
}) {
  const [extra, setExtra] = useState('')
  const [settles, setSettles] = useState(false)
  const base = useMemo(() => projectDebtPlan(data, { reference, monthlyContributionCents }), [data, reference, monthlyContributionCents])
  const value = cents(extra)
  const valid = Number.isSafeInteger(value) && value > 0
  const simulated = useMemo(() => valid ? projectDebtPlan(data, { reference, monthlyContributionCents,
    oneTimePayment: { debtId: debt.id, date: event.date, amountCents: value, settles } }) : base,
  [valid, data, reference, monthlyContributionCents, debt.id, event.date, value, settles, base])
  const prior = base.events.slice(0, base.events.findIndex(item => item.id === event.id)).filter(item => item.debtId === debt.id).at(-1)
  const before = prior?.remainingCents ?? debtRemainingCents(debt, data)
  const day = simulated.days.find(item => item.date === event.date)
  const afterSimulation = simulated.events.filter(item => item.debtId === debt.id && item.date <= event.date).at(-1)?.remainingCents ?? before
  return <Modal open title={`Proyección · ${debt.name} · ${labelDate(event.date)}`} panelClassName="dp-modal" onClose={onClose}>
    <div className="dp-form">{plannedPayoff(debt, event) && <div className="dp-forecast-payoff"><strong>Liquidar el {labelDate(event.date, "d 'de' MMMM yyyy")}</strong><p>El abono habitual es {formatMxn(debt.paymentCents)} cada día {parseISO(debt.nextPaymentDate).getDate()}. En esta fecha se sustituye por la liquidación prevista de {formatMxn(event.amountCents)}; no se suman ambos pagos.</p>{!validSettlementQuote(debt, data, event.date) && <p>Este importe cubre el saldo a plazo. Actualiza la cotización del acreedor para usar el monto real de liquidación.</p>}</div>}<p className="dp-hint">Estimación al {labelDate(event.date)} según los pagos anteriores del calendario. Simular no registra movimientos.</p>
      <div className="dp-payment-result"><span>Saldo antes de este pago<strong>{formatMxn(before)}</strong></span><span>Pago previsto<strong>{formatMxn(event.amountCents)}</strong></span><span>Saldo después de este pago<strong>{formatMxn(event.remainingCents)}</strong></span></div>
      {debt.kind === 'loan' && event.remainingCents <= 1500000 && event.remainingCents > 0 && <p className="dp-green">En esta fecha ya estarías en el rango de $15,000 o menos para evaluar liquidar la moto.</p>}
      <fieldset><legend>Simular en esta fecha, después del pago habitual</legend><MoneyField label={settles ? 'Monto hipotético para liquidar MXN' : 'Abono extra MXN'} required={false} min="0" value={extra} onChange={setExtra} /><label className="dp-check"><input type="checkbox" checked={settles} onChange={change => setSettles(change.target.checked)} />Simular que este monto liquida la deuda</label><p className="dp-hint">El monto de liquidación es hipotético; confírmalo con el acreedor cuando llegue la fecha. El saldo proyectado no agrega intereses futuros sin conocerlos.</p></fieldset>
      {valid && <><div className="dp-payment-result"><span>Saldo al terminar ese día<strong>{formatMxn(afterSimulation)}</strong></span><span>Liquidación estimada<strong>{labelDate(simulated.payoffDates[debt.id])}</strong></span><span>Disponible al terminar ese día<strong>{formatMxn(day?.balanceCents ?? 0)}</strong></span></div><p className="dp-hint">Sin este abono: liquidación estimada el {labelDate(base.payoffDates[debt.id])}.</p>{simulated.minimumCashCents < data.liquidityPreference.minimumOperatingBufferCents && <p className="dp-amber">La simulación cruza tu colchón protegido el {labelDate(simulated.minimumDate)}.</p>}</>}
      <div className="dp-form-actions"><Button variant="ghost" onClick={onClose}>Cerrar</Button><Button onClick={onRegister}>Registrar un pago real</Button></div>
    </div>
  </Modal>
}

function DebtEditor({ initial, busy, error, onClose, onSave, onDelete }: { initial?: FinanceDebt; busy: boolean; error: string; onClose: () => void; onSave: (debt: Omit<FinanceDebt, 'createdAt' | 'updatedAt'>) => Promise<void>; onDelete: (debt: FinanceDebt) => void }) {
  const [kind, setKind] = useState(initial?.kind ?? 'purchase')
  const [name, setName] = useState(initial?.name ?? '')
  const [creditor, setCreditor] = useState(initial?.creditor ?? '')
  const [balance, setBalance] = useState(moneyInput(initial?.balanceCents))
  const [balanceDate, setBalanceDate] = useState(initial?.balanceDate ?? dateKey())
  const [payment, setPayment] = useState(moneyInput(initial?.paymentCents))
  const [frequency, setFrequency] = useState(initial?.frequency ?? 'monthly')
  const [next, setNext] = useState(initial?.nextPaymentDate ?? dateKey())
  const [deadline, setDeadline] = useState(initial?.deadline ?? '')
  const [settlement, setSettlement] = useState(moneyInput(initial?.settlementCents))
  const [quoteDate, setQuoteDate] = useState(initial?.quoteDate ?? dateKey())
  const [validUntil, setValidUntil] = useState(initial?.quoteValidUntil ?? '')
  const [agreement, setAgreement] = useState(moneyInput(initial?.agreementCents))
  const [agreementDate, setAgreementDate] = useState(initial?.agreementDate ?? dateKey())
  const [count, setCount] = useState(String(initial?.agreementPayments ?? 3))
  const [agreementStatus, setAgreementStatus] = useState(initial?.agreementStatus ?? 'none')
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [priority, setPriority] = useState(String(initial?.priority ?? 0))
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [validation, setValidation] = useState('')
  const id = useRef(initial?.id ?? crypto.randomUUID())
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setValidation('')
    if (!name.trim() || !Number.isSafeInteger(cents(balance)) || cents(balance) <= 0 || !Number.isSafeInteger(cents(payment)) || cents(payment) <= 0) return setValidation('Completa nombre, saldo y pago habitual.')
    if (settlement && (cents(settlement) <= 0 || cents(settlement) > cents(balance))) return setValidation('La liquidación debe ser mayor que cero y no superar el saldo.')
    if (validUntil && validUntil < quoteDate) return setValidation('La vigencia debe ser posterior a la cotización.')
    if (agreementStatus !== 'none' && (cents(agreement) <= 0 || cents(agreement) > cents(balance) || Number(count) < 1)) return setValidation('Completa el monto total del convenio y el número de pagos.')
    await onSave({ id: id.current, name, creditor, kind, status, balanceCents: cents(balance), balanceDate, paymentCents: cents(payment), frequency,
      nextPaymentDate: next, deadline: deadline || undefined, settlementCents: settlement ? cents(settlement) : undefined,
      quoteDate: settlement ? quoteDate : undefined, quoteValidUntil: settlement && validUntil ? validUntil : undefined,
      agreementCents: agreementStatus !== 'none' ? cents(agreement) : undefined, agreementPayments: agreementStatus !== 'none' ? Number(count) : undefined,
      agreementStatus, agreementDate: agreementStatus === 'none' ? undefined : agreementDate, priority: Number(priority), notes: notes || undefined })
  }
  return <Modal open title={initial ? `Editar · ${initial.name}` : 'Añadir deuda'} panelClassName="dp-modal" onClose={onClose}><form className="dp-form" onSubmit={submit}>
    <label>Tipo de deuda<select value={kind} onChange={event => { const nextKind = event.target.value as typeof kind; setKind(nextKind); if (nextKind !== 'negotiable') setAgreementStatus('none') }}><option value="purchase">Compra con liquidación · Coppel</option><option value="loan">Crédito con pagos periódicos · Moto</option><option value="negotiable">Deuda con posible convenio · Plata</option></select></label>
    <div className="dp-form-grid"><label>Nombre / producto<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="Ej. Coppel · Refrigerador" /></label><label>Acreedor<input maxLength={100} value={creditor} onChange={event => setCreditor(event.target.value)} placeholder="Ej. Coppel" /></label></div>
    <div className="dp-form-grid"><MoneyField label="Saldo restante a plazo MXN" value={balance} onChange={setBalance} /><label>Saldo actualizado al<input type="date" required max={dateKey()} value={balanceDate} onChange={event => setBalanceDate(event.target.value)} onInput={event => setBalanceDate(event.currentTarget.value)} onBlur={event => setBalanceDate(event.currentTarget.value)} /></label></div>
    <p className="dp-hint">Este saldo ya incluye pagos anteriores. Sólo se descontarán los pagos vinculados desde esta fecha, inclusive.</p>
    <div className="dp-form-grid"><MoneyField label="Pago habitual MXN" value={payment} onChange={setPayment} /><label>Frecuencia<select value={frequency} onChange={event => setFrequency(event.target.value as typeof frequency)}>{Object.entries(financeFrequencyLabel).filter(([value]) => ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Próximo pago<input type="date" required value={next} onChange={event => setNext(event.target.value)} onInput={event => setNext(event.currentTarget.value)} onBlur={event => setNext(event.currentTarget.value)} /></label><label>Fecha límite · opcional<input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} onInput={event => setDeadline(event.currentTarget.value)} onBlur={event => setDeadline(event.currentTarget.value)} /></label></div>
    <fieldset><legend>Opción de liquidación</legend><MoneyField label="Monto para liquidar hoy MXN · opcional" value={settlement} onChange={setSettlement} required={false} />{settlement && <div className="dp-form-grid"><label>Fecha de cotización<input type="date" required max={dateKey()} value={quoteDate} onChange={event => setQuoteDate(event.target.value)} onInput={event => setQuoteDate(event.currentTarget.value)} onBlur={event => setQuoteDate(event.currentTarget.value)} /></label><label>Vigente hasta · opcional<input type="date" min={quoteDate} value={validUntil} onChange={event => setValidUntil(event.target.value)} onInput={event => setValidUntil(event.currentTarget.value)} onBlur={event => setValidUntil(event.currentTarget.value)} /></label></div>}<p className="dp-hint">Sin vigencia, sólo se considera válida el día de cotización. Un abono posterior requiere actualizarla.</p></fieldset>
    {kind === 'negotiable' && <fieldset><legend>Convenio</legend><label>Estado del convenio<select value={agreementStatus} onChange={event => setAgreementStatus(event.target.value as typeof agreementStatus)}><option value="none">Sin convenio</option><option value="proposed">Propuesto / por negociar</option><option value="confirmed">Confirmado con el acreedor</option></select></label>{agreementStatus !== 'none' && <><label>Inicio del convenio<input required type="date" value={agreementDate} onChange={event => setAgreementDate(event.target.value)} onInput={event => setAgreementDate(event.currentTarget.value)} onBlur={event => setAgreementDate(event.currentTarget.value)} /></label><div className="dp-form-grid"><MoneyField label="Total acordado MXN" value={agreement} onChange={setAgreement} /><label>Número de pagos<input type="number" min="1" max="120" required value={count} onChange={event => setCount(event.target.value)} /></label></div></>}<p className="dp-hint">Las parcialidades usan la frecuencia y próxima fecha de esta deuda. Un convenio propuesto no cambia el calendario comprometido.</p></fieldset>}
    <div className="dp-form-grid"><label>Estado<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="active">Activa</option><option value="paused">Pausada</option><option value="archived">Archivada</option></select></label><label>Orden de prioridad<input type="number" min="0" max="999" required value={priority} onChange={event => setPriority(event.target.value)} /></label></div><p className="dp-hint">Menor número = antes. Con la misma prioridad, Faro favorece el mayor ahorro confirmado y luego el saldo menor.</p>
    <label>Notas / condiciones<textarea maxLength={2000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
    {(error || validation) && <p className="dp-error" role="alert">{validation || error}</p>}
    <div className="dp-form-actions">{initial && <button type="button" className="dp-delete" onClick={() => onDelete(initial)}><Trash2 size={14} />Eliminar</button>}<Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Guardar deuda</Button></div>
  </form></Modal>
}

function MoneyField({ label, value, onChange, required = true, min = '.01' }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; min?: string }) {
  return <label>{label}<input type="number" min={min} step=".01" required={required} value={value} onChange={event => onChange(event.target.value)} /></label>
}

function PlanFundsDialog({ data, initial, busy, error, onClose, onSave }: { data: FinanceData; initial?: PlanEntry; busy: boolean; error: string; onClose: () => void; onSave: (input: { id: string; accountId: string; amountCents: number; date: string; notes?: string }) => Promise<void> }) {
  const accounts = data.accounts.filter(account => account.id === initial?.accountId || (account.isActive && account.currency === 'MXN' && !['credit', 'loan'].includes(account.type)))
  const [accountId, setAccountId] = useState(initial?.accountId ?? accounts[0]?.id ?? '')
  const [operation, setOperation] = useState(initial && initial.amountCents < 0 ? 'withdraw' : 'deposit')
  const [amount, setAmount] = useState(initial ? moneyInput(Math.abs(initial.amountCents)) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [date, setDate] = useState(initial?.entryDate ?? dateKey())
  const [validation, setValidation] = useState('')
  const id = useRef(initial?.id ?? crypto.randomUUID())
  const available = calculateFinanceMetrics(data, new Date()).availableBalanceCents
  const account = accounts.find(item => item.id === accountId)
  const accountAvailable = account ? accountBalance(account, data.transactions) - debtPlanBalanceCents(data, accountId)
    - data.transactions.filter(item => item.accountId === accountId && item.status === 'completed' && item.type === 'saving').reduce((sum, item) => sum + item.amountCents, 0) : 0
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setValidation('')
    const value = cents(amount)
    if (!accountId || !Number.isSafeInteger(value) || value <= 0) return setValidation('Selecciona una cuenta y un monto válido.')
    const signed = operation === 'deposit' ? value : -value
    const delta = signed - (initial?.amountCents ?? 0)
    if (delta > 0 && delta > Math.min(available, accountAvailable)) return setValidation('El monto supera el dinero operativo disponible en esta cuenta.')
    if (delta < 0 && -delta > debtPlanBalanceCents(data, accountId)) return setValidation('No puedes liberar más que el saldo reservado en esta cuenta.')
    await onSave({ id: id.current, accountId, amountCents: signed, date, notes })
  }
  return <Modal open title={initial ? 'Editar reserva de Plan' : 'Dinero destinado a Plan'} panelClassName="dp-modal" onClose={onClose}><form className="dp-form" onSubmit={submit}><p>El dinero permanece en la cuenta elegida. Al apartarlo disminuye tu disponible operativo; al pagar se registra un solo gasto.</p><label>Operación<select value={operation} onChange={event => setOperation(event.target.value)}><option value="deposit">Aportar / reservar</option><option value="withdraw">Liberar al disponible</option></select></label><label>Cuenta de origen<select required disabled={Boolean(initial)} value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">Selecciona</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name} · Plan {formatMxn(debtPlanBalanceCents(data, account.id))}</option>)}</select></label><label>Fecha de la reserva<input type="date" required max={dateKey()} value={date} onChange={event => setDate(event.target.value)} /></label><MoneyField label="Monto MXN" value={amount} onChange={setAmount} /><p className="dp-hint">Disponible para aportar: {formatMxn(Math.max(0, Math.min(available, accountAvailable)))} · Reservado aquí: {formatMxn(debtPlanBalanceCents(data, accountId))}</p><label>Descripción<input maxLength={160} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ej. Aportación de mi quincena" /></label>{(validation || error) && <p className="dp-error" role="alert">{validation || error}</p>}<div className="dp-form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>{initial ? 'Actualizar reserva' : operation === 'deposit' ? 'Aportar a Plan' : 'Liberar dinero'}</Button></div></form></Modal>
}

function PlanSettings({ data, busy, error, onClose, onSave }: { data: FinanceData; busy: boolean; error: string; onClose: () => void; onSave: (preferences: DebtPlanPreferences, buffer: number) => Promise<void> }) {
  const initial = data.debtPlan!.preferences
  const [monthly, setMonthly] = useState(moneyInput(initial.monthlyContributionCents))
  const [day, setDay] = useState(String(initial.contributionDay))
  const [target, setTarget] = useState(initial.targetDate)
  const [strategy, setStrategy] = useState(initial.strategy)
  const [buffer, setBuffer] = useState(moneyInput(data.liquidityPreference.minimumOperatingBufferCents))
  return <Modal open title="Configurar tu plan" panelClassName="dp-modal" onClose={onClose}><form className="dp-form" onSubmit={async event => { event.preventDefault(); await onSave({ monthlyContributionCents: cents(monthly), contributionDay: Number(day), targetDate: target, strategy }, cents(buffer)) }}><MoneyField label="Aportación mensual prevista MXN" min="0" value={monthly} onChange={setMonthly} /><label>Día previsto para aportar<input required type="number" min="1" max="28" value={day} onChange={event => setDay(event.target.value)} /></label><p className="dp-hint">Esta cifra simula futuras aportaciones. Registra el dinero real con “Aportar a Plan”.</p><div className="dp-form-grid"><label>Meta para quedar libre<input type="date" required value={target} onChange={event => setTarget(event.target.value)} onInput={event => setTarget(event.currentTarget.value)} onBlur={event => setTarget(event.currentTarget.value)} /></label><label>Estrategia<select value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)}>{Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><MoneyField label="Colchón operativo protegido MXN" value={buffer} min="0" onChange={setBuffer} /><p className="dp-hint">Es el mismo colchón que usa FARO Finanzas. El escenario Ataque total puede cruzarlo y siempre mostrará el riesgo.</p>{error && <p className="dp-error" role="alert">{error}</p>}<div className="dp-form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Guardar plan</Button></div></form></Modal>
}

function DebtPaymentDialog({ debt, data, event, busy, error, onClose, onSave }: { debt: FinanceDebt; data: FinanceData; event?: DebtPlanEvent; busy: boolean; error: string; onClose: () => void; onSave: (input: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>) => Promise<void> }) {
  const existing = data.transactions.find(transaction => transaction.id === event?.transactionId)
  const recurring = data.recurring.find(item => item.id === event?.recurringId)
  const accounts = data.accounts.filter(account => account.isActive && account.currency === 'MXN')
  const [amount, setAmount] = useState(moneyInput(existing?.amountCents ?? event?.amountCents ?? debt.paymentCents))
  const [date, setDate] = useState(event && event.date <= dateKey() ? event.date : dateKey())
  const [accountId, setAccountId] = useState(existing?.accountId ?? recurring?.accountId ?? accounts.find(account => debtPlanBalanceCents(data, account.id) > 0)?.id ?? accounts[0]?.id ?? '')
  const [fromPlan, setFromPlan] = useState(moneyInput(Math.min(event?.amountCents ?? debt.paymentCents, debtPlanBalanceCents(data, accountId))))
  const [principal, setPrincipal] = useState('')
  const [updatedBalance, setUpdatedBalance] = useState('')
  const [updatedQuote, setUpdatedQuote] = useState('')
  const [quoteUntil, setQuoteUntil] = useState('')
  const [settles, setSettles] = useState(event?.kind === 'settlement' || event?.closes === true)
  const [confirmed, setConfirmed] = useState(false)
  const [notes, setNotes] = useState('')
  const [validation, setValidation] = useState('')
  const id = useRef(existing?.id ?? event?.occurrenceId ?? crypto.randomUUID())
  const available = debtPlanBalanceCents(data, accountId)
  const balance = debtRemainingCents(debt, data)
  const submit = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault(); setValidation('')
    const value = cents(amount); const funded = cents(fromPlan || '0'); const reduction = principal ? cents(principal) : value
    if (!accountId || !Number.isSafeInteger(value) || value <= 0 || funded < 0 || funded > Math.min(value, available)) return setValidation('Revisa el monto y el saldo de Plan para la cuenta elegida.')
    const adjustment = updatedBalance && !settles ? cents(updatedBalance) - (balance - reduction) : 0
    if ((updatedBalance && (!Number.isSafeInteger(cents(updatedBalance)) || cents(updatedBalance) < 0)) || (updatedQuote && (!Number.isSafeInteger(cents(updatedQuote)) || cents(updatedQuote) <= 0))) return setValidation('Revisa las cifras actualizadas del acreedor.')
    if (!settles && (updatedBalance || updatedQuote) && debtPayments(debt, data).some(payment => payment.transactionDate > date)) return setValidation('Captura las cifras actualizadas en el pago más reciente de esta deuda.')
    if (quoteUntil && (!updatedQuote || quoteUntil < date)) return setValidation('La vigencia de la cotización debe ser igual o posterior al pago.')
    if (date < debt.balanceDate) return setValidation('La fecha debe ser igual o posterior a la fecha del saldo capturado.')
    if (reduction < 0 || reduction > value || (!settles && reduction > balance + adjustment)) return setValidation('El abono al saldo no puede superar el pago ni la deuda restante.')
    if (settles && !confirmed) return setValidation('Confirma que el acreedor reconoce la liquidación con este importe.')
    const categoryId = existing?.categoryId ?? recurring?.categoryId ?? data.categories.find(category => category.name === 'Plan' && category.type === 'expense')?.id
    if (!categoryId) return setValidation('No encontré la categoría Plan. Actualiza tus finanzas.')
    await onSave({ id: id.current, accountId, categoryId, type: existing?.type ?? recurring?.type ?? 'expense',
      description: existing?.description ?? recurring?.description ?? `${settles ? 'Liquidación' : 'Pago'} · ${debt.name}`, amountCents: value, transactionDate: date, status: 'completed',
      debtBalanceAdjustmentCents: settles ? 0 : adjustment,
      debtQuoteCents: !settles && updatedQuote ? cents(updatedQuote) : undefined,
      debtQuoteValidUntil: !settles && updatedQuote ? quoteUntil || undefined : undefined,
      debtId: debt.id, debtPrincipalCents: principal ? reduction : undefined, debtSettlement: settles, planAmountCents: funded,
      recurringTransactionId: event?.occurrenceId ? event.recurringId : existing?.recurringTransactionId, budgetId: existing?.budgetId,
      notes: notes || existing?.notes })
  }
  return <Modal open title={`Registrar pago · ${debt.name}`} panelClassName="dp-modal" onClose={onClose}><form className="dp-form" onSubmit={submit}><div className="dp-form-grid"><MoneyField label="Pago real MXN" value={amount} onChange={setAmount} /><label>Fecha real de pago<input required type="date" max={dateKey()} min={debt.balanceDate} value={date} onChange={change => setDate(change.target.value)} onInput={change => setDate(change.currentTarget.value)} onBlur={change => setDate(change.currentTarget.value)} /></label></div>{event && event.date > dateKey() && <p className="dp-hint">El pago estaba previsto para {labelDate(event.date)}. Se registrará como un adelanto en la fecha que elijas.</p>}<label>Cuenta del pago<select required value={accountId} onChange={change => { setAccountId(change.target.value); setFromPlan(moneyInput(Math.min(cents(amount), debtPlanBalanceCents(data, change.target.value)))) }}><option value="">Selecciona</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><MoneyField label="Usar de Plan MXN" value={fromPlan} min="0" onChange={setFromPlan} /><p className="dp-hint">Plan en esta cuenta: {formatMxn(available)} · Fuera de Plan: {formatMxn(Math.max(0, cents(amount) - cents(fromPlan || '0')))}</p><MoneyField label="Abono al saldo MXN · opcional" required={false} min="0" value={principal} onChange={setPrincipal} /><p className="dp-hint">Déjalo vacío si todo el pago reduce el saldo. Si incluye intereses no incluidos en tu saldo, indica sólo el abono a capital.</p>{!settles && <fieldset><legend>Cifras actualizadas del acreedor · opcional</legend><MoneyField label="Saldo a plazo después de este pago MXN" required={false} min="0" value={updatedBalance} onChange={setUpdatedBalance} /><p className="dp-hint">Copia el saldo que muestra Coppel después de pagar. La diferencia se registra como ajuste por intereses o corrección, sin crear otro gasto.</p><MoneyField label="Nuevo monto para liquidar MXN" required={false} value={updatedQuote} onChange={setUpdatedQuote} /><label>Cotización válida hasta<input type="date" min={date} value={quoteUntil} onChange={change => setQuoteUntil(change.target.value)} /></label><p className="dp-hint">Sin vigencia, la cotización sólo se considera válida el día del pago. Las cifras futuras son estimadas y no añaden intereses desconocidos.</p></fieldset>}<label className="dp-check"><input type="checkbox" checked={settles} onChange={change => setSettles(change.target.checked)} />Este pago liquida la deuda</label>{settles && <label className="dp-check"><input type="checkbox" checked={confirmed} onChange={change => setConfirmed(change.target.checked)} />Confirmé con el acreedor que este monto deja el saldo en cero.</label>}<div className="dp-payment-result"><span>Saldo actual<strong>{formatMxn(balance)}</strong></span><span>Después del pago<strong>{formatMxn(settles ? 0 : updatedBalance ? cents(updatedBalance) : Math.max(0, balance - cents(principal || amount)))}</strong></span></div><label>Notas<textarea rows={2} maxLength={1000} value={notes} onChange={change => setNotes(change.target.value)} /></label>{(validation || error) && <p className="dp-error" role="alert">{validation || error}</p>}<div className="dp-form-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button><Button type="submit" loading={busy}>Confirmar pago registrado</Button></div></form></Modal>
}

function DebtLinks({ debt, data, busy, error, onClose, onLink }: { debt: FinanceDebt; data: FinanceData; busy: boolean; error: string; onClose: () => void; onLink: (debtId: string | undefined, source: { recurringId?: string; transactionId?: string }) => Promise<void> }) {
  const [kind, setKind] = useState('recurring')
  const [sourceId, setSourceId] = useState('')
  const sources = kind === 'recurring' ? data.recurring.filter(item => ['expense', 'debt_payment'].includes(item.type) && (!item.debtId || item.debtId === debt.id))
    : data.transactions.filter(item => ['expense', 'debt_payment'].includes(item.type) && !item.recurringTransactionId && (!item.debtId || item.debtId === debt.id))
  const recurring = data.recurring.filter(item => item.debtId === debt.id)
  const eventual = data.transactions.filter(item => item.debtId === debt.id && !item.recurringTransactionId)
  return <Modal open title={`Vinculación · ${debt.name}`} panelClassName="dp-modal" onClose={onClose}><form className="dp-form" onSubmit={async event => { event.preventDefault(); if (sourceId) { await onLink(debt.id, kind === 'recurring' ? { recurringId: sourceId } : { transactionId: sourceId }); setSourceId('') } }}><p>Vincula los pagos que ya tienes en Gastos o Movimientos. Se conserva su cuenta, categoría y monto: el mismo pago también actualiza esta deuda.</p><p className="dp-hint">Los pagos anteriores a {labelDate(debt.balanceDate)} ya están incluidos en el saldo inicial. Los realizados desde esa fecha se descontarán al vincular.</p><label>Origen<select value={kind} onChange={event => { setKind(event.target.value); setSourceId('') }}><option value="recurring">Pago recurrente</option><option value="transaction">Movimiento eventual</option></select></label><label>Selecciona el pago<select required value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">Selecciona</option>{sources.map(source => <option key={source.id} value={source.id}>{source.description} · {formatMxn(source.amountCents)}{'transactionDate' in source ? ` · ${labelDate(source.transactionDate)}` : ''}</option>)}</select></label><Button type="submit" icon={<Link2 size={14} />} loading={busy} disabled={!sourceId}>Vincular a esta deuda</Button>{error && <p role="alert" className="dp-error">{error}</p>}<h3>Pagos vinculados</h3><div className="dp-linked-list">{recurring.map(item => <div key={item.id}><span><strong>{item.description}</strong><small>Recurrente · {financeFrequencyLabel[item.frequency]}</small></span><button type="button" disabled={busy} onClick={() => void onLink(undefined, { recurringId: item.id })}>Desvincular</button></div>)}{eventual.map(item => <div key={item.id}><span><strong>{item.description}</strong><small>{labelDate(item.transactionDate)} · {item.status === 'completed' ? 'Pagado' : 'Programado'}</small></span><button type="button" disabled={busy} onClick={() => void onLink(undefined, { transactionId: item.id })}>Desvincular</button></div>)}{!recurring.length && !eventual.length && <p className="dp-hint">Aún no hay vínculos.</p>}</div></form></Modal>
}

function DebtHistory({ debt, data, onClose, onEdit, onPayment, onFunds, onEditMovement, onDeleteMovement, onEditEntry, onDeleteEntry }: { debt?: FinanceDebt; data: FinanceData; onClose: () => void; onEdit: () => void; onPayment: () => void; onFunds: () => void; onEditMovement?: (item: FinanceTransaction) => void; onDeleteMovement?: (item: FinanceTransaction) => void; onEditEntry: (entry: PlanEntry) => void; onDeleteEntry: (entry: PlanEntry) => void }) {
  const payments = debt ? debtPayments(debt, data) : data.transactions.filter(item => item.status === 'completed' && (item.planAmountCents ?? 0) > 0)
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const closedWithAgreement = Boolean(debt && !debtRemainingCents(debt, data) && (payments.some(payment => payment.debtSettlement) || debt.agreementStatus === 'confirmed'))
  const entries = debt ? [] : data.debtPlan?.entries ?? []
  const rows = [...payments.map(payment => ({ id: payment.id, date: payment.transactionDate, amount: debt ? -payment.amountCents : -(payment.planAmountCents ?? 0), title: payment.description, accountId: payment.accountId, detail: payment.debtSettlement ? 'Liquidación confirmada' : `Abono al saldo: ${formatMxn(payment.debtPrincipalCents ?? payment.amountCents)}${payment.debtBalanceAdjustmentCents ? ` · Ajuste: ${formatMxn(payment.debtBalanceAdjustmentCents)}` : ''}${payment.debtQuoteCents != null ? ` · Cotización: ${formatMxn(payment.debtQuoteCents)}` : ''}` })), ...entries.map(entry => ({ id: entry.id, date: entry.entryDate, amount: entry.amountCents, title: entry.notes || (entry.amountCents > 0 ? 'Aportación a Plan' : 'Dinero liberado'), accountId: entry.accountId, detail: 'Reserva en cuenta' }))].sort((left, right) => right.date.localeCompare(left.date))
  return <Modal open title={debt ? `Detalle · ${debt.name}` : 'Aportaciones y uso de Plan'} panelClassName="dp-modal" onClose={onClose}><div className="dp-history"><Summary label={debt ? 'Saldo restante' : 'Disponible en Plan'} value={formatMxn(debt ? debtRemainingCents(debt, data) : debtPlanBalanceCents(data))} />{debt && <div className="dp-history-totals"><Summary label="Dinero pagado desde el saldo capturado" value={formatMxn(paidCents)} />{closedWithAgreement && <Summary label="Costo evitado al liquidar" value={formatMxn(Math.max(0, debt.balanceCents - paidCents))} />}</div>}<div className="dp-history-actions">{debt ? <><Button size="sm" onClick={onPayment}>Registrar pago</Button><Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={onEdit}>Editar deuda</Button></> : <Button size="sm" icon={<ArrowDownLeft size={14} />} onClick={onFunds}>Aportar o liberar</Button>}</div>{debt?.notes && <p className="dp-history-note">{debt.notes}</p>}{debt?.status === 'archived' && <p><Archive size={14} />Archivada</p>}<h3>Historial</h3>{rows.map(row => <article key={row.id}><div><strong>{row.title}</strong><small>{labelDate(row.date)} · {data.accounts.find(account => account.id === row.accountId)?.name}</small><small>{row.detail}</small></div><b className={row.amount > 0 ? 'dp-green' : ''}>{row.amount > 0 ? '+' : '−'}{formatMxn(Math.abs(row.amount))}</b>{payments.find(item => item.id === row.id) && <nav className="dp-history-record-actions">{onEditMovement && <Button size="sm" variant="ghost" onClick={() => onEditMovement(payments.find(item => item.id === row.id)!)}>Editar</Button>}{onDeleteMovement && <Button size="sm" variant="ghost" onClick={() => onDeleteMovement(payments.find(item => item.id === row.id)!)}>Eliminar</Button>}</nav>}{entries.find(entry => entry.id === row.id) && <nav className="dp-history-record-actions"><Button size="sm" variant="ghost" onClick={() => onEditEntry(entries.find(entry => entry.id === row.id)!)}>Editar</Button><Button size="sm" variant="ghost" onClick={() => onDeleteEntry(entries.find(entry => entry.id === row.id)!)}>Eliminar</Button></nav>}</article>)}{!rows.length && <p className="dp-hint">Sin pagos ni aportaciones registrados.</p>}<p className="dp-hint">Puedes corregir o deshacer pagos desde Movimientos y Gastos. El saldo de la deuda y Plan se recalcularán automáticamente.</p></div></Modal>
}
