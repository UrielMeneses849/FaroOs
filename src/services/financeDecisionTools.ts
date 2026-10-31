import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, isValid, parseISO, startOfDay, startOfMonth } from 'date-fns'
import type { FinanceData, FinanceFrequency, FinanceTransaction } from '../features/finance/financeTypes'
import { debtRemainingCents } from './debtSchedule'
import { debtWithLatestQuote, validSettlementQuote } from './debtPlanService'
import { FINANCE_LIQUIDITY_PROJECTION_VERSION, financeLiquidityProjection, type LiquidityProjectionDay, type LiquidityProjectionEvent } from './financeLiquidityProjection'
import { calculateFinanceMetrics, canonicalFinanceBudgetGroups, formatMxn } from './financeService'

export type FinanceDecisionScenarioId = 'base' | 'conservative' | 'stress'
export interface FinanceDecisionEvent extends LiquidityProjectionEvent {
  evidence: 'actual' | 'commitment' | 'estimate'
  originLabel: string
}
export interface FinanceDecisionScenario {
  id: FinanceDecisionScenarioId
  label: string
  days: LiquidityProjectionDay[]
  events: FinanceDecisionEvent[]
  minimumBalanceCents: number
  minimumDate: string
  closingBalanceCents: number
  freeMarginCents: number
  assumptions: string[]
}
export interface FinanceDecisionOptions {
  reference?: Date
  horizonDays?: number
  conservativeDelayDays?: number
  conservativeExpensePercent?: number
  stressMissedIncomeId?: string
  stressExpenseCents?: number
}
export interface FinanceDecisionAuditEntry {
  id: string
  month: string
  snapshotDate: string
  projectedClosingCents: number
  actualClosingCents?: number
  differenceCents?: number
  status: 'reconstructed' | 'incompatible' | 'open'
  explanation: string
}
export interface FinanceRecurringComparison {
  id: string
  label: string
  expectedDate: string
  actualDate: string
  expectedCents: number
  actualCents: number
  differenceCents: number
  delayDays: number
}
export interface FinanceDecisionDebtCandidate {
  id: string
  name: string
  remainingCents: number
  paymentCents: number
  frequency: FinanceFrequency
  monthlyPaymentCents: number
  settlementCents: number
  settlementSource: 'valid_quote' | 'remaining_balance'
  quoteValidUntil?: string
  knownSavingsCents?: number
  cashReleasedNext30DaysCents: number
  cashReleasePerPeso: number
  estimatedMinimumAfterCents: number
  canSettleWithoutCrossingBuffer: boolean
}
export interface FinanceDecisionReport {
  referenceDate: string
  horizonEnd: string
  horizonDays: number
  availableTodayCents: number
  bufferCents: number
  scenarios: Record<FinanceDecisionScenarioId, FinanceDecisionScenario>
  spending: { capacityTodayCents: number }
  audit: {
    entries: FinanceDecisionAuditEntry[]
    recurringComparisons: FinanceRecurringComparison[]
    meanAbsoluteErrorCents?: number
    meanAbsoluteRecurringErrorCents?: number
    observedIncomeDelayDays?: number
    evidenceGaps: string[]
  }
  debts: {
    candidates: FinanceDecisionDebtCandidate[]
    smallestBalanceOrder: string[]
    cashReleaseOrder: string[]
    highestCostAvailable: false
    evidenceGaps: string[]
  }
  buffer: {
    suggestedCents?: number
    configuredCents: number
    historyMonths: number
    maximumObservedDrawdownCents?: number
    explanation: string
  }
  evidenceGaps: string[]
}
export interface FinanceSinkingFundInput { name: string; targetCents: number; alreadySavedCents: number; dueDate: string }

