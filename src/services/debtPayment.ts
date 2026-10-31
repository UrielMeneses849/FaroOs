import { format } from 'date-fns'
import type { FinanceDebt } from '../features/finance/debtTypes'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { debtPayments, debtRemainingCents } from './debtSchedule'
import { debtPlanBalanceCents } from './debtPlanBalance'

export interface DebtPaymentSource {
  date: string
  amountCents: number
  transactionId?: string
  recurringId?: string
  occurrenceId?: string
}

/** Share the same defaults between Plan, recurring expenses and the payment editor. */
export function debtPaymentDefaults(debt: FinanceDebt, data: FinanceData, source?: DebtPaymentSource) {
  const accounts = data.accounts.filter(account => account.isActive && account.currency === 'MXN')
  const existing = data.transactions.find(item => item.id === source?.transactionId)
  const recurring = data.recurring.find(item => item.id === source?.recurringId)
  const latest = debtPayments(debt, data).filter(item => accounts.some(account => account.id === item.accountId))
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || b.createdAt.localeCompare(a.createdAt))[0]
  const accountId = [existing?.accountId, recurring?.accountId, latest?.accountId,
    accounts.find(account => debtPlanBalanceCents(data, account.id) > 0)?.id, accounts[0]?.id]
    .find(id => accounts.some(account => account.id === id)) ?? ''
  const balanceCents = debtRemainingCents(debt, data)
  const amountCents = Math.min(balanceCents, existing?.amountCents ?? source?.amountCents ?? debt.paymentCents)
  return { existing, recurring, accounts, accountId, balanceCents, amountCents,
    planAmountCents: Math.min(amountCents, debtPlanBalanceCents(data, accountId)),
    categoryId: existing?.categoryId ?? recurring?.categoryId ?? data.categories.find(category => category.isActive && category.name === 'Plan' && category.type === 'expense')?.id }
}

export function habitualDebtPayment(debt: FinanceDebt, data: FinanceData, id: string, source: DebtPaymentSource, reference = new Date()): Omit<FinanceTransaction, 'createdAt' | 'updatedAt'> {
  const defaults = debtPaymentDefaults(debt, data, source)
  if (!defaults.accountId) throw new Error('Selecciona una cuenta activa en MXN para registrar el pago.')
  if (defaults.amountCents <= 0) throw new Error('Esta deuda ya está liquidada.')
  if (!defaults.categoryId) throw new Error('No encontré la categoría Plan. Actualiza tus finanzas.')
  return { id: defaults.existing?.id ?? id, accountId: defaults.accountId, categoryId: defaults.categoryId,
    type: defaults.existing?.type ?? defaults.recurring?.type ?? 'expense', description: defaults.existing?.description ?? defaults.recurring?.description ?? `Pago · ${debt.name}`,
    amountCents: defaults.amountCents, transactionDate: format(reference, 'yyyy-MM-dd'), status: 'completed',
    debtId: debt.id, debtSettlement: false, planAmountCents: defaults.planAmountCents,
    recurringTransactionId: source.occurrenceId ? source.recurringId : defaults.existing?.recurringTransactionId,
    budgetId: defaults.existing?.budgetId, notes: defaults.existing?.notes }
}
