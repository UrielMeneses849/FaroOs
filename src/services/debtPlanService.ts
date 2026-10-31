import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import type { FinanceDebt } from '../features/finance/debtTypes'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { advanceDebtDate, debtPayments, debtRemainingCents, scheduledDebtPayments } from './debtSchedule'
export { advanceDebtDate, debtPayments, debtRemainingCents } from './debtSchedule'
import { debtPlanAvailableCents, debtPlanBalanceCents } from './debtPlanBalance'
import { calculateFinanceMetrics, canonicalFinanceBudgetGroups } from './financeService'
import { financeLiquidityProjection } from './financeLiquidityProjection'

const key = (date: Date) => format(date, 'yyyy-MM-dd')
const outflow = (type: string) => type === 'expense' || type === 'debt_payment'
/** Quotes captured after a payment supersede the original quote and undo with it. */
export function debtWithLatestQuote(debt: FinanceDebt, data: FinanceData): FinanceDebt {
  const latest = debtPayments(debt, data).filter(payment => payment.debtQuoteCents != null && payment.transactionDate >= (debt.quoteDate ?? debt.balanceDate))
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]
  return latest ? { ...debt, settlementCents: latest.debtQuoteCents, quoteDate: latest.transactionDate,
    quoteValidUntil: latest.debtQuoteValidUntil } : debt
}

export function validSettlementQuote(debt: FinanceDebt, data: FinanceData, date: string) {
  debt = debtWithLatestQuote(debt, data)
  if (!debt.settlementCents || !debt.quoteDate || date < debt.quoteDate) return false
  // Never invent a future discount or subtract partial payments from a fixed quote.
  if (date > (debt.quoteValidUntil ?? debt.quoteDate)) return false
  const quoteDate = debt.quoteDate
  const payments = debtPayments(debt, data).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const quotePayment = payments.filter(payment => payment.transactionDate === quoteDate && payment.debtQuoteCents != null).at(-1)
  return !payments.some((payment, index) => payment.transactionDate >= quoteDate && (!quotePayment || index > payments.indexOf(quotePayment)))
}

export interface DebtPlanEvent {
  id: string
  debtId: string
  date: string
  amountCents: number
  remainingCents: number
  kind: 'payment' | 'extra' | 'settlement' | 'agreement'
  transactionId?: string
  recurringId?: string
  occurrenceId?: string
  closes: boolean
}

export interface DebtPlanProjection {
  events: DebtPlanEvent[]
  days: { date: string; balanceCents: number; planCents: number; debtCents: number }[]
  payoffDates: Record<string, string>
  finishDate?: string
  remainingCents: number
  totalPaidCents: number
  avoidedCostCents: number
  minimumCashCents: number
  minimumDate: string
  warnings: string[]
}