const key = (date: Date) => format(date, 'yyyy-MM-dd')
function dateValue(value: string, field: string) {
  const date = parseISO(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !isValid(date) || key(date) !== value) throw new Error(`${field}: fecha inválida.`)
  return date
}
function cents(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field}: usa centavos enteros no negativos.`)
  return value
}
function boundedInteger(value: number, field: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${field}: valor inválido.`)
  return Math.min(value, max)
}
function transactionForEvent(data: FinanceData, event: LiquidityProjectionEvent) {
  return event.source === 'movement' ? data.transactions.find(item => `movement:${item.id}` === event.id) : undefined
}
function debtIdForEvent(data: FinanceData, event: LiquidityProjectionEvent) {
  if (event.source === 'debt') return data.debtPlan?.debts.find(debt => event.id.startsWith(`debt:${debt.id}:`))?.id
  if (event.source === 'movement') return transactionForEvent(data, event)?.debtId
  if (event.source === 'recurring') {
    const occurrence = data.recurringOccurrences.find(item => `recurring:${item.id}` === event.id)
    return data.recurring.find(item => item.id === occurrence?.recurringTransactionId)?.debtId
  }
  return undefined
}
function isInflatableExpense(data: FinanceData, event: LiquidityProjectionEvent) {
  if (debtIdForEvent(data, event)) return false
  if (event.source === 'movement') return transactionForEvent(data, event)?.type === 'expense'
  if (event.source === 'recurring') {
    const occurrence = data.recurringOccurrences.find(item => `recurring:${item.id}` === event.id)
    return data.recurring.find(item => item.id === occurrence?.recurringTransactionId)?.type === 'expense'
  }
  return event.source === 'budget' || event.source === 'simulation'
}
function withEvidence(data: FinanceData, event: LiquidityProjectionEvent): FinanceDecisionEvent {
  const transaction = transactionForEvent(data, event)
  const savedSimulation = transaction?.id.startsWith('simulation:')
  const actual = !savedSimulation && transaction?.status === 'completed'
  const evidence = actual ? 'actual' : savedSimulation || event.source === 'debt' || event.source === 'budget' || event.source === 'simulation' ? 'estimate' : 'commitment'
  const origins = { movement: actual ? 'Movimiento realizado' : 'Movimiento pendiente', recurring: 'Ocurrencia recurrente', budget: 'Reserva de presupuesto', debt: 'Calendario estimado de Plan', simulation: 'Simulación' }
  return { ...event, evidence, originLabel: savedSimulation ? 'Simulación guardada' : origins[event.source] }
}
function summarizeScenario(id: FinanceDecisionScenarioId, label: string, days: LiquidityProjectionDay[], events: FinanceDecisionEvent[], bufferCents: number, assumptions: string[]): FinanceDecisionScenario {
  const minimum = days.reduce((lowest, day) => day.balanceCents < lowest.balanceCents ? day : lowest, days[0])
  return { id, label, days, events, minimumBalanceCents: minimum.balanceCents, minimumDate: minimum.date, closingBalanceCents: days.at(-1)!.balanceCents, freeMarginCents: minimum.balanceCents - bufferCents, assumptions }
}
/** Apply only differences from the official cash curve: completed entries are already in today's balance. */
function scenarioFromEvents(base: FinanceDecisionScenario, transformed: FinanceDecisionEvent[], id: FinanceDecisionScenarioId, label: string, bufferCents: number, assumptions: string[]) {
  const deltas = new Map<string, number>()
  const add = (date: string, value: number) => deltas.set(date, (deltas.get(date) ?? 0) + value)
  for (const event of base.events) if (event.evidence !== 'actual') add(event.date, -event.amountCents)
  for (const event of transformed) if (event.evidence !== 'actual') add(event.date, event.amountCents)
  const byDate = new Map<string, FinanceDecisionEvent[]>()
  for (const event of transformed) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event])
  let cumulative = 0
  const days = base.days.map(day => {
    cumulative += deltas.get(day.date) ?? 0
    const events = byDate.get(day.date) ?? []
    return { ...day, balanceCents: day.balanceCents + cumulative, events, incomeCents: events.reduce((sum, event) => sum + Math.max(0, event.amountCents), 0), expenseCents: events.reduce((sum, event) => sum + Math.max(0, -event.amountCents), 0) }
  })
  return summarizeScenario(id, label, days, transformed.filter(event => event.date <= days.at(-1)!.date), bufferCents, assumptions)
}

