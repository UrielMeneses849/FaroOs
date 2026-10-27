import type { FinanceData } from '../features/finance/financeTypes'

/** Reservations stay in the bank; only completed payments consume the envelope. */
export function debtPlanBalanceCents(data: FinanceData, accountId?: string) {
  const allocated = (data.debtPlan?.entries ?? [])
    .filter((entry) => !accountId || entry.accountId === accountId)
    .reduce((sum, entry) => sum + entry.amountCents, 0)
  const spent = data.transactions
    .filter((transaction) => transaction.status === 'completed' && (!accountId || transaction.accountId === accountId))
    .reduce((sum, transaction) => sum + (transaction.planAmountCents ?? 0), 0)
  return Math.max(0, allocated - spent)
}

export function debtPlanAvailableCents(data: FinanceData) {
  return data.accounts.filter(account => account.isActive && account.currency === 'MXN')
    .reduce((sum, account) => sum + debtPlanBalanceCents(data, account.id), 0)
}
