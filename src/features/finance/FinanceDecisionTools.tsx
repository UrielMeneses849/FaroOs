import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarDays, ChartNoAxesCombined, History, Landmark, PiggyBank, ShieldCheck, WalletCards } from 'lucide-react'
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, ConfirmDialog } from '../../components/common'
import { buildFinanceDecisionReport, evaluateFinancePurchase, planFinanceSinkingFund } from '../../services/financeDecisionTools'
import { compareFinanceForecastSnapshot, type FinanceForecastJournalEntry } from '../../services/financeForecastJournal'
import { formatMxn } from '../../services/financeService'
import type { FinanceData } from './financeTypes'
import './finance-decision-tools.css'

export type FinanceDecisionPanel = 'audit' | 'scenarios' | 'affordability' | 'debtcompare' | 'provisions' | 'buffer'

interface FinanceDecisionToolsProps {
  panel: FinanceDecisionPanel
  data: FinanceData
  userId?: string
  reference?: Date
  journal?: { entries: FinanceForecastJournalEntry[]; message?: string }
}

type DecisionReport = ReturnType<typeof buildFinanceDecisionReport>
type ScenarioId = keyof DecisionReport['scenarios']
interface ProvisionInput { id: string; name: string; targetCents: number; alreadySavedCents: number; dueDate: string }
const provisionKey = (userId?: string) => `faro-finance-provisions:v1:${userId ?? 'local'}`
const dateLabel = (date: string, pattern = 'd MMM yyyy') => format(parseISO(date), pattern, { locale: es })
const moneyInputCents = (value: string) => Math.round(Number(value) * 100)
const isMoney = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000

const panelDetails: Record<FinanceDecisionPanel, { title: string; description: string; icon: typeof History }> = {
  audit: { title: '¿Por qué cambió mi proyección?', description: 'Consulta las lecturas guardadas y la evidencia disponible para compararlas con tus movimientos.', icon: History },
  scenarios: { title: 'Escenarios de liquidez', description: 'Compara tu flujo habitual con retrasos, aumentos de gasto y la falta de un ingreso.', icon: ChartNoAxesCombined },
  affordability: { title: 'Antes de comprar', description: 'Evalúa un gasto y encuentra una fecha que conserve tu colchón durante el horizonte consultado.', icon: WalletCards },
  debtcompare: { title: 'Comparar liquidaciones', description: 'Ordena tus deudas por saldo o por el efectivo que liberarían en los próximos 30 días.', icon: Landmark },
  provisions: { title: 'Apartados para próximos gastos', description: 'Calcula cuánto reunir por semana para gastos con fecha, como seguros, renovaciones o mantenimiento.', icon: PiggyBank },
  buffer: { title: 'Revisar mi colchón', description: 'Consulta cuánto cae tu flujo entre cobros y pagos y contrástalo con tu reserva configurada.', icon: ShieldCheck },
}

function readProvisions(userId?: string): ProvisionInput[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(provisionKey(userId)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ProvisionInput => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.name === 'string' && item.name.trim()
      && isMoney(item.targetCents) && item.targetCents > 0 && isMoney(item.alreadySavedCents)
      && typeof item.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
      && !Number.isNaN(parseISO(item.dueDate).getTime()))).slice(0, 100)
  } catch {
    return []
  }
}

function Metric({ label, amount, note, alert = false }: { label: string; amount: number; note?: string; alert?: boolean }) {
  return <article className={`finance-decisions__metric${alert ? ' is-warning' : ''}`}><span>{label}</span><strong>{formatMxn(amount)}</strong>{note && <small>{note}</small>}</article>
}