function buildAudit(data: FinanceData, reference: Date, availableTodayCents: number): FinanceDecisionReport['audit'] {
  const referenceDate = key(reference)
  const entries = data.liquiditySnapshots.map((snapshot): FinanceDecisionAuditEntry => {
    const common = { id: snapshot.id, month: snapshot.month, snapshotDate: snapshot.snapshotDate, projectedClosingCents: snapshot.initialProjectedClosingBalanceCents }
    const period = dateValue(snapshot.month, 'Mes de fotografía')
    const periodEnd = key(endOfMonth(period))
    if (snapshot.projectionVersion !== FINANCE_LIQUIDITY_PROJECTION_VERSION) return { ...common, status: 'incompatible', explanation: 'La fórmula de esta fotografía es de otra versión; no se mezcla con la proyección actual.' }
    if (periodEnd >= referenceDate) return { ...common, status: 'open', explanation: 'El mes aún no termina. Su cierre realizado todavía no es comparable.' }
    if (snapshot.snapshotDate.slice(0, 10) > periodEnd) return { ...common, status: 'incompatible', explanation: 'La fotografía se tomó después del cierre; no es un pronóstico previo.' }
    const past = financeLiquidityProjection({ data, month: period, currentAvailableBalanceCents: availableTodayCents, minimumOperatingBufferCents: 0, referenceDate: reference })
    return { ...common, actualClosingCents: past.closingBalanceCents, differenceCents: past.closingBalanceCents - snapshot.initialProjectedClosingBalanceCents, status: 'reconstructed', explanation: 'Comparación con el libro actual reconstruido. La fotografía no guardó cuentas, reservas ni compromisos originales; no permite atribuir causas ni medir precisión certificada.' }
  }).sort((a, b) => b.month.localeCompare(a.month))
  const recurringComparisons: FinanceRecurringComparison[] = []
  const incomeDelays: number[] = []
  for (const occurrence of data.recurringOccurrences) {
    const transaction = data.transactions.find(item => item.id === occurrence.transactionId && item.status === 'completed' && item.transactionDate <= referenceDate)
    const recurring = data.recurring.find(item => item.id === occurrence.recurringTransactionId)
    if (!transaction || !recurring || occurrence.amountCents == null || occurrence.expectedDate > referenceDate) continue
    const delayDays = differenceInCalendarDays(dateValue(transaction.transactionDate, 'Fecha realizada'), dateValue(occurrence.expectedDate, 'Fecha esperada'))
    recurringComparisons.push({ id: occurrence.id, label: occurrence.description || recurring.description, expectedDate: occurrence.expectedDate, actualDate: transaction.transactionDate, expectedCents: occurrence.amountCents, actualCents: transaction.amountCents, differenceCents: transaction.amountCents - occurrence.amountCents, delayDays })
    if (recurring.type === 'income') incomeDelays.push(Math.max(0, delayDays))
  }
  return {
    entries, recurringComparisons: recurringComparisons.sort((a, b) => b.expectedDate.localeCompare(a.expectedDate)),
    meanAbsoluteRecurringErrorCents: recurringComparisons.length ? Math.round(recurringComparisons.reduce((sum, item) => sum + Math.abs(item.differenceCents), 0) / recurringComparisons.length) : undefined,
    observedIncomeDelayDays: incomeDelays.length ? Math.max(...incomeDelays) : undefined,
    evidenceGaps: ['Las fotografías existentes guardan el cierre agregado, pero no los supuestos ni cada compromiso: su diferencia no identifica por sí sola gasto extra o retrasos.', ...(recurringComparisons.length ? [] : ['Aún no hay recurrencias con pago realizado vinculado para contrastar importe y fecha.'])],
  }
}

