import { addDays, addMonths, endOfMonth, format, isAfter, isSameMonth, startOfDay, startOfMonth, subMonths } from 'date-fns'
import type { FinanceData, FinanceTransaction, FinanceTransactionType } from '../features/finance/financeTypes'
import { categoryBudgetReservations, monthKey, personalBudgetBalanceIntoPeriod, personalBudgetReservations, recurringAppliesToMonth } from './financeService'

/** Keeping the thresholds here makes the Radar auditable and keeps UI out of business rules. */
export const LIQUIDITY_MODERATION_MULTIPLIER = 1.2
/** Bump when a formula change makes stored comparison baselines incompatible. */
export const FINANCE_LIQUIDITY_PROJECTION_VERSION = 5

export type FinanceLiquidityRadarStatus = 'stable' | 'moderation' | 'critical'
export type LiquidityEventSource = 'movement' | 'recurring' | 'budget' | 'simulation'

export interface LiquidityProjectionEvent {
  id: string
  date: string
  originalDate?: string
  label: string
  amountCents: number
  kind: 'income' | 'expense'
  source: LiquidityEventSource
  isOverdue?: boolean
  budgetId?: string
  periodStart?: string
  periodEnd?: string
}

export interface LiquidityProjectionDay {
  date: string
  balanceCents: number
  incomeCents: number
  expenseCents: number
  events: LiquidityProjectionEvent[]
  isCurrent: boolean
}

export interface LiquiditySensitivePeriod {
  startDate: string
  endDate: string
}

export interface LiquiditySimulationInput {
  type: 'income' | 'expense'
  amountCents: number
  date: string
  description?: string
  categoryId?: string
}

/**
 * A what-if personal envelope. It replaces only the reservation for that
 * fortnight in memory, so the Radar can model Q2 without modifying Finance.
 */
export interface PersonalBudgetScenarioInput {
  periodStart: string
  periodEnd: string
  targetAmountCents: number
}

export interface FinanceLiquidityProjectionInput {
  data: FinanceData
  month: Date
  currentAvailableBalanceCents: number
  minimumOperatingBufferCents: number
  referenceDate?: Date
  simulation?: LiquiditySimulationInput
  personalBudgetScenario?: PersonalBudgetScenarioInput
  /**
   * A personal budget is an envelope, not a bank movement. The Radar defaults
   * to dated cash flow, but can optionally model the remaining envelope at the
   * start of each Q1/Q2 period for a conservative liquidity scenario.
   */
  includePersonalBudgetReservations?: boolean
  /** Non-personal budget categories whose uncommitted remainder is reserved. */
  includedBudgetCategoryIds?: string[]
  /**
   * Canonical reserve policy used only while carrying preceding months into a
   * future target. This keeps target-month switches and simulations from
   * rewriting the closing balances that feed the selected period.
   */
  carryIncludePersonalBudgetReservations?: boolean
  carryIncludedBudgetCategoryIds?: string[]
}

export interface FinanceLiquidityProjection {
  periodStart: string
  periodEnd: string
  periodMode: 'past' | 'current' | 'future'
  availableTodayCents: number
  openingBalanceCents: number
  openingBalanceSource: 'historical_actual' | 'current_actual' | 'prior_projected_close'
  openingBalanceSourcePeriod?: string
  minimumBalanceCents: number
  minimumDate: string
  closingBalanceCents: number
  freeMarginCents: number
  status: FinanceLiquidityRadarStatus
  days: LiquidityProjectionDay[]
  events: LiquidityProjectionEvent[]
  sensitivePeriods: LiquiditySensitivePeriod[]
  currentDate: string
  computeMs: number
}

const isLiquidityType = (type: FinanceTransactionType) =>
  type === 'income' || type === 'refund' || type === 'expense' || type === 'saving' || type === 'debt_payment' || type === 'transfer'

const isIncome = (type: FinanceTransactionType) => type === 'income' || type === 'refund'

const signedImpact = (type: FinanceTransactionType, amountCents: number) => isIncome(type) ? amountCents : -amountCents