function Evidence({ items, title = 'Qué tener en cuenta' }: { items: string[]; title?: string }) {
  if (!items.length) return null
  return <details className="finance-decisions__evidence"><summary>{title}</summary><ul>{items.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></details>
}

function ScenarioSelector({ value, onChange, label }: { value: ScenarioId; onChange: (value: ScenarioId) => void; label: string }) {
  return <label className="finance-decisions__field">{label}<select value={value} onChange={event => onChange(event.target.value as ScenarioId)}><option value="base">Habitual</option><option value="conservative">Conservador</option><option value="stress">Estrés</option></select></label>
}

function ScenarioChart({ report }: { report: DecisionReport }) {
  const scenarios = Object.values(report.scenarios)
  const values = scenarios.flatMap(scenario => scenario.days.map(day => day.balanceCents))
  const min = Math.min(0, report.bufferCents, ...values)
  const max = Math.max(1, report.bufferCents, ...values)
  const y = (value: number) => 158 - (value - min) / Math.max(1, max - min) * 142
  return <div className="finance-decisions__chart">
    <svg viewBox="0 0 720 190" role="img" aria-label="Comparación de saldos diarios para los tres escenarios" preserveAspectRatio="none">
      <line x1="8" x2="712" y1={y(report.bufferCents)} y2={y(report.bufferCents)} className="finance-decisions__buffer-line" />
      {scenarios.map(scenario => <polyline key={scenario.id} className={`finance-decisions__curve is-${scenario.id}`} points={scenario.days.map((day, index) => `${8 + index / Math.max(1, scenario.days.length - 1) * 704},${y(day.balanceCents)}`).join(' ')} />)}
    </svg>
    <div className="finance-decisions__chart-dates"><span>{dateLabel(report.referenceDate)}</span><span>Colchón: {formatMxn(report.bufferCents)}</span><span>{dateLabel(report.horizonEnd)}</span></div>
    <p className="finance-decisions__note">Cada curva muestra el saldo operativo proyectado después de los compromisos y reservas incluidos. La línea punteada representa tu colchón.</p>
  </div>
}

function ForecastJournal({ report, data, journal }: { report: DecisionReport; data: FinanceData; journal?: FinanceDecisionToolsProps['journal'] }) {
  const [selectedId, setSelectedId] = useState('')
  const entries = useMemo(() => [...(journal?.entries ?? [])].sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)), [journal?.entries])
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0]
  const comparison = useMemo(() => selected ? compareFinanceForecastSnapshot(selected, report, data) : undefined, [data, report, selected])
  const closingComparison = comparison?.balanceComparisons.at(-1)
  return <article className="finance-decisions__card finance-decisions__journal">
    <header className="finance-decisions__debt-head"><div><History size={18} aria-hidden="true" /><h3>Bitácora semanal de proyecciones</h3></div><span className="finance-decisions__pill">{entries.length} {entries.length === 1 ? 'lectura guardada' : 'lecturas guardadas'}</span></header>
    <p className="finance-decisions__note">La primera lectura real de cada semana conserva el calendario y los supuestos de ese momento. Las simulaciones no entran en esta bitácora.</p>
    {journal?.message && <p className="finance-decisions__error" role="status">{journal.message}</p>}
    {!selected || !comparison ? <div className="finance-decisions__empty"><h3>Aún no hay lecturas semanales</h3><p>Las próximas visitas a Finanzas permitirán comparar las semanas conservadas en este dispositivo, por usuario.</p></div> : <>
      <ol className="finance-decisions__timeline" aria-label="Elegir lectura semanal">{entries.map(entry => <li key={entry.id}><button type="button" aria-pressed={entry.id === selected.id} onClick={() => setSelectedId(entry.id)}><span>{dateLabel(entry.referenceDate, 'd MMM yyyy')}</span><small>Hasta {dateLabel(entry.horizonEnd, 'd MMM')} · {entry.events.length} impactos</small></button></li>)}</ol>
      <div className="finance-decisions__journal-context"><p>Comparando la lectura del <strong>{dateLabel(selected.referenceDate)}</strong> con tu libro real al <strong>{dateLabel(report.referenceDate)}</strong>.</p><small>Colchón al guardar: {formatMxn(selected.bufferCents)} · actual: {formatMxn(report.bufferCents)}</small></div>
      <p className="finance-decisions__note">{comparison.explanation}</p>
      {closingComparison && <div className="finance-decisions__metrics"><Metric label={`Antes: saldo al ${dateLabel(closingComparison.date, 'd MMM')}`} amount={closingComparison.previousCents} note="Lectura semanal conservada" /><Metric label="Ahora: misma fecha" amount={closingComparison.currentCents} note="Previsión del libro actual" /><Metric label="Cambio en ese saldo" amount={closingComparison.differenceCents} note="Incluye el efecto de movimientos y reservas" /></div>}
      <div className="finance-decisions__journal-changes"><h3>Cambios en los impactos del calendario</h3>{!comparison.changes.length ? <p className="finance-decisions__note">{comparison.balanceComparisons.length ? 'No hay impactos nuevos, retirados o modificados en las fechas comparables.' : 'No hay impactos comparables con esta lectura. Revisa el periodo y la base de cálculo.'}</p> : <div className="finance-decisions__table-wrap"><table className="finance-decisions__table"><caption>Diferencias frente a la lectura semanal</caption><thead><tr><th>Concepto</th><th>Cambio observado</th><th>Antes</th><th>Ahora</th></tr></thead><tbody>{comparison.changes.slice(0, 40).map(change => <tr key={`${change.type}:${change.id}`}><td><strong>{change.label}</strong><small>{change.after?.originLabel ?? change.before?.originLabel}</small></td><td>{change.type === 'added' ? 'Agregado' : change.type === 'removed' ? 'Retirado de la previsión' : change.type === 'realized' ? 'Registrado como realizado' : change.before?.date !== change.after?.date && change.before?.amountCents !== change.after?.amountCents ? 'Fecha e importe' : change.before?.date !== change.after?.date ? 'Fecha' : change.before?.amountCents !== change.after?.amountCents ? 'Importe' : 'Detalle'}</td><td>{change.before ? <>{formatMxn(change.before.amountCents)}<small>{dateLabel(change.before.date)}</small></> : '—'}</td><td>{change.after ? <>{formatMxn(change.after.amountCents)}<small>{dateLabel(change.after.date)}</small></> : '—'}</td></tr>)}</tbody></table>{comparison.changes.length > 40 && <p className="finance-decisions__note finance-decisions__table-note">Se muestran los primeros 40 cambios.</p>}</div>}</div>
      {comparison.realizedComparisons.length > 0 && <details className="finance-decisions__schedule"><summary>Ver días transcurridos frente al libro reconstruido</summary><div className="finance-decisions__table-wrap"><table className="finance-decisions__table"><caption>Saldos previstos y reconstruidos de días transcurridos</caption><thead><tr><th>Fecha</th><th>Previsto al guardar</th><th>Libro reconstruido</th><th>Diferencia</th></tr></thead><tbody>{comparison.realizedComparisons.slice(-30).map(day => <tr key={day.date}><td>{dateLabel(day.date)}</td><td>{formatMxn(day.projectedCents)}</td><td>{formatMxn(day.reconstructedCents)}</td><td>{formatMxn(day.differenceCents)}</td></tr>)}</tbody></table></div><p className="finance-decisions__note">Se muestran hasta 30 días transcurridos. El libro reconstruido depende de las cuentas y registros actuales.</p></details>}
      {comparison.unverifiedPastEvents > 0 && <p className="finance-decisions__note">{comparison.unverifiedPastEvents} {comparison.unverifiedPastEvents === 1 ? 'impacto pasado sin realización vinculada' : 'impactos pasados sin realización vinculada'}: no se consideran pagos realizados automáticamente.</p>}
      <Evidence title="Supuestos conservados en esta lectura" items={selected.assumptions} />
    </>}
  </article>
}