function operationalImpact(transaction: FinanceTransaction, activeIds: Set<string>) {
  const source = activeIds.has(transaction.accountId)
  if (transaction.type === 'transfer') {
    const destination = Boolean(transaction.destinationAccountId && activeIds.has(transaction.destinationAccountId))
    return source === destination ? 0 : source ? -transaction.amountCents : transaction.amountCents
  }
  return source ? (transaction.type === 'income' || transaction.type === 'refund' ? transaction.amountCents : -transaction.amountCents) : 0
}
function buildBuffer(data: FinanceData, reference: Date, configuredCents: number): FinanceDecisionReport['buffer'] {
  const activeIds = new Set(data.accounts.filter(account => account.isActive).map(account => account.id))
  const draws: number[] = []
  for (let index = 6; index >= 1; index--) {
    const start = key(addMonths(startOfMonth(reference), -index))
    const end = key(endOfMonth(parseISO(start)))
    const ledger = data.transactions.filter(item => item.status === 'completed' && item.transactionDate >= start && item.transactionDate <= end && operationalImpact(item, activeIds) !== 0)
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
    if (!ledger.length) continue
    const daily = new Map<string, number>()
    for (const item of ledger) daily.set(item.transactionDate, (daily.get(item.transactionDate) ?? 0) + operationalImpact(item, activeIds))
    let running = 0, peak = 0, draw = 0
    for (const impact of daily.values()) { running += impact; peak = Math.max(peak, running); draw = Math.max(draw, peak - running) }
    draws.push(draw)
  }
  const maximumObservedDrawdownCents = draws.length ? Math.max(...draws) : undefined
  return {
    configuredCents, historyMonths: draws.length, maximumObservedDrawdownCents,
    suggestedCents: draws.length >= 3 ? maximumObservedDrawdownCents : undefined,
    explanation: draws.length >= 3
      ? 'Referencia operativa: mayor caída acumulada entre saldos diarios de los últimos seis meses cerrados con movimientos. Depende de que tu historial esté completo; no sustituye un fondo de emergencia ni cambia tu colchón.'
      : 'Faltan al menos tres meses cerrados con movimientos realizados. El colchón configurado se conserva; no se inventa una reserva histórica.',
  }
}