const isCompletedLiquidityMovement = (item: FinanceTransaction) => item.status === 'completed' && isLiquidityType(item.type)

type AccountMovement = Pick<FinanceTransaction, 'type' | 'amountCents' | 'accountId' | 'destinationAccountId'>

/** Cash impact across the boundary of the currently active account set. */
function operationalImpactCents(item: AccountMovement, activeAccountIds: Set<string>) {
  const sourceIsActive = activeAccountIds.has(item.accountId)
  if (item.type === 'transfer') {
    const destinationIsActive = Boolean(item.destinationAccountId && activeAccountIds.has(item.destinationAccountId))
    if (sourceIsActive === destinationIsActive) return 0
    return sourceIsActive ? -item.amountCents : item.amountCents
  }
  return sourceIsActive ? signedImpact(item.type, item.amountCents) : 0
}

export function financeLiquidityStatus(minimumBalanceCents: number, minimumOperatingBufferCents: number): FinanceLiquidityRadarStatus {
  const buffer = Math.max(0, minimumOperatingBufferCents)
  if (minimumBalanceCents > buffer * LIQUIDITY_MODERATION_MULTIPLIER) return 'stable'
  if (minimumBalanceCents > buffer) return 'moderation'
  return 'critical'
}

export function financeLiquidityStatusCopy(status: FinanceLiquidityRadarStatus) {
  if (status === 'stable') return 'Tu liquidez se mantiene por encima del colchón.'
  if (status === 'moderation') return 'Te acercas a tu colchón mínimo durante este periodo.'
  return 'Tu saldo proyectado cruza el colchón mínimo.'
}

function liquidityImpactFromTransaction(item: FinanceTransaction, activeAccountIds: Set<string>): LiquidityProjectionEvent | undefined {
  const amountCents = operationalImpactCents(item, activeAccountIds)
  if (!amountCents) return undefined
  return {
    id: `movement:${item.id}`,
    date: item.transactionDate,
    label: item.description,
    amountCents,
    kind: amountCents >= 0 ? 'income' : 'expense',
    source: 'movement',
  }
}

function recurringEventsForMonth(data: FinanceData, month: Date): LiquidityProjectionEvent[] {
  const period = monthKey(month)
  const activeAccountIds = new Set(data.accounts.filter((account) => account.isActive).map((account) => account.id))
  const events: LiquidityProjectionEvent[] = []
  for (const recurring of data.recurring) {
    if (!recurring.isActive || !isLiquidityType(recurring.type) || !recurringAppliesToMonth(recurring, month)) continue
    const occurrences = data.recurringOccurrences.filter((candidate) =>
      candidate.recurringTransactionId === recurring.id && candidate.period === period)
    for (const occurrence of occurrences) {
      if (!occurrence.amountCents || occurrence.status === 'skipped') continue
      if (!occurrence.expectedDate.startsWith(format(month, 'yyyy-MM'))) continue

      // A materialized movement is the source of truth — including one still planned.
      const materialized = occurrence.transactionId && data.transactions.some((transaction) =>
        transaction.id === occurrence.transactionId && transaction.status !== 'cancelled')
      if (materialized) continue

      const amountCents = operationalImpactCents({ ...recurring, amountCents: occurrence.amountCents }, activeAccountIds)
      if (!amountCents) continue
      events.push({
        id: `recurring:${occurrence.id}`,
        date: occurrence.expectedDate,
        label: occurrence.description || recurring.description,
        amountCents,
        kind: amountCents >= 0 ? 'income' : 'expense',
        source: 'recurring',
      })
    }
  }
  return events
}

interface BudgetReservationEvent extends LiquidityProjectionEvent {
  sourceBudgetIds: string[]
  categoryId?: string
  isPersonal: boolean
}