function AuditPanel({ report, data, journal }: { report: DecisionReport; data: FinanceData; journal?: FinanceDecisionToolsProps['journal'] }) {
  const comparable = report.audit.entries.filter(entry => entry.differenceCents != null)
  return <>
    <ForecastJournal report={report} data={data} journal={journal} />
    <div className="finance-decisions__metrics"><article className="finance-decisions__metric"><span>Lecturas guardadas</span><strong>{report.audit.entries.length}</strong><small>Primer cálculo disponible por mes</small></article><article className="finance-decisions__metric"><span>Periodos reconstruidos</span><strong>{comparable.length}</strong><small>Libro actual; contexto original incompleto</small></article>{report.audit.meanAbsoluteRecurringErrorCents != null && <Metric label="Diferencia media en recurrencias" amount={report.audit.meanAbsoluteRecurringErrorCents} note={`${report.audit.recurringComparisons.length} pagos vinculados; diferencia absoluta`} />}</div>
    {report.audit.recurringComparisons.length > 0 && <div className="finance-decisions__table-wrap"><table className="finance-decisions__table"><caption>Pagos recurrentes: previsto y realizado</caption><thead><tr><th>Compromiso</th><th>Previsto</th><th>Realizado</th><th>Diferencia observada</th></tr></thead><tbody>{report.audit.recurringComparisons.slice(0, 30).map(item => <tr key={item.id}><td><strong>{item.label}</strong></td><td>{formatMxn(item.expectedCents)}<small>{dateLabel(item.expectedDate)}</small></td><td>{formatMxn(item.actualCents)}<small>{dateLabel(item.actualDate)}</small></td><td>{formatMxn(item.differenceCents)}<small>{item.delayDays === 0 ? 'En la fecha prevista' : `${Math.abs(item.delayDays)} ${Math.abs(item.delayDays) === 1 ? 'día' : 'días'} ${item.delayDays > 0 ? 'después' : 'antes'}`}</small></td></tr>)}</tbody></table>{report.audit.recurringComparisons.length > 30 && <p className="finance-decisions__note finance-decisions__table-note">Se muestran los 30 pagos vinculados más recientes.</p>}</div>}
    {!report.audit.entries.length ? <div className="finance-decisions__empty"><History size={24} /><h3>Aún no hay lecturas históricas</h3><p>Al consultar Proyecciones se guarda la primera lectura de cada mes. Esa evidencia permitirá revisar cómo cambia tu previsión con el tiempo.</p></div> : <div className="finance-decisions__table-wrap"><table className="finance-decisions__table"><caption>Historial de lecturas de proyección</caption><thead><tr><th>Periodo y lectura</th><th>Cierre previsto</th><th>Cierre reconstruido</th><th>Evidencia</th></tr></thead><tbody>{report.audit.entries.map(entry => <tr key={entry.id}><td><strong>{dateLabel(entry.month.slice(0, 7) + '-01', 'MMMM yyyy')}</strong><small>Guardada el {dateLabel(entry.snapshotDate)}</small></td><td>{formatMxn(entry.projectedClosingCents)}</td><td>{entry.actualClosingCents == null ? 'Aún no disponible' : formatMxn(entry.actualClosingCents)}{entry.differenceCents != null && <small>Diferencia: {formatMxn(entry.differenceCents)}</small>}</td><td><span className="finance-decisions__pill">{entry.status === 'open' ? 'Mes en curso' : entry.status === 'incompatible' ? 'Base no comparable' : 'Reconstruido'}</span><small>{entry.explanation}</small></td></tr>)}</tbody></table></div>}
    {report.scenarios.base.events.length > 0 && <details className="finance-decisions__evidence"><summary>De dónde salen los próximos impactos</summary><div className="finance-decisions__table-wrap"><table className="finance-decisions__table"><caption>Compromisos y estimaciones de este horizonte</caption><thead><tr><th>Fecha y concepto</th><th>Impacto</th><th>Origen</th></tr></thead><tbody>{report.scenarios.base.events.slice(0, 40).map(event => <tr key={`${event.id}:${event.date}`}><td>{event.label}<small>{dateLabel(event.date)}</small></td><td>{formatMxn(event.amountCents)}</td><td>{event.originLabel}<small>{event.evidence === 'actual' ? 'Realizado' : event.evidence === 'commitment' ? 'Compromiso registrado' : 'Estimación'}</small></td></tr>)}</tbody></table></div>{report.scenarios.base.events.length > 40 && <p>Se muestran los primeros 40 impactos del horizonte.</p>}</details>}
    <Evidence items={report.audit.evidenceGaps} title="Alcance de estas comparaciones" />
  </>
}