/** Deterministic decision support. It never writes records, learns invented rates, or assigns probabilities. */
export function buildFinanceDecisionReport(data: FinanceData, options: FinanceDecisionOptions = {}): FinanceDecisionReport {
  const reference = startOfDay(options.reference ?? new Date())
  if (!isValid(reference)) throw new Error('Fecha de referencia inválida.')
  const horizonDays = boundedInteger(options.horizonDays ?? 90, 'Horizonte', 1, 366)
  const delay = boundedInteger(options.conservativeDelayDays ?? 7, 'Retraso', 0, 366)
  const expensePercent = options.conservativeExpensePercent ?? 10
  if (!Number.isFinite(expensePercent) || expensePercent < 0 || expensePercent > 1000) throw new Error('Incremento de gasto inválido.')
  const extra = cents(options.stressExpenseCents ?? 0, 'Gasto extraordinario')
  const referenceDate = key(reference), horizonEnd = key(addDays(reference, horizonDays - 1))
  const bufferCents = cents(data.liquidityPreference.minimumOperatingBufferCents, 'Colchón')
  const availableTodayCents = calculateFinanceMetrics(data, reference, reference).availableBalanceCents
  const categoryIds = [...new Set(canonicalFinanceBudgetGroups(data).filter(group => !group.isPersonal).map(group => group.budget.categoryId))]
  const days: LiquidityProjectionDay[] = []
  for (let month = startOfMonth(reference); key(month) <= horizonEnd; month = addMonths(month, 1)) {
    const projection = financeLiquidityProjection({ data, month, currentAvailableBalanceCents: availableTodayCents, minimumOperatingBufferCents: bufferCents, referenceDate: reference, includePersonalBudgetReservations: true, includedBudgetCategoryIds: categoryIds, carryIncludePersonalBudgetReservations: true, carryIncludedBudgetCategoryIds: categoryIds })
    days.push(...projection.days.filter(day => day.date >= referenceDate && day.date <= horizonEnd))
  }
  const events = days.flatMap(day => day.events.map(event => withEvidence(data, event)))
  const base = summarizeScenario('base', 'Habitual', days, events, bufferCents, ['Mismo motor y fechas que Proyecciones; incluye el remanente de todos los presupuestos registrados.', 'Sólo se conocen los ingresos, gastos y recurrencias que están registrados. No se repiten presupuestos de meses que aún no existen.'])
  const conservativeEvents = events.map(event => {
    if (event.evidence === 'actual') return { ...event }
    if (event.amountCents > 0) return { ...event, date: key(addDays(parseISO(event.date), delay)), originalDate: event.originalDate ?? event.date }
    if (isInflatableExpense(data, event)) return { ...event, amountCents: -Math.round(Math.abs(event.amountCents) * (1 + expensePercent / 100)) }
    return { ...event }
  })
  const conservative = scenarioFromEvents(base, conservativeEvents, 'conservative', 'Conservador', bufferCents, [`Retrasa ${delay} días cada ingreso pendiente; los realizados conservan su fecha.`, `Aumenta ${expensePercent}% gastos pendientes y reservas; las cuotas de deuda se conservan.`, 'Son supuestos editables, no probabilidades ni aumentos inferidos de tu historial. Los cobros retrasados fuera del horizonte no financian este periodo.'])
  const futureIncome = events.filter(event => event.evidence !== 'actual' && event.amountCents > 0)
  const missedIncome = options.stressMissedIncomeId ? futureIncome.find(event => event.id === options.stressMissedIncomeId) : futureIncome[0]
  const stressEvents = conservativeEvents.filter(event => event.id !== missedIncome?.id)
  if (extra) stressEvents.push(withEvidence(data, { id: 'decision:unexpected-expense', date: referenceDate, amountCents: -extra, kind: 'expense', source: 'simulation', label: 'Gasto extraordinario del escenario' }))
  const stress = scenarioFromEvents(base, stressEvents, 'stress', 'Estrés', bufferCents, [...conservative.assumptions, missedIncome ? `Excluye del horizonte un cobro: ${missedIncome.label} (${missedIncome.date}).` : 'Sin cobro pendiente seleccionado para excluir.', extra ? `Agrega ${formatMxn(extra)} de gasto extraordinario en la fecha de referencia.` : 'Sin gasto extraordinario adicional.'])
  const next30End = key(addDays(reference, 29))
  const monthlyFactors: Record<FinanceFrequency, number> = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }
  const candidates = (data.debtPlan?.debts ?? []).filter(debt => debt.status === 'active' && debtRemainingCents(debt, data) > 0).map((original): FinanceDecisionDebtCandidate => {
    const debt = debtWithLatestQuote(original, data)
    const remainingCents = debtRemainingCents(debt, data)
    const quote = validSettlementQuote(debt, data, referenceDate)
    const settlementCents = quote ? debt.settlementCents! : remainingCents
    const payments = base.events.filter(event => event.evidence !== 'actual' && event.amountCents < 0 && debtIdForEvent(data, event) === debt.id)
    const cashReleasedNext30DaysCents = payments.filter(event => event.date <= next30End).reduce((sum, event) => sum - event.amountCents, 0)
    let released = 0
    const estimatedMinimumAfterCents = Math.min(...base.days.map(day => {
      released += payments.filter(event => event.date === day.date).reduce((sum, event) => sum - event.amountCents, 0)
      return day.balanceCents - settlementCents + released
    }))
    return { id: debt.id, name: debt.name, remainingCents, paymentCents: debt.paymentCents, frequency: debt.frequency, monthlyPaymentCents: Math.round(debt.paymentCents * monthlyFactors[debt.frequency]), settlementCents, settlementSource: quote ? 'valid_quote' : 'remaining_balance', quoteValidUntil: quote ? debt.quoteValidUntil ?? debt.quoteDate : undefined, knownSavingsCents: quote ? Math.max(0, remainingCents - settlementCents) : undefined, cashReleasedNext30DaysCents, cashReleasePerPeso: settlementCents ? cashReleasedNext30DaysCents / settlementCents : 0, estimatedMinimumAfterCents, canSettleWithoutCrossingBuffer: estimatedMinimumAfterCents >= bufferCents }
  })
  return {
    referenceDate, horizonEnd, horizonDays, availableTodayCents, bufferCents,
    scenarios: { base, conservative, stress }, spending: { capacityTodayCents: Math.max(0, conservative.freeMarginCents) },
    audit: buildAudit(data, reference, availableTodayCents),
    debts: { candidates, smallestBalanceOrder: [...candidates].sort((a, b) => a.remainingCents - b.remainingCents).map(item => item.id), cashReleaseOrder: [...candidates].sort((a, b) => b.cashReleasePerPeso - a.cashReleasePerPeso).map(item => item.id), highestCostAvailable: false, evidenceGaps: ['No hay tasas, comisiones ni amortizaciones contractuales completas: no se clasifica una avalancha por costo.', 'Sin cotización vigente, el saldo registrado es una referencia y debes confirmar el monto de liquidación. El descuento conocido sólo existe con cotización vigente.', 'El efecto de liquidar usa efectivo operativo y elimina pagos futuros identificados; no libera dinero de Plan automáticamente.'] },
    buffer: buildBuffer(data, reference, bufferCents),
    evidenceGaps: [...(!data.accounts.some(account => account.isActive) ? ['No hay cuentas activas; registra una para obtener un flujo útil.'] : []), ...(data.debtPlanError ? ['Plan no está disponible: faltan sus compromisos en este análisis.'] : []), 'Una plantilla recurrente sin ocurrencia con monto y fecha no entra en la curva. Completa las ocurrencias y presupuestos futuros: si faltan, el límite de gasto puede estar sobreestimado.', 'Cada escenario es una prueba de supuestos con el libro actual; no promete resultados ni contempla compromisos no registrados.'],
  }
}

