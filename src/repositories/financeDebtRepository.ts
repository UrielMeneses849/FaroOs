import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { DebtPlanData, DebtPlanPreferences, FinanceDebt } from '../features/finance/debtTypes'
import { defaultDebtPlanPreferences } from '../features/finance/debtTypes'
import { assertFinanceUser, centsToNumeric, numericToCents, throwIfError } from './financeRepositoryUtils'
import type { FinanceTransaction } from '../features/finance/financeTypes'

type DebtRow = Database['public']['Tables']['finance_debts']['Row']
const debtFromRow = (row: DebtRow): FinanceDebt => ({
  id: row.id, name: row.name, creditor: row.creditor, kind: row.kind as FinanceDebt['kind'], status: row.status as FinanceDebt['status'],
  balanceCents: numericToCents(row.balance), balanceDate: row.balance_date,
  paymentCents: numericToCents(row.payment), frequency: row.frequency, nextPaymentDate: row.next_payment_date,
  deadline: row.deadline ?? undefined, settlementCents: row.settlement == null ? undefined : numericToCents(row.settlement),
  quoteDate: row.quote_date ?? undefined, quoteValidUntil: row.quote_valid_until ?? undefined,
  agreementCents: row.agreement_amount == null ? undefined : numericToCents(row.agreement_amount),
  agreementDate: row.agreement_start_date ?? undefined,
  agreementPayments: row.agreement_payments ?? undefined, agreementStatus: row.agreement_status as FinanceDebt['agreementStatus'],
  priority: row.priority, notes: row.notes ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
})

export const financeDebtRepository = {
  async load(userId: string): Promise<DebtPlanData> {
    await assertFinanceUser(userId)
    const [debts, entries, preferences] = await Promise.all([
      supabase.from('finance_debts').select('*').eq('user_id', userId).order('priority').order('created_at'),
      supabase.from('finance_debt_plan_entries').select('*').eq('user_id', userId).order('entry_date', { ascending: false }),
      supabase.from('finance_debt_plan_preferences').select('*').eq('user_id', userId).maybeSingle(),
    ])
    for (const result of [debts, entries, preferences]) throwIfError(result.error)
    return {
      debts: (debts.data ?? []).map(debtFromRow),
      entries: (entries.data ?? []).map(row => ({ id: row.id, accountId: row.account_id, amountCents: numericToCents(row.amount), entryDate: row.entry_date, notes: row.notes ?? undefined, createdAt: row.created_at })),
      preferences: preferences.data ? {
        monthlyContributionCents: numericToCents(preferences.data.monthly_contribution), contributionDay: preferences.data.contribution_day,
        targetDate: preferences.data.target_date, strategy: preferences.data.strategy as DebtPlanPreferences['strategy'],
      } : defaultDebtPlanPreferences(),
    }
  },
  async save(debt: Omit<FinanceDebt, 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_debts').upsert({
      id: debt.id, user_id: userId, name: debt.name.trim(), creditor: debt.creditor.trim(), kind: debt.kind, status: debt.status,
      balance: centsToNumeric(debt.balanceCents), balance_date: debt.balanceDate, payment: centsToNumeric(debt.paymentCents),
      frequency: debt.frequency, next_payment_date: debt.nextPaymentDate, deadline: debt.deadline ?? null,
      settlement: debt.settlementCents == null ? null : centsToNumeric(debt.settlementCents), quote_date: debt.quoteDate ?? null, quote_valid_until: debt.quoteValidUntil ?? null,
      agreement_amount: debt.agreementCents == null ? null : centsToNumeric(debt.agreementCents), agreement_payments: debt.agreementPayments ?? null,
      agreement_status: debt.agreementStatus, priority: debt.priority, notes: debt.notes ?? null,
      agreement_start_date: debt.agreementDate ?? debt.balanceDate,
    }, { onConflict: 'id' })
    throwIfError(error)
  },
  async remove(id: string, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_debts').delete().eq('id', id).eq('user_id', userId)
    if (error?.code === '23503') throw new Error('Esta deuda conserva pagos o vínculos. Archívala para conservar el historial.')
    throwIfError(error)
  },
  async savePreferences(preferences: DebtPlanPreferences, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_debt_plan_preferences').upsert({
      user_id: userId, monthly_contribution: centsToNumeric(preferences.monthlyContributionCents), contribution_day: preferences.contributionDay,
      target_date: preferences.targetDate, strategy: preferences.strategy,
    }, { onConflict: 'user_id' })
    throwIfError(error)
  },
  async allocate(input: { id: string; accountId: string; amountCents: number; date: string; notes?: string }, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.rpc('allocate_finance_debt_plan', {
      target_id: input.id, target_account: input.accountId, target_amount: centsToNumeric(input.amountCents), target_date: input.date, target_notes: input.notes ?? undefined,
    })
    throwIfError(error)
  },
  async link(debtId: string | undefined, source: { recurringId?: string; transactionId?: string }, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.rpc('link_finance_debt', {
      target_debt: debtId ?? undefined, target_recurring: source.recurringId, target_transaction: source.transactionId,
    })
    throwIfError(error)
  },
  async pay(input: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>, occurrenceId: string | undefined, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.rpc('pay_finance_debt', {
      target_id: input.id, target_debt: input.debtId!, target_account: input.accountId,
      target_amount: centsToNumeric(input.amountCents), target_date: input.transactionDate,
      target_plan_amount: centsToNumeric(input.planAmountCents ?? 0), target_settlement: input.debtSettlement ?? false,
      target_principal: input.debtPrincipalCents == null ? undefined : centsToNumeric(input.debtPrincipalCents),
      ...(input.debtBalanceAdjustmentCents ? { target_balance_adjustment: centsToNumeric(input.debtBalanceAdjustmentCents) } : {}),
      ...(input.debtQuoteCents != null ? { target_quote: centsToNumeric(input.debtQuoteCents), target_quote_valid_until: input.debtQuoteValidUntil } : {}),
      target_occurrence: occurrenceId, target_notes: input.notes,
    })
    throwIfError(error)
  },
}