function ScenariosPanel({ report, delayDays, setDelayDays, increasePercent, setIncreasePercent, stressExpense, setStressExpense, missedIncomeId, setMissedIncomeId }: {
  report: DecisionReport; delayDays: number; setDelayDays: (value: number) => void; increasePercent: number; setIncreasePercent: (value: number) => void; stressExpense: string; setStressExpense: (value: string) => void; missedIncomeId: string; setMissedIncomeId: (value: string) => void
}) {
  const incomeEvents = report.scenarios.base.events.filter(event => event.kind === 'income' && event.evidence !== 'actual' && event.date >= report.referenceDate)
  return <>
    <div className="finance-decisions__controls">
      <label className="finance-decisions__field">Retraso de ingresos (días)<input type="number" min="0" max="60" step="1" value={delayDays} onChange={event => setDelayDays(Math.max(0, Math.min(60, Math.round(Number(event.target.value) || 0))))} /><small>Escenario conservador</small></label>
      <label className="finance-decisions__field">Aumento de gastos (%)<input type="number" min="0" max="100" step="1" value={increasePercent} onChange={event => setIncreasePercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} /><small>Gastos previstos, excepto deudas</small></label>
      <label className="finance-decisions__field">Ingreso que faltaría en estrés<select value={missedIncomeId} onChange={event => setMissedIncomeId(event.target.value)}><option value="">Próximo ingreso previsto</option>{incomeEvents.map(event => <option key={event.id} value={event.id}>{dateLabel(event.date, 'd MMM')} · {event.label} · {formatMxn(event.amountCents)}</option>)}</select><small>{incomeEvents.length ? 'Se excluye completo de ese escenario' : 'No hay ingresos futuros registrados'}</small></label>
      <label className="finance-decisions__field">Imprevisto en estrés (MXN)<input type="number" min="0" max="1000000000" step="0.01" value={stressExpense} onChange={event => setStressExpense(event.target.value)} /><small>Se aplica al inicio del horizonte</small></label>
    </div>
    <ScenarioChart report={report} />
    <div className="finance-decisions__scenario-grid">{Object.values(report.scenarios).map(scenario => <article key={scenario.id} className={`finance-decisions__scenario is-${scenario.id}`}><h3><i aria-hidden="true" />{scenario.label}</h3><span>Mínimo previsto</span><strong>{formatMxn(scenario.minimumBalanceCents)}</strong><small>{dateLabel(scenario.minimumDate)} · margen sobre colchón: {formatMxn(scenario.freeMarginCents)}</small><dl><div><dt>Cierre del horizonte</dt><dd>{formatMxn(scenario.closingBalanceCents)}</dd></div></dl><ul>{scenario.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></article>)}</div>
    <p className="finance-decisions__note">Estos supuestos se pueden ajustar. Son pruebas de resistencia; no representan probabilidades ni registran movimientos.</p>
  </>
}

function AffordabilityPanel({ report }: { report: DecisionReport }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(report.referenceDate)
  const [scenarioId, setScenarioId] = useState<ScenarioId>('conservative')
  const amountCents = moneyInputCents(amount)
  const valid = amount.trim() !== '' && isMoney(amountCents) && amountCents > 0 && date >= report.referenceDate && date <= report.horizonEnd
  const evaluation = useMemo(() => valid ? evaluateFinancePurchase(report, amountCents, date, scenarioId) : undefined, [amountCents, date, report, scenarioId, valid])
  const priorShortfall = evaluation?.safe && report.scenarios[scenarioId].days.some(day => day.date < date && day.balanceCents < report.bufferCents)
  return <>
    <div className="finance-decisions__metrics"><Metric label="Margen para gastar hoy" amount={Math.max(0, report.scenarios[scenarioId].freeMarginCents)} note={`${report.scenarios[scenarioId].label} · hasta ${dateLabel(report.horizonEnd)}`} /><Metric label="Colchón protegido" amount={report.bufferCents} note="Valor actual configurado" /></div>
    <div className="finance-decisions__split">
      <div className="finance-decisions__card"><h3>Prueba una compra</h3><div className="finance-decisions__form-grid"><label className="finance-decisions__field">Importe de la compra (MXN)<input type="number" min="0.01" max="1000000000" step="0.01" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></label><label className="finance-decisions__field">Fecha de compra<input type="date" min={report.referenceDate} max={report.horizonEnd} value={date} onChange={event => setDate(event.target.value)} /></label><ScenarioSelector label="Escenario de la compra" value={scenarioId} onChange={setScenarioId} /></div><p className="finance-decisions__note">El resultado se actualiza al cambiar el importe o la fecha. Este análisis no crea un gasto ni modifica tu saldo.</p></div>
      <div className="finance-decisions__card" aria-live="polite">{evaluation ? <>
        <span className={`finance-decisions__pill${evaluation.safe ? ' is-good' : ' is-warning'}`}>{evaluation.safe ? 'Cabe desde esa fecha' : 'Cruza el colchón'}</span>
        <h3>Mínimo del periodo con la compra</h3><div className="finance-decisions__result">{formatMxn(evaluation.minimumAfterCents)}</div>
        <p>{evaluation.safe ? `Desde el ${dateLabel(date)}, este gasto conserva el colchón bajo el escenario ${report.scenarios[scenarioId].label.toLowerCase()}.` : `El gasto supera el margen disponible para esa fecha por ${formatMxn(Math.max(0, amountCents - evaluation.capacityOnDateCents))}.`}</p>
        {priorShortfall && <p className="finance-decisions__note">Hay un faltante anterior a la compra que ya existe en este escenario. El mínimo del periodo lo incluye; esperar a comprar no resuelve ese faltante previo.</p>}
        {evaluation.bestSafeDate ? <div className="finance-decisions__recommendation"><CalendarDays size={18} /><span>Primera fecha compatible: <strong>{dateLabel(evaluation.bestSafeDate)}</strong></span>{evaluation.bestSafeDate !== date && <Button size="sm" variant="secondary" onClick={() => setDate(evaluation.bestSafeDate!)}>Probar esa fecha</Button>}</div> : <p className="finance-decisions__note">No se encontró una fecha que preserve el colchón dentro de este horizonte.</p>}
      </> : <div className="finance-decisions__empty"><WalletCards size={24} /><h3>Elige un importe y una fecha</h3><p>Se revisará el saldo de cada día posterior a tu compra para medir su impacto.</p></div>}</div>
    </div>
    <Evidence items={report.scenarios[scenarioId].assumptions} title="Supuestos del escenario elegido" />
  </>
}

function DebtComparePanel({ report }: { report: DecisionReport }) {
  const [order, setOrder] = useState<'balance' | 'release'>('release')
  const [budget, setBudget] = useState('')
  const budgetCents = moneyInputCents(budget)
  const hasBudget = budget !== '' && isMoney(budgetCents)
  const ids = order === 'balance' ? report.debts.smallestBalanceOrder : report.debts.cashReleaseOrder
  const candidates = ids.map(id => report.debts.candidates.find(candidate => candidate.id === id)).filter((candidate): candidate is DecisionReport['debts']['candidates'][number] => Boolean(candidate))
  return <>
    <div className="finance-decisions__controls"><label className="finance-decisions__field">Prioridad para comparar<select value={order} onChange={event => setOrder(event.target.value as 'balance' | 'release')}><option value="release">Mayor alivio de caja por peso</option><option value="balance">Saldo más pequeño primero</option></select></label><label className="finance-decisions__field">Disponible para liquidar (MXN)<input type="number" min="0" max="1000000000" step="0.01" placeholder="Sin límite para comparar" value={budget} onChange={event => setBudget(event.target.value)} /><small>Referencia de comparación; no reserva efectivo</small></label></div>
    {!candidates.length ? <div className="finance-decisions__empty"><Landmark size={24} /><h3>No hay deudas activas para comparar</h3><p>Las deudas y convenios registrados en Plan aparecerán aquí con sus saldos y pagos futuros.</p></div> : <div className="finance-decisions__debt-list">{candidates.map((candidate, index) => <article key={candidate.id} className="finance-decisions__card"><header className="finance-decisions__debt-head"><div><span className="finance-decisions__rank">{index + 1}</span><h3>{candidate.name}</h3></div><span className={`finance-decisions__pill${candidate.canSettleWithoutCrossingBuffer ? ' is-good' : ' is-warning'}`}>{candidate.canSettleWithoutCrossingBuffer ? 'Conserva colchón' : 'Revisar liquidez'}</span></header><div className="finance-decisions__metrics"><Metric label={candidate.settlementSource === 'valid_quote' ? 'Cotización vigente' : 'Saldo de referencia'} amount={candidate.settlementCents} note={candidate.quoteValidUntil ? `Vence ${dateLabel(candidate.quoteValidUntil)}` : 'Confirma el monto con el acreedor'} /><Metric label="Pagos liberados en 30 días" amount={candidate.cashReleasedNext30DaysCents} note={`${formatMxn(Math.round(candidate.cashReleasePerPeso * 100))} liberados por cada $1 usado`} /><Metric label="Mínimo tras liquidar hoy" amount={candidate.estimatedMinimumAfterCents} alert={!candidate.canSettleWithoutCrossingBuffer} note="Escenario habitual; saldo estimado" /></div><p className="finance-decisions__note">{hasBudget ? candidate.settlementCents <= budgetCents ? 'El importe cabe en el monto que indicaste.' : `Supera el monto indicado por ${formatMxn(candidate.settlementCents - budgetCents)}.` : `Saldo pendiente registrado: ${formatMxn(candidate.remainingCents)}.`}{candidate.knownSavingsCents != null ? ` Descuento conocido: ${formatMxn(candidate.knownSavingsCents)}.` : ''}</p></article>)}</div>}
    <Evidence items={report.debts.evidenceGaps} title="Costos, cotizaciones y límites del comparador" />
  </>
}

function ProvisionsPanel({ report, userId }: { report: DecisionReport; userId?: string }) {
  const formRef = useRef<HTMLFormElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const [provisions, setProvisions] = useState<ProvisionInput[]>(() => readProvisions(userId))
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [saved, setSaved] = useState('0')
  const [dueDate, setDueDate] = useState(report.horizonEnd)
  const [editingId, setEditingId] = useState<string>()
  const [removingId, setRemovingId] = useState<string>()
  const [error, setError] = useState('')
  const plans = useMemo(() => provisions.map(provision => ({ provision, plan: provision.dueDate < report.referenceDate ? undefined : planFinanceSinkingFund(report, provision) })), [provisions, report])

  function saveList(next: ProvisionInput[]) {
    try {
      window.localStorage.setItem(provisionKey(userId), JSON.stringify(next))
      setProvisions(next)
      setError('')
      return true
    } catch {
      setError('No se pudo guardar el apartado en este dispositivo. Libera almacenamiento e intenta otra vez.')
      return false
    }
  }

  function resetForm() {
    setEditingId(undefined)
    setName('')
    setTarget('')
    setSaved('0')
    setDueDate(report.horizonEnd)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const targetCents = moneyInputCents(target)
    const alreadySavedCents = moneyInputCents(saved)
    if (!name.trim() || !isMoney(targetCents) || targetCents <= 0 || !isMoney(alreadySavedCents)
      || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parseISO(dueDate).getTime()) || dueDate < report.referenceDate) {
      setError('Escribe un nombre, un importe mayor a cero, un ahorro válido y una fecha de hoy en adelante.')
      return
    }
    const provision = { id: editingId ?? crypto.randomUUID(), name: name.trim().slice(0, 80), targetCents, alreadySavedCents, dueDate }
    const next = editingId ? provisions.map(item => item.id === editingId ? provision : item) : [...provisions, provision]
    if (saveList(next)) resetForm()
  }

  function editProvision(provision: ProvisionInput) {
    setEditingId(provision.id)
    setName(provision.name)
    setTarget(String(provision.targetCents / 100))
    setSaved(String(provision.alreadySavedCents / 100))
    setDueDate(provision.dueDate)
    setError('')
    nameInputRef.current?.focus({ preventScroll: true })
    if (window.matchMedia?.('(max-width: 760px)').matches) formRef.current?.scrollIntoView?.({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start',
    })
  }

  return <>
    <div className="finance-decisions__split"><form ref={formRef} className="finance-decisions__card" onSubmit={submit}><h3>{editingId ? 'Editar apartado' : 'Planear un apartado'}</h3><div className="finance-decisions__form-grid"><label className="finance-decisions__field finance-decisions__field--wide">Nombre del gasto<input ref={nameInputRef} required maxLength={80} placeholder="Ej. mantenimiento de la moto" value={name} onChange={event => setName(event.target.value)} /></label><label className="finance-decisions__field">Costo previsto (MXN)<input required type="number" min="0.01" max="1000000000" step="0.01" value={target} onChange={event => setTarget(event.target.value)} /></label><label className="finance-decisions__field">Ya reunido (MXN)<input required type="number" min="0" max="1000000000" step="0.01" value={saved} onChange={event => setSaved(event.target.value)} /></label><label className="finance-decisions__field">Fecha del gasto<input required type="date" min={report.referenceDate} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label></div>{error && <p className="finance-decisions__error" role="alert">{error}</p>}<div className="finance-decisions__actions"><Button type="submit" size="sm">{editingId ? 'Guardar cambios' : 'Guardar apartado'}</Button>{editingId && <Button type="button" size="sm" variant="ghost" onClick={resetForm}>Cancelar edición</Button>}</div></form><div className="finance-decisions__card"><PiggyBank size={24} /><h3>Un plan semanal con fecha</h3><p>Se divide lo que falta reunir entre las semanas disponibles y se prueba contra el escenario conservador.</p><p className="finance-decisions__note">Se guarda por usuario en este dispositivo. Indicar dinero ya reunido es informativo: el análisis no lo vuelve a descontar ni mueve efectivo entre cuentas.</p><p className="finance-decisions__note">Cada apartado se evalúa por separado. Para revisar varios gastos juntos, usa el modo simulación.</p></div></div>
    {!plans.length ? <div className="finance-decisions__empty"><h3>Todavía no tienes apartados planeados</h3><p>Agrega el costo, lo que ya reuniste y la fecha de tu próximo gasto.</p></div> : <div className="finance-decisions__provision-grid">{plans.map(({ provision, plan }) => <article className="finance-decisions__card" key={provision.id}>
      <header className="finance-decisions__debt-head"><h3>{provision.name}</h3><span className={`finance-decisions__pill${plan && (plan.remainingCents === 0 || plan.fitsBuffer && plan.withinHorizon) ? ' is-good' : ' is-warning'}`}>{!plan ? 'Revisar fecha' : plan.remainingCents === 0 ? 'Meta cubierta' : !plan.withinHorizon ? 'Fuera del horizonte' : plan.fitsBuffer ? 'Cabe por separado' : 'Revisar liquidez'}</span></header>
      {plan ? <><div className="finance-decisions__result">{formatMxn(plan.weeklyCents)}<small> por semana</small></div><p>Faltan {formatMxn(plan.remainingCents)} · {plan.weeksRemaining} {plan.weeksRemaining === 1 ? 'semana' : 'semanas'} · vence {dateLabel(provision.dueDate)}</p></> : <p>La fecha planeada fue el {dateLabel(provision.dueDate)}. Actualízala para volver a calcular las aportaciones; este apartado no implica un adeudo vencido.</p>}
      <dl className="finance-decisions__definition-list"><div><dt>Costo previsto</dt><dd>{formatMxn(provision.targetCents)}</dd></div><div><dt>Ya reunido</dt><dd>{formatMxn(provision.alreadySavedCents)}</dd></div>{plan?.withinHorizon && <div><dt>Mínimo al apartar</dt><dd>{formatMxn(plan.minimumAfterCents)}</dd></div>}</dl>
      {plan && !plan.withinHorizon && <p className="finance-decisions__note">La aportación semanal puede calcularse, pero el saldo sólo se verifica hasta {dateLabel(report.horizonEnd)}.</p>}
      {plan && plan.schedule.length > 0 && <details className="finance-decisions__schedule"><summary>Ver calendario de aportaciones</summary><ol>{plan.schedule.map((item, index) => <li key={`${item.date}:${index}`}><span>{dateLabel(item.date)}</span><strong>{formatMxn(item.amountCents)}</strong></li>)}</ol></details>}
      <div className="finance-decisions__actions"><Button size="sm" variant="ghost" aria-label={`Editar ${provision.name}`} onClick={() => editProvision(provision)}>Editar</Button><Button size="sm" variant="ghost" aria-label={`Eliminar ${provision.name}`} onClick={() => setRemovingId(provision.id)}>Eliminar</Button></div>
    </article>)}</div>}
    <ConfirmDialog open={Boolean(removingId)} title="Eliminar apartado" description="Se eliminará este plan semanal guardado en el dispositivo. Tus movimientos y saldos conservarán su estado actual." confirmLabel="Eliminar apartado" onClose={() => setRemovingId(undefined)} onConfirm={() => { if (saveList(provisions.filter(item => item.id !== removingId))) { if (editingId === removingId) resetForm(); setRemovingId(undefined) } }} />
  </>
}