export function evaluateFinancePurchase(report: FinanceDecisionReport, amountCents: number, date = report.referenceDate, scenarioId: FinanceDecisionScenarioId = 'conservative') {
  cents(amountCents, 'Compra')
  dateValue(date, 'Fecha de compra')
  if (date < report.referenceDate || date > report.horizonEnd) throw new Error('La fecha de compra debe estar dentro del horizonte.')
  const scenario = report.scenarios[scenarioId]
  const suffixMinimum = new Array<number>(scenario.days.length)
  for (let index = scenario.days.length - 1; index >= 0; index--) suffixMinimum[index] = Math.min(scenario.days[index].balanceCents, suffixMinimum[index + 1] ?? Infinity)
  const index = scenario.days.findIndex(day => day.date === date)
  const capacityOnDateCents = Math.max(0, suffixMinimum[index] - report.bufferCents)
  const minimumAfterCents = Math.min(...scenario.days.map(day => day.balanceCents - (day.date >= date ? amountCents : 0)))
  // A purchase must fit every subsequent day; a prior shortfall is still disclosed in minimumAfterCents.
  const safe = suffixMinimum[index] - amountCents >= report.bufferCents
  const bestSafeDate = scenario.days.find((day, candidate) => day.date >= date && suffixMinimum[candidate] - amountCents >= report.bufferCents)?.date
  return { amountCents, date, minimumAfterCents, safe, bestSafeDate, capacityOnDateCents }
}

export function planFinanceSinkingFund(report: FinanceDecisionReport, input: FinanceSinkingFundInput, scenarioId: FinanceDecisionScenarioId = 'conservative') {
  cents(input.targetCents, 'Meta'); cents(input.alreadySavedCents, 'Ahorro existente')
  const due = dateValue(input.dueDate, 'Fecha objetivo')
  if (input.dueDate < report.referenceDate) throw new Error('La fecha objetivo ya pasó.')
  if (!input.name.trim()) throw new Error('Escribe un nombre para el apartado.')
  const remainingCents = Math.max(0, input.targetCents - input.alreadySavedCents)
  const weeksRemaining = Math.ceil((differenceInCalendarDays(due, parseISO(report.referenceDate)) + 1) / 7)
  const weeklyCents = Math.ceil(remainingCents / weeksRemaining)
  const withinHorizon = input.dueDate <= report.horizonEnd
  const schedule: { date: string; amountCents: number }[] = []
  let remaining = remainingCents
  for (let index = 0; index < weeksRemaining && remaining > 0; index++) {
    const date = key(addDays(parseISO(report.referenceDate), index * 7))
    if (date > report.horizonEnd) break
    const amountCents = Math.min(weeklyCents, remaining)
    schedule.push({ date, amountCents }); remaining -= amountCents
  }
  let reserved = 0
  const minimumAfterCents = Math.min(...report.scenarios[scenarioId].days.map(day => {
    reserved += schedule.filter(item => item.date === day.date).reduce((sum, item) => sum + item.amountCents, 0)
    return day.balanceCents - reserved
  }))
  return { name: input.name.trim(), remainingCents, weeksRemaining, weeklyCents, schedule, minimumAfterCents, fitsBuffer: withinHorizon && minimumAfterCents >= report.bufferCents, dueDate: input.dueDate, withinHorizon }
}