/** A working forecast with explicit future-template estimates and no duplicate debt outflow. */
export function projectDebtPlan(data: FinanceData, options: {
  reference?: Date; strategy?: 'minimum' | 'balanced' | 'fast'; monthlyContributionCents?: number; months?: number; oneTimePayment?: { debtId: string; date: string; amountCents: number; settles?: boolean }
} = {}): DebtPlanProjection {
  const reference = options.reference ?? new Date()
  const today = key(reference)
  const horizon = key(endOfMonth(addMonths(reference, (options.months ?? 18) - 1)))
  const preferences = data.debtPlan?.preferences
  const strategy = options.strategy ?? preferences?.strategy ?? 'balanced'
  const monthly = options.monthlyContributionCents ?? preferences?.monthlyContributionCents ?? 0
  const debts = (data.debtPlan?.debts ?? []).map(debt => debtWithLatestQuote(debt, data)).filter(debt => debt.status === 'active' && debtRemainingCents(debt, data) > 0)
  const balances = new Map(debts.map(debt => [debt.id, debtRemainingCents(debt, data)]))
  const initial = [...balances.values()].reduce((sum, value) => sum + value, 0)
  const warnings = new Set<string>()
  const fund = debtPlanAvailableCents(data)
  if (fund < debtPlanBalanceCents(data)) warnings.add('Parte del dinero reservado en Plan está en cuentas inactivas o no denominadas en MXN; no se usa para pagos nuevos.')
  const activeAccounts = new Set(data.accounts.filter(account => account.isActive).map(account => account.id))
  const confirmed = data.recurringOccurrences.slice()
  // Template estimates are limited to future months with no explicit configuration.
  for (const recurring of data.recurring.filter(item => item.isActive)) {
    let date = recurring.nextOccurrence
    for (let guard = 0; date <= horizon && guard < 800; guard++) {
      const period = `${date.slice(0, 7)}-01`
      if (date > today && period > `${today.slice(0, 7)}-01` && (!recurring.endDate || date <= recurring.endDate)
        && date >= recurring.startDate && !data.recurringOccurrences.some(occurrence => occurrence.recurringTransactionId === recurring.id && occurrence.period === period)) {
        const lastConfigured = data.recurringOccurrences.filter(occurrence => occurrence.recurringTransactionId === recurring.id
          && occurrence.expectedDate <= date && (occurrence.amountCents ?? 0) > 0 && occurrence.status !== 'skipped')
          .sort((left, right) => right.expectedDate.localeCompare(left.expectedDate))[0]
        confirmed.push({ id: `estimate:${recurring.id}:${date}`, recurringTransactionId: recurring.id, period, expectedDate: date,
          amountCents: lastConfigured?.amountCents ?? recurring.amountCents, status: 'pending', createdAt: '', updatedAt: '' })
        warnings.add('Los meses sin periodos definidos usan el último monto de tus recurrentes como estimación.')
      }
      date = advanceDebtDate(date, recurring.frequency, parseISO(recurring.nextOccurrence).getDate())
    }
  }
  type DuePayment = { debt: FinanceDebt; amount: number; transactionId?: string; recurringId?: string; occurrenceId?: string; settles?: boolean; principalCents?: number }
  const due = new Map<string, DuePayment[]>()
  const addDue = (date: string, value: DuePayment) => {
    const effective = date < today ? today : date
    if (effective <= horizon && value.amount > 0) due.set(effective, [...(due.get(effective) ?? []), value])
  }
  const fallbackSchedule = scheduledDebtPayments(data, horizon, reference)
  for (const debt of debts) {
    const linked = data.recurring.filter(item => item.debtId === debt.id && item.isActive)
    const planned = data.transactions.filter(item => item.debtId === debt.id && outflow(item.type) && ['planned', 'pending'].includes(item.status))
    for (const item of planned) addDue(item.transactionDate, { debt, amount: item.amountCents, transactionId: item.id, settles: item.debtSettlement, principalCents: item.debtPrincipalCents })
    for (const recurring of linked) {
      for (const occurrence of confirmed.filter(item => item.recurringTransactionId === recurring.id && item.status !== 'paid' && item.status !== 'skipped')) {
        if (data.transactions.some(item => item.recurringTransactionId === recurring.id && item.transactionDate === occurrence.expectedDate && item.status !== 'cancelled')) continue
        addDue(occurrence.expectedDate, { debt, amount: occurrence.amountCents ?? 0, recurringId: recurring.id,
          occurrenceId: occurrence.id.startsWith('estimate:') ? undefined : occurrence.id })
      }
      if (!confirmed.some(item => item.recurringTransactionId === recurring.id && item.period === `${today.slice(0, 7)}-01`)) warnings.add(`Define el periodo actual de ${recurring.description} en Gastos.`)
    }
    for (const payment of fallbackSchedule.filter(item => item.debt.id === debt.id)) {
      addDue(payment.date, { debt, amount: payment.amountCents })
    }
    if (debt.agreementStatus === 'proposed') warnings.add(`El convenio de ${debt.name} es una propuesta; se conserva el pago actual hasta confirmarlo.`)
  }
  // Existing debt-linked commitments are replaced by the above schedule exactly once.
  const debtIds = new Set(debts.map(debt => debt.id))
  const linkedMovementEvents = new Set(data.transactions.filter(item => item.debtId && debtIds.has(item.debtId)).map(item => `movement:${item.id}`))
  const linkedRecurringEvents = new Set(confirmed.filter(occurrence => data.recurring.some(item => item.id === occurrence.recurringTransactionId && item.debtId && debtIds.has(item.debtId))).map(item => `recurring:${item.id}`))
  const cashData: FinanceData = {
    ...data, recurringOccurrences: confirmed,
    // Plan has its own envelope, separate from category budgets.
    budgets: data.budgets.filter(budget => data.categories.find(category => category.id === budget.categoryId)?.name.toLowerCase() !== 'plan'),
  }
  let cash = calculateFinanceMetrics(data, reference, reference).availableBalanceCents
    + data.accounts.filter(account => account.isActive).reduce((sum, account) => sum + debtPlanBalanceCents(data, account.id), 0)
  const startingCash = cash
  const otherEvents = new Map<string, number>()
  const budgetCategories = [...new Set(canonicalFinanceBudgetGroups(cashData).filter(group => !group.isPersonal).map(group => group.budget.categoryId))]
  for (let month = startOfMonth(reference); key(month) <= horizon; month = addMonths(month, 1)) {
    const projection = financeLiquidityProjection({ data: cashData, month, referenceDate: reference,
      currentAvailableBalanceCents: startingCash, minimumOperatingBufferCents: data.liquidityPreference.minimumOperatingBufferCents,
      includePersonalBudgetReservations: true, includedBudgetCategoryIds: budgetCategories })
    for (const event of projection.events) if (event.date >= today && event.date <= horizon) {
      // Keep linked commitments in budget usage, but replace their dated cash
      // events with the debt schedule so neither the debt nor budget is doubled.
      if (event.source === 'debt' || linkedMovementEvents.has(event.id) || linkedRecurringEvents.has(event.id)) continue
      otherEvents.set(event.date, (otherEvents.get(event.date) ?? 0) + event.amountCents)
    }
  }
  const buffer = strategy === 'fast' ? 0 : data.liquidityPreference.minimumOperatingBufferCents
  let pool = fund
  const events: DebtPlanEvent[] = []
  const days: DebtPlanProjection['days'] = []
  const payoffDates: Record<string, string> = {}
  let avoided = debts.reduce((sum, debt) => sum + (debt.agreementStatus === 'confirmed'
    ? Math.max(0, debt.balanceCents - debtPayments(debt, data).reduce((paid, item) => paid + (item.debtPrincipalCents ?? item.amountCents), 0) - debtRemainingCents(debt, data)) : 0), 0)
  let minimumCash = cash
  let minimumDate = today
  const ordered = debts.slice().sort((left, right) => left.priority - right.priority
    || Number(right.kind === 'purchase') - Number(left.kind === 'purchase')
    || (right.balanceCents - (right.settlementCents ?? right.balanceCents))
      - (left.balanceCents - (left.settlementCents ?? left.balanceCents))
    || left.balanceCents - right.balanceCents)
  const pay = (debt: FinanceDebt, date: string, amount: number, kind: DebtPlanEvent['kind'], source?: { transactionId?: string; recurringId?: string; occurrenceId?: string }, settlement = false, principalCents?: number) => {
    const before = balances.get(debt.id) ?? 0
    const paid = before > 0 ? source?.transactionId ? amount : Math.min(before, amount) : 0
    if (paid <= 0) return
    const after = settlement ? 0 : Math.max(0, before - (principalCents ?? paid))
    if (settlement) avoided += Math.max(0, before - paid)
    balances.set(debt.id, after)
    cash -= paid
    pool -= Math.min(pool, paid)
    events.push({ id: `${debt.id}:${date}:${events.length}`, debtId: debt.id, date, amountCents: paid, remainingCents: after, kind, ...source, closes: after === 0 })
    if (!after) payoffDates[debt.id] = date
  }
  const safeFloorAfterPayment = (debt: FinanceDebt, date: string, amount: number, settles = false, includeToday = false) => {
    const futureBalances = new Map(balances)
    futureBalances.set(debt.id, settles ? 0 : Math.max(0, (balances.get(debt.id) ?? 0) - amount))
    let futureCash = cash - amount
    let floor = futureCash
    const end = key(addDays(parseISO(date), 30))
    for (let look = includeToday ? parseISO(date) : addDays(parseISO(date), 1); key(look) <= end; look = addDays(look, 1)) {
      const lookKey = key(look)
      if (lookKey !== date) futureCash += otherEvents.get(lookKey) ?? 0
      for (const item of due.get(lookKey) ?? []) {
        const left = futureBalances.get(item.debt.id) ?? 0
        const scheduled = !item.transactionId && item.debt.agreementStatus === 'confirmed' && item.debt.agreementCents && item.debt.agreementPayments && lookKey >= (item.debt.agreementDate ?? item.debt.balanceDate)
          ? Math.ceil(item.debt.agreementCents / item.debt.agreementPayments) : item.amount
        const paid = left > 0 ? item.transactionId ? scheduled : Math.min(left, scheduled) : 0
        futureCash -= paid
        futureBalances.set(item.debt.id, item.settles ? 0 : Math.max(0, left - (item.principalCents ?? paid)))
      }
      floor = Math.min(floor, futureCash)
    }
    return floor
  }
  for (let cursor = parseISO(today); key(cursor) <= horizon; cursor = addDays(cursor, 1)) {
    const date = key(cursor)
    cash += otherEvents.get(date) ?? 0
    if (strategy !== 'minimum' && cursor.getDate() === (preferences?.contributionDay ?? 15)) {
      const alreadyAllocated = (data.debtPlan?.entries ?? []).filter(entry => entry.amountCents > 0 && entry.entryDate.startsWith(date.slice(0, 7))).reduce((sum, entry) => sum + entry.amountCents, 0)
      pool += Math.max(0, monthly - alreadyAllocated)
    }
    const todayDue = due.get(date) ?? []
    if (strategy !== 'minimum' && pool > 0) for (const debt of ordered) {
      const quote = debt.settlementCents ?? 0
      if (validSettlementQuote(debt, data, date) && quote <= (balances.get(debt.id) ?? 0) && quote <= pool
        && safeFloorAfterPayment(debt, date, quote, true, true) >= buffer) pay(debt, date, quote, 'settlement', undefined, true)
    }
    for (const item of todayDue) {
      if (!activeAccounts.size) warnings.add('Crea una cuenta activa en MXN para registrar pagos.')
      if (item.transactionId) {
        pay(item.debt, date, item.amount, item.settles ? 'settlement' : 'payment', item, item.settles, item.principalCents)
      } else if (item.debt.agreementStatus === 'confirmed' && item.debt.agreementCents && item.debt.agreementPayments && date >= (item.debt.agreementDate ?? item.debt.balanceDate)) {
        pay(item.debt, date, Math.ceil(item.debt.agreementCents / item.debt.agreementPayments), 'agreement', item)
      } else pay(item.debt, date, item.amount, 'payment', item)
    }
    const simulated = options.oneTimePayment
    if (simulated?.date === date) {
      const debt = debts.find(item => item.id === simulated.debtId)
      if (debt) pay(debt, date, simulated.amountCents, simulated.settles ? 'settlement' : 'extra', undefined, simulated.settles)
    }
    if (strategy !== 'minimum' && pool > 0) {
      // Protect all known commitments over the next 30 days, not just today's cash.
      for (const debt of ordered) {
        const remaining = balances.get(debt.id) ?? 0
        if (!remaining) continue
        const quote = debt.settlementCents ?? 0
        if (validSettlementQuote(debt, data, date) && quote <= remaining && quote <= pool && safeFloorAfterPayment(debt, date, quote, true) >= buffer) {
          pay(debt, date, quote, 'settlement', undefined, true)
        } else if (debt.kind !== 'purchase' || !validSettlementQuote(debt, data, date)) {
          let low = 0
          let high = Math.max(0, Math.min(pool, cash - buffer, remaining))
          if (safeFloorAfterPayment(debt, date, 0) < buffer) high = 0
          if (high && safeFloorAfterPayment(debt, date, high) >= buffer) low = high
          while (low < high) {
            const candidate = Math.ceil((low + high) / 2)
            if (safeFloorAfterPayment(debt, date, candidate) >= buffer) low = candidate
            else high = candidate - 1
          }
          const extra = low
          if (extra > 0 && debt.kind === 'purchase') warnings.add(`${debt.name}: los extras sin cotización vigente descuentan el saldo a plazo; no se estima un descuento adicional.`)
          pay(debt, date, extra, 'extra')
        }
      }
    }
    if (cash < minimumCash) { minimumCash = cash; minimumDate = date }
    days.push({ date, balanceCents: cash, planCents: Math.max(0, pool), debtCents: [...balances.values()].reduce((sum, value) => sum + value, 0) })
  }
  for (const debt of debts) {
    if (debt.deadline && (!payoffDates[debt.id] || payoffDates[debt.id] > debt.deadline)) warnings.add(`${debt.name} termina después de su fecha límite.`)
  }
  if (minimumCash < data.liquidityPreference.minimumOperatingBufferCents) warnings.add('El calendario cruza tu colchón protegido. Revisa las fechas o reduce el pago extra.')
  const dates = Object.values(payoffDates).sort()
  if (dates.length === debts.length && dates.at(-1) && preferences?.targetDate && dates.at(-1)! > preferences.targetDate) warnings.add('La fecha estimada supera tu meta. Compara escenarios y ajusta tus aportaciones.')
  for (const debt of data.debtPlan?.debts ?? []) if (!debtRemainingCents(debt, data) && data.recurring.some(item => item.debtId === debt.id && item.isActive)) {
    warnings.add(`${debt.name} está liquidada, pero conserva recurrentes activos. Revisa su programación en Gastos.`)
  }
  return { events, days, payoffDates, finishDate: debts.length > 0 && dates.length === debts.length ? dates.at(-1) : undefined,
    remainingCents: [...balances.values()].reduce((sum, value) => sum + value, 0), totalPaidCents: events.reduce((sum, event) => sum + event.amountCents, 0),
    avoidedCostCents: Math.max(0, Math.min(initial, avoided)), minimumCashCents: minimumCash, minimumDate, warnings: [...warnings] }
}

export function debtPlanAdvanceDays(baseline: DebtPlanProjection, plan: DebtPlanProjection) {
  return baseline.finishDate && plan.finishDate ? Math.max(0, differenceInCalendarDays(parseISO(baseline.finishDate), parseISO(plan.finishDate))) : 0
}

export function paymentImpact(debt: FinanceDebt, payment: Pick<FinanceTransaction, 'amountCents' | 'debtPrincipalCents' | 'debtSettlement' | 'debtBalanceAdjustmentCents'>, data: FinanceData) {
  return payment.debtSettlement ? 0 : Math.max(0, debtRemainingCents(debt, data) - (payment.debtPrincipalCents ?? payment.amountCents) + (payment.debtBalanceAdjustmentCents ?? 0))
}