function BufferPanel({ report }: { report: DecisionReport }) {
  return <>
    <div className="finance-decisions__metrics"><Metric label="Colchón configurado" amount={report.buffer.configuredCents} note="Referencia actual de tus proyecciones" />{report.buffer.suggestedCents != null && <Metric label="Referencia según historial" amount={report.buffer.suggestedCents} note={`${report.buffer.historyMonths} meses observados`} />}{report.buffer.maximumObservedDrawdownCents != null && <Metric label="Mayor caída observada" amount={report.buffer.maximumObservedDrawdownCents} note="Desde un máximo previo de flujo registrado" />}</div>
    <div className="finance-decisions__split"><article className="finance-decisions__card"><ShieldCheck size={24} /><h3>{report.buffer.suggestedCents == null ? 'Falta historial para una referencia' : 'Una reserva relacionada con tu flujo'}</h3><p>{report.buffer.explanation}</p><p className="finance-decisions__note">Esta referencia depende de los movimientos registrados y no estima la probabilidad de una emergencia. Puedes revisar tu colchón desde Proyecciones.</p></article><article className="finance-decisions__card"><h3>Separa dos necesidades</h3><dl className="finance-decisions__definition-list"><div><dt>Colchón operativo</dt><dd>Cubre desfases entre ingresos y pagos.</dd></div><div><dt>Fondo para emergencias</dt><dd>Protege gastos esenciales frente a eventos que no aparecen en el calendario.</dd></div></dl><p className="finance-decisions__note">Consultar esta herramienta no cambia tu colchón configurado ni aparta dinero automáticamente.</p></article></div>
  </>
}

