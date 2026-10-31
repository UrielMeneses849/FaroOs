import { addDays, addMonths, endOfMonth, format, parseISO, startOfMonth } from 'date-fns'
import type { FinanceDebt } from '../features/finance/debtTypes'
import type { FinanceData, FinanceFrequency } from '../features/finance/financeTypes'

const key = (date: Date) => format(date, 'yyyy-MM-dd')
const outflow = (type: string) => type === 'expense' || type === 'debt_payment'
export const debtPayments = (debt: FinanceDebt, data: FinanceData) => data.transactions.filter(transaction =>
  transaction.debtId === debt.id && transaction.status === 'completed' && outflow(transaction.type)
  && transaction.transactionDate >= debt.balanceDate)

export function debtRemainingCents(debt: FinanceDebt, data: FinanceData) {
  const payments = debtPayments(debt, data)
  if (payments.some(payment => payment.debtSettlement)) return 0
  const nominal = Math.max(0, debt.balanceCents - payments.reduce((sum, payment) => sum + (payment.debtPrincipalCents ?? payment.amountCents) - (payment.debtBalanceAdjustmentCents ?? 0), 0))
  if (debt.agreementStatus === 'confirmed' && debt.agreementCents) {
    const agreedPaid = payments.filter(payment => payment.transactionDate >= (debt.agreementDate ?? debt.balanceDate))
      .reduce((sum, payment) => sum + (payment.debtPrincipalCents ?? payment.amountCents) - (payment.debtBalanceAdjustmentCents ?? 0), 0)
    return Math.min(nominal, Math.max(0, debt.agreementCents - agreedPaid))
  }
  return nominal
}

export function advanceDebtDate(date: string, frequency: FinanceFrequency, anchorDay?: number) {
  const parsed = parseISO(date)
  if (frequency === 'weekly' || frequency === 'biweekly') return key(addDays(parsed, frequency === 'weekly' ? 7 : 14))
  const next = addMonths(startOfMonth(parsed), frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12)
  next.setDate(Math.min(anchorDay ?? parsed.getDate(), endOfMonth(next).getDate()))
  return key(next)
}


export interface ScheduledDebtPayment {
  id: string
  debt: FinanceDebt
  date: string
  amountCents: number
}

/** Fallback calendar for Plan debts without an active recurring schedule.
 * Existing movements own their date; estimates stop at the outstanding balance.
 * Walk from the reference date so earlier estimates never become arrears.
 * A later target month still consumes intervening future installments.
 */
export function debtHasRecurringSchedule(data: FinanceData, debtId: string, date: string) {
  return data.recurring.some(item => item.isActive && item.debtId === debtId
    && item.startDate <= date && (!item.endDate || item.endDate >= date))
}

export function scheduledDebtPayments(data: FinanceData, through: string, reference = new Date()): ScheduledDebtPayment[] {
  const referenceKey = key(reference)
  const payments: ScheduledDebtPayment[] = []
  for (const debt of data.debtPlan?.debts ?? []) {
    if (debt.status !== 'active') continue
    let remaining = debtRemainingCents(debt, data)
    let date = debt.nextPaymentDate
    const anchor = parseISO(date).getDate()
    const planned = data.transactions.filter(item => item.debtId === debt.id && outflow(item.type)
      && (item.status === 'planned' || item.status === 'pending')).sort((a, b) => a.transactionDate.localeCompare(b.transactionDate))
    let plannedIndex = 0
    for (let guard = 0; date <= through && remaining > 0 && guard < 10000; guard++) {
      // A stale schedule anchor is not evidence of an unpaid installment.
      // Actual overdue commitments remain in transactions / occurrences.
      if (date >= debt.balanceDate && date >= referenceKey) {
        // Explicit payments, including extras between installments, consume the
        // remaining forecast before the next generated installment.
        while (plannedIndex < planned.length && planned[plannedIndex].transactionDate <= date) {
          const item = planned[plannedIndex++]
          remaining = item.debtSettlement ? 0 : Math.max(0, remaining - (item.debtPrincipalCents ?? item.amountCents))
        }
        const recorded = data.transactions.some(item => item.debtId === debt.id && outflow(item.type)
          && item.status !== 'cancelled' && item.transactionDate === date)
        const linked = debtHasRecurringSchedule(data, debt.id, date)
        if (linked && !recorded) {
          const linkedIds = new Set(data.recurring.filter(item => item.debtId === debt.id && item.isActive).map(item => item.id))
          const committed = data.recurringOccurrences.filter(item => linkedIds.has(item.recurringTransactionId)
            && item.expectedDate === date && item.status !== 'paid' && item.status !== 'skipped'
            && !data.transactions.some(transaction => transaction.id === item.transactionId && transaction.status !== 'cancelled'))
            .reduce((sum, item) => sum + (item.amountCents ?? 0), 0)
          remaining = Math.max(0, remaining - committed)
        }
        if (!linked && !recorded && remaining > 0) {
          const installment = debt.agreementStatus === 'confirmed' && debt.agreementCents && debt.agreementPayments
            && date >= (debt.agreementDate ?? debt.balanceDate)
            ? Math.ceil(debt.agreementCents / debt.agreementPayments) : debt.paymentCents
          const amountCents = Math.min(remaining, installment)
          if (amountCents > 0) payments.push({ id: `debt:${debt.id}:${date}`, debt, date, amountCents })
          remaining -= amountCents
        }
      }
      date = advanceDebtDate(date, debt.frequency, anchor)
    }
  }
  return payments.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