function budgetReservationEventsForMonth(
  data: FinanceData,
  month: Date,
  reference: Date,
  includePersonal: boolean,
  categoryIds: string[],
): BudgetReservationEvent[] {
  // These are deliberately the *remaining* envelopes. Expenses with a real or
  // planned date stay as movements, so the category budget is never charged
  // twice in the liquidity curve.
  const reservations = [
    ...(includePersonal ? personalBudgetReservations(data, month, reference) : []),
    ...categoryBudgetReservations(data, month, categoryIds, reference),
  ]
  return reservations.map((budget) => ({
    id: budget.id,
    date: budget.date,
    label: budget.label,
    amountCents: -budget.amountCents,
    kind: 'expense' as const,
    source: 'budget' as const,
    budgetId: budget.budgetId,
    periodStart: budget.periodStart,
    periodEnd: budget.periodEnd,
    sourceBudgetIds: budget.sourceBudgetIds,
    categoryId: budget.categoryId,
    isPersonal: budget.isPersonal,
  }))
}

export function personalBudgetScenarioReservationCents(data: FinanceData, scenario: PersonalBudgetScenarioInput, reference = new Date()) {
  const previousBalanceCents = personalBudgetBalanceIntoPeriod(data, scenario.periodStart)
  const previousPeriodEnd = format(addDays(new Date(`${scenario.periodStart}T00:00:00`), -1), 'yyyy-MM-dd')
  const priorEnvelopeIsStillReserved = personalBudgetReservations(
    data,
    new Date(`${scenario.periodStart}T00:00:00`),
    reference,
  ).some((budget) => budget.periodEnd === previousPeriodEnd)
  // A positive Q1 balance is added only when it is not already represented by
  // a live reservation. A Q1 overrun never has a reservation of its own, so it
  // always discounts Q2. This keeps the two fortnights inside one monthly cap.
  const isSecondFortnight = scenario.periodStart.slice(-2) !== '01'
  const adjustmentCents = previousBalanceCents < 0
    ? isSecondFortnight ? previousBalanceCents : 0
    : priorEnvelopeIsStillReserved ? 0 : previousBalanceCents
  return Math.max(0, scenario.targetAmountCents + adjustmentCents)
}

function personalBudgetScenarioEvent(
  data: FinanceData,
  scenario: PersonalBudgetScenarioInput,
  sourceBudgetIds: string[],
  reference: Date,
): BudgetReservationEvent | undefined {
  // A scenario represents new money the user wants to reserve. Dated personal
  // movements remain visible as independent commitments in the cash curve.
  const envelopeCents = personalBudgetScenarioReservationCents(data, scenario, reference)
  if (!envelopeCents) return undefined
  return {
    id: `budget-scenario:${scenario.periodStart}`,
    date: scenario.periodStart,
    label: `Escenario · Gastos Personales (${scenario.periodStart.slice(-2) === '01' ? 'Q1' : 'Q2'})${personalBudgetBalanceIntoPeriod(data, scenario.periodStart) < 0 ? ' · exceso anterior descontado' : ''}`,
    amountCents: -envelopeCents,
    kind: 'expense',
    source: 'simulation',
    periodStart: scenario.periodStart,
    periodEnd: scenario.periodEnd,
    sourceBudgetIds,
    isPersonal: true,
  }
}

/**
 * A budget is not a bank movement. Keep the historical/current portion of the
 * chart equal to the real account balance and reserve only the portion that is
 * still ahead of the reference date. A future Q2 keeps its real release date;
 * Q1's remaining envelope begins tomorrow, after today's reconciled balance.
 */
function scheduleReservationAfterReference(
  reservation: BudgetReservationEvent,
  referenceKey: string,
  isCurrentPeriod: boolean,
): BudgetReservationEvent {
  if (!isCurrentPeriod || reservation.date > referenceKey) return reservation
  const nextDate = format(addDays(new Date(`${referenceKey}T12:00:00`), 1), 'yyyy-MM-dd')
  if (!reservation.periodEnd || nextDate > reservation.periodEnd) return reservation
  return {
    ...reservation,
    date: nextDate,
    label: reservation.label.replace(/^Reserva · /, 'Reserva pendiente · '),
  }
}