function DecisionToolsContent({ panel, data, userId, reference, journal }: FinanceDecisionToolsProps) {
  const [mountedReference] = useState(() => new Date())
  const referenceDate = reference ?? mountedReference
  const [delayDays, setDelayDays] = useState(7)
  const [increasePercent, setIncreasePercent] = useState(10)
  const [stressExpense, setStressExpense] = useState('0')
  const [missedIncomeId, setMissedIncomeId] = useState('')
  const stressExpenseCents = moneyInputCents(stressExpense)
  const report = useMemo(() => buildFinanceDecisionReport(data, {
    reference: referenceDate,
    horizonDays: 90,
    conservativeDelayDays: delayDays,
    conservativeExpensePercent: increasePercent,
    stressMissedIncomeId: missedIncomeId || undefined,
    stressExpenseCents: isMoney(stressExpenseCents) ? stressExpenseCents : 0,
  }), [data, delayDays, increasePercent, missedIncomeId, referenceDate, stressExpenseCents])
  const details = panelDetails[panel]
  const Icon = details.icon
  let content: ReactNode
  if (panel === 'audit') content = <AuditPanel report={report} data={data} journal={journal} />
  else if (panel === 'scenarios') content = <ScenariosPanel report={report} delayDays={delayDays} setDelayDays={setDelayDays} increasePercent={increasePercent} setIncreasePercent={setIncreasePercent} stressExpense={stressExpense} setStressExpense={setStressExpense} missedIncomeId={missedIncomeId} setMissedIncomeId={setMissedIncomeId} />
  else if (panel === 'affordability') content = <AffordabilityPanel report={report} />
  else if (panel === 'debtcompare') content = <DebtComparePanel report={report} />
  else if (panel === 'provisions') content = <ProvisionsPanel report={report} userId={userId} />
  else content = <BufferPanel report={report} />
  return <section className="finance-decisions" aria-label={details.title}>
    <header className="finance-decisions__header"><div className="finance-decisions__heading"><span className="finance-decisions__icon"><Icon size={22} aria-hidden="true" /></span><div><span className="eyebrow">Herramientas para decidir</span><h2>{details.title}</h2><p>{details.description}</p></div></div><span className="finance-decisions__period"><CalendarDays size={15} aria-hidden="true" />{dateLabel(report.referenceDate, 'd MMM')} – {dateLabel(report.horizonEnd, 'd MMM yyyy')}<small>{report.horizonDays} días</small></span></header>
    {content}
    {panel !== 'audit' && <Evidence items={report.evidenceGaps} title="Base del análisis" />}
  </section>
}

export function FinanceDecisionTools(props: FinanceDecisionToolsProps) {
  // A user change remounts local form and storage state before any further edits.
  return <DecisionToolsContent key={props.userId ?? 'local'} {...props} />
}