function openingBalanceFromHistory(data: FinanceData, periodStart: string) {
  const activeAccounts = data.accounts.filter((account) => account.isActive)
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id))
  const initialAccountsCents = activeAccounts
    .reduce((sum, account) => sum + account.initialBalanceCents, 0)
  const completedBeforePeriod = data.transactions
    .filter((transaction) => isCompletedLiquidityMovement(transaction) && transaction.transactionDate < periodStart)
    .reduce((sum, transaction) => sum + operationalImpactCents(transaction, activeAccountIds), 0)
  return initialAccountsCents + completedBeforePeriod
}

function sensitivePeriods(days: LiquidityProjectionDay[], thresholdCents: number) {
  const ranges: LiquiditySensitivePeriod[] = []
  let start: string | undefined
  let previous: string | undefined
  for (const day of days) {
    if (day.balanceCents <= thresholdCents) {
      start ??= day.date
      previous = day.date
      continue
    }
    if (start && previous) ranges.push({ startDate: start, endDate: previous })
    start = undefined
    previous = undefined
  }
  if (start && previous) ranges.push({ startDate: start, endDate: previous })
  return ranges
}

/**
 * Pure, deterministic daily liquidity projection. Past days use completed data;
 * current/future days use planned or pending commitments. Overdue commitments are
 * deliberately applied on the reference day rather than silently discarded.
 */
function projectFinanceLiquidityMonth(
  input: FinanceLiquidityProjectionInput,
  carriedOpeningBalanceCents?: number,
): FinanceLiquidityProjection {
  const clock = typeof performance === 'undefined' ? undefined : performance.now()
  const {
    data,
    month,
    currentAvailableBalanceCents,
    minimumOperatingBufferCents,
    simulation,
    personalBudgetScenario,
    includePersonalBudgetReservations = false,
    includedBudgetCategoryIds = [],
  } = input
  const reference = startOfDay(input.referenceDate ?? new Date())
  const periodStartDate = startOfMonth(month)
  const periodEndDate = endOfMonth(month)
  const periodStart = format(periodStartDate, 'yyyy-MM-dd')
  const periodEnd = format(periodEndDate, 'yyyy-MM-dd')
  const referenceKey = format(reference, 'yyyy-MM-dd')
  const isCurrentPeriod = isSameMonth(month, reference)
  const isFuturePeriod = isAfter(periodStartDate, reference)
  const periodMode = isCurrentPeriod ? 'current' : isFuturePeriod ? 'future' : 'past'
  const activeAccountIds = new Set(data.accounts.filter((account) => account.isActive).map((account) => account.id))
  const events: LiquidityProjectionEvent[] = []

  const completedTransactionsInPeriod = data.transactions
    .filter((transaction) => isCompletedLiquidityMovement(transaction)
      && transaction.transactionDate >= periodStart && transaction.transactionDate <= periodEnd
      // `currentAvailableBalanceCents` already includes every completed entry,
      // even when a recurring payment was registered ahead of its accounting
      // date. Reapplying that entry later would charge or credit it twice.
      && (periodMode === 'past' || transaction.transactionDate <= referenceKey))
  const completedInPeriod = completedTransactionsInPeriod.flatMap((transaction) => {
    const event = liquidityImpactFromTransaction(transaction, activeAccountIds)
    return event ? [event] : []
  })

  const plannedTransactionsInPeriod = data.transactions
    .filter((transaction) => transaction.status !== 'cancelled'
      && (transaction.status === 'planned' || transaction.status === 'pending')
      && isLiquidityType(transaction.type)
      && transaction.transactionDate >= periodStart && transaction.transactionDate <= periodEnd)
  const plannedInPeriod = plannedTransactionsInPeriod.flatMap((transaction) => {
    const event = liquidityImpactFromTransaction(transaction, activeAccountIds)
    return event ? [event] : []
  })

  // Real data always wins for days that already happened. Pending historic items
  // in the active period are treated as immediate commitments today. In reserve
  // mode the envelope contributes only its uncommitted remainder; dated personal
  // payments stay visible as ordinary cash movements and are never "released"
  // back into the line.
  let budgetReservations: BudgetReservationEvent[] = periodMode !== 'past'
    && (includePersonalBudgetReservations || includedBudgetCategoryIds.length > 0)
    ? budgetReservationEventsForMonth(data, month, reference, includePersonalBudgetReservations, includedBudgetCategoryIds)
    : []
  if (periodMode !== 'past'
    && includePersonalBudgetReservations
    && personalBudgetScenario
    && personalBudgetScenario.periodStart >= periodStart
    && personalBudgetScenario.periodEnd <= periodEnd
    && personalBudgetScenario.targetAmountCents >= 0) {
    // When there is an actual Q2 budget, replace it for the scenario rather
    // than adding a second envelope on top of it. Keep its ids so movements
    // already linked to that envelope still release the simulated reserve.
    const replacedReservations = budgetReservations.filter((event) => event.isPersonal && event.periodStart === personalBudgetScenario.periodStart)
    const scenarioSourceBudgetIds = replacedReservations.flatMap((event) => event.sourceBudgetIds)
    budgetReservations = budgetReservations.filter((event) => !event.isPersonal || event.periodStart !== personalBudgetScenario.periodStart)
    const scenarioEvent = personalBudgetScenarioEvent(data, personalBudgetScenario, scenarioSourceBudgetIds, reference)
    if (scenarioEvent) budgetReservations.push(scenarioEvent)
  }
  budgetReservations = budgetReservations.map((reservation) =>
    scheduleReservationAfterReference(reservation, referenceKey, isCurrentPeriod))

  events.push(...completedInPeriod, ...budgetReservations)
  const scheduledEvents = [
    ...plannedInPeriod,
    ...recurringEventsForMonth(data, month),
  ]
  for (const event of scheduledEvents) {
    if (event.date < referenceKey) {
      if (isCurrentPeriod) {
        events.push({ ...event, originalDate: event.date, date: referenceKey, isOverdue: true })
      }
      continue
    }
    if (!isFuturePeriod || event.date >= referenceKey) events.push(event)
  }

  if (periodMode !== 'past' && simulation && simulation.amountCents > 0 && simulation.date >= periodStart && simulation.date <= periodEnd) {
    const amountCents = simulation.type === 'income' ? simulation.amountCents : -simulation.amountCents
    events.push({
      id: 'simulation:active',
      date: simulation.date,
      label: simulation.description?.trim() || (simulation.type === 'income' ? 'Ingreso hipotético' : 'Gasto hipotético'),
      amountCents,
      kind: simulation.type,
      source: 'simulation',
    })
  }

  const groupedEvents = new Map<string, LiquidityProjectionEvent[]>()
  for (const event of events) {
    const list = groupedEvents.get(event.date) ?? []
    list.push(event)
    groupedEvents.set(event.date, list)
  }

  const actualPeriodImpactToReference = completedInPeriod
    .filter((event) => event.date <= referenceKey)
    .reduce((sum, event) => sum + event.amountCents, 0)
  const openingBalanceCents = carriedOpeningBalanceCents ?? (isCurrentPeriod
    ? currentAvailableBalanceCents - actualPeriodImpactToReference
    : openingBalanceFromHistory(data, periodStart))
  const openingBalanceSource = carriedOpeningBalanceCents == null
    ? isCurrentPeriod ? 'current_actual' as const : 'historical_actual' as const
    : 'prior_projected_close' as const

  const days: LiquidityProjectionDay[] = []
  let balanceCents = openingBalanceCents
  for (let cursor = periodStartDate; !isAfter(cursor, periodEndDate); cursor = addDays(cursor, 1)) {
    const date = format(cursor, 'yyyy-MM-dd')
    const eventsForDay = (groupedEvents.get(date) ?? []).filter((event) => {
      if (event.source === 'movement' && event.date <= referenceKey) return true
      if (event.source === 'movement' && event.date > referenceKey) return true
      return true
    })
    const incomeCents = eventsForDay.filter((event) => event.amountCents > 0).reduce((sum, event) => sum + event.amountCents, 0)
    const expenseCents = Math.abs(eventsForDay.filter((event) => event.amountCents < 0).reduce((sum, event) => sum + event.amountCents, 0))
    balanceCents += incomeCents - expenseCents
    days.push({ date, balanceCents, incomeCents, expenseCents, events: eventsForDay, isCurrent: date === referenceKey })
  }

  const lowest = days.reduce((minimum, day) => day.balanceCents < minimum.balanceCents ? day : minimum, days[0])
  const minimumBalanceCents = lowest?.balanceCents ?? openingBalanceCents
  const closingBalanceCents = days.at(-1)?.balanceCents ?? openingBalanceCents
  const status = financeLiquidityStatus(minimumBalanceCents, minimumOperatingBufferCents)
  const computeMs = clock == null || typeof performance === 'undefined' ? 0 : performance.now() - clock

  return {
    periodStart,
    periodEnd,
    periodMode,
    availableTodayCents: currentAvailableBalanceCents,
    openingBalanceCents,
    openingBalanceSource,
    openingBalanceSourcePeriod: openingBalanceSource === 'prior_projected_close'
      ? monthKey(subMonths(periodStartDate, 1))
      : undefined,
    minimumBalanceCents,
    minimumDate: lowest?.date ?? periodStart,
    closingBalanceCents,
    freeMarginCents: minimumBalanceCents - Math.max(0, minimumOperatingBufferCents),
    status,
    days,
    events: [...events].sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)),
    sensitivePeriods: sensitivePeriods(days, Math.max(0, minimumOperatingBufferCents) * LIQUIDITY_MODERATION_MULTIPLIER),
    currentDate: referenceKey,
    computeMs,
  }
}

/**
 * Projects one selected period from the correct temporal anchor:
 * - past: reconstructed actual ledger;
 * - current: today's reconciled operational balance;
 * - future: the live projected close of every preceding month.
 *
 * The carry is intentionally calculated in memory. A saved liquidity snapshot
 * is an audit baseline, not the next month's opening balance.
 */
export function financeLiquidityProjection(input: FinanceLiquidityProjectionInput): FinanceLiquidityProjection {
  const startedAt = typeof performance === 'undefined' ? undefined : performance.now()
  const reference = startOfDay(input.referenceDate ?? new Date())
  const targetMonth = startOfMonth(input.month)
  if (!isAfter(targetMonth, reference)) return projectFinanceLiquidityMonth(input)

  const carryIncludePersonalBudgetReservations = input.carryIncludePersonalBudgetReservations
    ?? input.includePersonalBudgetReservations
  const carryIncludedBudgetCategoryIds = input.carryIncludedBudgetCategoryIds
    ?? input.includedBudgetCategoryIds

  let projection = projectFinanceLiquidityMonth({
    ...input,
    month: startOfMonth(reference),
    simulation: undefined,
    personalBudgetScenario: undefined,
    includePersonalBudgetReservations: carryIncludePersonalBudgetReservations,
    includedBudgetCategoryIds: carryIncludedBudgetCategoryIds,
  })
  for (let cursor = addMonths(startOfMonth(reference), 1); !isAfter(cursor, targetMonth); cursor = addMonths(cursor, 1)) {
    const isTargetMonth = isSameMonth(cursor, targetMonth)
    projection = projectFinanceLiquidityMonth({
      ...input,
      month: cursor,
      simulation: isTargetMonth ? input.simulation : undefined,
      personalBudgetScenario: isTargetMonth ? input.personalBudgetScenario : undefined,
      includePersonalBudgetReservations: isTargetMonth
        ? input.includePersonalBudgetReservations
        : carryIncludePersonalBudgetReservations,
      includedBudgetCategoryIds: isTargetMonth
        ? input.includedBudgetCategoryIds
        : carryIncludedBudgetCategoryIds,
    }, projection.closingBalanceCents)
  }

  return {
    ...projection,
    computeMs: startedAt == null || typeof performance === 'undefined'
      ? projection.computeMs
      : performance.now() - startedAt,
  }
}

export function financeLiquidityDeviation(currentMinimumCents: number, initialMinimumCents?: number) {
  return initialMinimumCents == null ? undefined : currentMinimumCents - initialMinimumCents
}

export function isSameProjectionPeriod(month: Date, reference = new Date()) {
  return isSameMonth(month, reference)
}
