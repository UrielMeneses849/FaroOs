import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceData,
  FinanceGoal,
  FinanceGoalContribution,
  FinanceGoalItem,
  FinanceSavingsFundEntry,
  FinanceRecurringOccurrence,
  FinanceRecurringTransaction,
  FinanceTransaction,
} from '../features/finance/financeTypes'
import { assertFinanceUser, centsToNumeric, numericToCents, throwIfError } from './financeRepositoryUtils'

type Tables = Database['public']['Tables']
type AccountRow = Tables['finance_accounts']['Row']
type CategoryRow = Tables['finance_categories']['Row']
type TransactionRow = Tables['finance_transactions']['Row']
type RecurringRow = Tables['finance_recurring_transactions']['Row']
type RecurringOccurrenceRow = Tables['finance_recurring_occurrences']['Row']
type BudgetRow = Tables['finance_budgets']['Row']
type GoalRow = Tables['finance_goals']['Row']
type ContributionRow = Tables['finance_goal_contributions']['Row']
type GoalItemRow = Tables['finance_goal_items']['Row']
type FundRow = Tables['finance_savings_funds']['Row']
type FundEntryRow = Tables['finance_savings_fund_entries']['Row']
type ClosureRow = Tables['finance_budget_closures']['Row']

const accountFromRow = (row: AccountRow): FinanceAccount => ({
  id: row.id, name: row.name, type: row.type, currency: row.currency,
  initialBalanceCents: numericToCents(row.initial_balance),
  creditLimitCents: row.credit_limit == null ? undefined : numericToCents(row.credit_limit),
  closingDay: row.closing_day ?? undefined, paymentDay: row.payment_day ?? undefined,
  isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
})
const categoryFromRow = (row: CategoryRow): FinanceCategory => ({
  id: row.id, name: row.name, type: row.type, icon: row.icon ?? undefined,
  color: row.color ?? undefined, isDefault: row.is_default, isActive: row.is_active,
})
const transactionFromRow = (row: TransactionRow): FinanceTransaction => ({
  id: row.id, accountId: row.account_id,
  destinationAccountId: row.destination_account_id ?? undefined,
  categoryId: row.category_id ?? undefined, type: row.type,
  amountCents: numericToCents(row.amount), transactionDate: row.transaction_date,
  description: row.description, status: row.status, notes: row.notes ?? undefined,
  recurringTransactionId: row.recurring_transaction_id ?? undefined,
  legacyTransactionId: row.legacy_transaction_id ?? undefined,
  budgetId: row.budget_id ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at,
})
const recurringFromRow = (row: RecurringRow): FinanceRecurringTransaction => ({
  id: row.id, accountId: row.account_id,
  destinationAccountId: row.destination_account_id ?? undefined,
  categoryId: row.category_id ?? undefined, type: row.type,
  amountCents: numericToCents(row.amount), description: row.description,
  frequency: row.frequency, startDate: row.start_date, nextOccurrence: row.next_occurrence,
  endDate: row.end_date ?? undefined, dayOfMonth: row.day_of_month ?? undefined,
  isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
})
const recurringOccurrenceFromRow = (row: RecurringOccurrenceRow): FinanceRecurringOccurrence => ({
  id: row.id, recurringTransactionId: row.recurring_transaction_id,
  period: row.period, expectedDate: row.expected_date, status: row.status,
  amountCents: row.amount == null ? undefined : numericToCents(row.amount),
  description: row.description ?? undefined,
  transactionId: row.transaction_id ?? undefined, paidAt: row.paid_at ?? undefined,
  skippedAt: row.skipped_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
})
const budgetFromRow = (row: BudgetRow): FinanceBudget => ({
  id: row.id, categoryId: row.category_id, month: row.month,
  plannedAmountCents: numericToCents(row.planned_amount),
  name: row.name, periodStart: row.period_start, periodEnd: row.period_end,
  carryOverEnabled: row.carry_over_enabled,
  createdAt: row.created_at, updatedAt: row.updated_at,
})
const goalItemFromRow = (row: GoalItemRow): FinanceGoalItem => ({ id:row.id,goalId:row.goal_id,name:row.name,priceCents:numericToCents(row.price),priority:row.priority,url:row.url??undefined,notes:row.notes??undefined,status:row.status as FinanceGoalItem['status'],purchaseDate:row.purchase_date??undefined,transactionId:row.transaction_id??undefined,createdAt:row.created_at,updatedAt:row.updated_at })
const fundEntryFromRow = (row: FundEntryRow): FinanceSavingsFundEntry => ({ id:row.id,fundId:row.fund_id,amountCents:numericToCents(row.amount),entryDate:row.entry_date,description:row.description??undefined,createdAt:row.created_at })
const closureFromRow = (row: ClosureRow) => ({ id:row.id,budgetId:row.budget_id,leftoverAmountCents:numericToCents(row.leftover_amount),destination:row.destination as 'next_period'|'goal'|'savings_fund'|'available',goalId:row.goal_id??undefined,closedAt:row.closed_at })
const goalFromRow = (row: GoalRow): FinanceGoal => ({
  id: row.id, name: row.name, description: row.description ?? undefined,
  targetAmountCents: numericToCents(row.target_amount),
  targetDate: row.target_date ?? undefined, status: row.status, priority: row.priority,
  linkedAccountId: row.linked_account_id ?? undefined,
  createdAt: row.created_at, updatedAt: row.updated_at,
})
const contributionFromRow = (row: ContributionRow): FinanceGoalContribution => ({
  id: row.id, goalId: row.goal_id, accountId: row.account_id ?? undefined,
  amountCents: numericToCents(row.amount), contributionDate: row.contribution_date,
  notes: row.notes ?? undefined, transactionId: row.transaction_id ?? undefined,
  createdAt: row.created_at,
  contributionSource: 'contribution_source' in row ? (row.contribution_source as FinanceGoalContribution['contributionSource']) : 'previously_reserved',
  description: 'description' in row && row.description ? String(row.description) : undefined,
})

export const financeAccountRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_accounts').select('*')
      .eq('user_id', userId).order('created_at')
    throwIfError(error)
    return (data ?? []).map(accountFromRow)
  },
  async save(account: Omit<FinanceAccount, 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_accounts').upsert({
      id: account.id, user_id: userId, name: account.name, type: account.type,
      currency: account.currency, initial_balance: centsToNumeric(account.initialBalanceCents),
      credit_limit: account.creditLimitCents == null ? null : centsToNumeric(account.creditLimitCents),
      closing_day: account.closingDay ?? null, payment_day: account.paymentDay ?? null,
      is_active: account.isActive,
    }, { onConflict: 'id' }).select().single()
    throwIfError(error)
    return accountFromRow(data!)
  },
  async archive(id: string, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_accounts').update({ is_active: false })
      .eq('id', id).eq('user_id', userId)
    throwIfError(error)
  },
  async restore(id: string, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_accounts').update({ is_active: true })
      .eq('id', id).eq('user_id', userId)
    throwIfError(error)
  },
  async remove(id: string, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_accounts').delete()
      .eq('id', id).eq('user_id', userId)
    if (error?.code === '23503') {
      throw new Error('Esta cuenta conserva movimientos o relaciones. Archívala para mantener el historial.')
    }
    throwIfError(error)
  },
}

export const financeCategoryRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_categories').select('*')
      .eq('user_id', userId).order('type').order('name')
    throwIfError(error)
    return (data ?? []).map(categoryFromRow)
  },
}

export const financeTransactionRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_transactions').select('*')
      .eq('user_id', userId).order('transaction_date', { ascending: false })
    throwIfError(error)
    return (data ?? []).map(transactionFromRow)
  },
  async save(transaction: Omit<FinanceTransaction, 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_transactions').upsert({
      id: transaction.id, user_id: userId, account_id: transaction.accountId,
      destination_account_id: transaction.destinationAccountId ?? null,
      category_id: transaction.categoryId ?? null, type: transaction.type,
      amount: centsToNumeric(transaction.amountCents),
      transaction_date: transaction.transactionDate, description: transaction.description,
      status: transaction.status, notes: transaction.notes ?? null,
      recurring_transaction_id: transaction.recurringTransactionId ?? null,
      legacy_transaction_id: transaction.legacyTransactionId ?? null,
      budget_id: transaction.budgetId ?? null,
    }, { onConflict: 'id' }).select().single()
    throwIfError(error)
    return transactionFromRow(data!)
  },
  async remove(id: string, userId: string) {
    await assertFinanceUser(userId)
    // This RPC also restores a linked recurring occurrence before deletion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('delete_finance_transaction_safely', {
      target_transaction_id: id,
    })
    throwIfError(error)
  },
  async setStatus(id: string, status: FinanceTransaction['status'], userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_transactions').update({ status })
      .eq('id', id).eq('user_id', userId)
    throwIfError(error)
  },
}

export const financeRecurringRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_transactions').select('*')
      .eq('user_id', userId).order('next_occurrence')
    throwIfError(error)
    return (data ?? []).map(recurringFromRow)
  },
  async save(item: Omit<FinanceRecurringTransaction, 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_transactions').upsert({
      id: item.id, user_id: userId, account_id: item.accountId,
      destination_account_id: item.destinationAccountId ?? null,
      category_id: item.categoryId ?? null, type: item.type,
      amount: centsToNumeric(item.amountCents), description: item.description,
      frequency: item.frequency, start_date: item.startDate,
      next_occurrence: item.nextOccurrence, end_date: item.endDate ?? null,
      day_of_month: item.dayOfMonth ?? null, is_active: item.isActive,
    }, { onConflict: 'id' }).select().single()
    throwIfError(error)
    return recurringFromRow(data!)
  },
  async setActive(id: string, isActive: boolean, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_recurring_transactions').update({ is_active: isActive })
      .eq('id', id).eq('user_id', userId)
    throwIfError(error)
  },
  async remove(id: string, userId: string) {
    await assertFinanceUser(userId)
    const { error } = await supabase.from('finance_recurring_transactions').delete()
      .eq('id', id).eq('user_id', userId)
    throwIfError(error)
  },
}

export const financeRecurringOccurrenceRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_occurrences').select('*')
      .eq('user_id', userId).order('period', { ascending: false })
    throwIfError(error)
    return (data ?? []).map(recurringOccurrenceFromRow)
  },
  async ensure(recurringTransactionId: string, period: string, expectedDate: string, userId: string, amountCents?: number) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_occurrences').upsert({
      user_id: userId, recurring_transaction_id: recurringTransactionId,
      period, expected_date: expectedDate,
      amount: amountCents == null ? undefined : centsToNumeric(amountCents),
    }, {
      onConflict: 'user_id,recurring_transaction_id,period',
      ignoreDuplicates: false,
    }).select().single()
    throwIfError(error)
    return recurringOccurrenceFromRow(data!)
  },
  async savePeriod(recurringTransactionId: string, period: string, expectedDate: string, amountCents: number, userId: string, description?: string) {
    await assertFinanceUser(userId)
    // Keeps the occurrence and template's next date in the same transaction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('save_finance_recurring_period', {
      target_recurring_id: recurringTransactionId,
      target_period: period,
      target_expected_date: expectedDate,
      target_amount: centsToNumeric(amountCents),
      target_description: description ?? null,
    })
    throwIfError(error)
  },
  async markPaid(id: string, transactionId: string, userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_occurrences').update({
      status: 'paid', transaction_id: transactionId, paid_at: new Date().toISOString(),
      skipped_at: null,
    }).eq('id', id).eq('user_id', userId).select().single()
    throwIfError(error)
    return recurringOccurrenceFromRow(data!)
  },
  async setStatus(id: string, status: 'pending' | 'skipped' | 'postponed', userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_recurring_occurrences').update({
      status, transaction_id: null, paid_at: null,
      skipped_at: status === 'skipped' ? new Date().toISOString() : null,
    }).eq('id', id).eq('user_id', userId).select().single()
    throwIfError(error)
    return recurringOccurrenceFromRow(data!)
  },
  async register(recurringTransactionId: string, period: string, expectedDate: string, userId: string) {
    await assertFinanceUser(userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('register_finance_recurring_occurrence', {
      target_recurring_id: recurringTransactionId,
      target_period: period,
      target_expected_date: expectedDate,
    })
    throwIfError(error)
    return data as string
  },
  async revert(occurrenceId: string, userId: string) {
    await assertFinanceUser(userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('revert_finance_recurring_occurrence', {
      target_occurrence_id: occurrenceId,
    })
    throwIfError(error)
  },
}

export const financeBudgetRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_budgets').select('*')
      .eq('user_id', userId).order('month', { ascending: false })
    throwIfError(error)
    return (data ?? []).map(budgetFromRow)
  },
  async save(item: Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const periodStart = item.periodStart ?? item.month
    const periodEnd = item.periodEnd ?? item.month
    const { data, error } = await supabase.from('finance_budgets').upsert({
      user_id: userId, category_id: item.categoryId, month: `${periodStart.slice(0, 7)}-01`,
      planned_amount: centsToNumeric(item.plannedAmountCents),
      name:item.name??'Gastos Personales',period_start:periodStart,period_end:periodEnd,carry_over_enabled:item.carryOverEnabled??false,
    }, { onConflict: 'user_id,category_id,period_start,period_end' }).select().single()
    throwIfError(error)
    return budgetFromRow(data!)
  },
}

export const financeGoalRepository = {
  async list(userId: string) {
    await assertFinanceUser(userId)
    const [{ data: goals, error }, { data: contributions, error: contributionError }] = await Promise.all([
      supabase.from('finance_goals').select('*').eq('user_id', userId).order('created_at'),
      supabase.from('finance_goal_contributions').select('*').eq('user_id', userId).order('contribution_date'),
    ])
    throwIfError(error); throwIfError(contributionError)
    return {
      goals: (goals ?? []).map(goalFromRow),
      contributions: (contributions ?? []).map(contributionFromRow),
    }
  },
  async save(item: Omit<FinanceGoal, 'createdAt' | 'updatedAt'>, userId: string) {
    await assertFinanceUser(userId)
    const { data, error } = await supabase.from('finance_goals').upsert({
      id: item.id, user_id: userId, name: item.name, description: item.description ?? null,
      target_amount: centsToNumeric(item.targetAmountCents), target_date: item.targetDate ?? null,
      status: item.status, priority: item.priority, linked_account_id: item.linkedAccountId ?? null,
    }, { onConflict: 'id' }).select().single()
    throwIfError(error)
    return goalFromRow(data!)
  },
  async contribute(item: Omit<FinanceGoalContribution, 'createdAt'>, userId: string) {
    await assertFinanceUser(userId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('register_finance_goal_contribution', {
      target_goal_id: item.goalId, target_amount: centsToNumeric(item.amountCents),
      target_date: item.contributionDate, target_source: item.contributionSource ?? 'previously_reserved',
      target_account_id: item.accountId ?? null, target_description: item.description ?? null,
      target_notes: item.notes ?? null,
    })
    throwIfError(error)
  },
}

export const financePlanningRepository = {
  async list(userId:string) {
    await assertFinanceUser(userId)
    const [fund,entries,items,closures]=await Promise.all([
      supabase.from('finance_savings_funds').select('*').eq('user_id',userId).maybeSingle(),
      supabase.from('finance_savings_fund_entries').select('*').eq('user_id',userId).order('entry_date',{ascending:false}),
      supabase.from('finance_goal_items').select('*').eq('user_id',userId).order('created_at'),
      supabase.from('finance_budget_closures').select('*').eq('user_id',userId),
    ])
    throwIfError(fund.error);throwIfError(entries.error);throwIfError(items.error);throwIfError(closures.error)
    return { savingsFund:fund.data?{id:(fund.data as FundRow).id,name:(fund.data as FundRow).name,createdAt:(fund.data as FundRow).created_at,updatedAt:(fund.data as FundRow).updated_at}:undefined,savingsFundEntries:(entries.data??[]).map(fundEntryFromRow),goalItems:(items.data??[]).map(goalItemFromRow),budgetClosures:(closures.data??[]).map(closureFromRow) }
  },
  async saveFundEntry(item:Omit<FinanceSavingsFundEntry,'createdAt'>,userId:string){ await assertFinanceUser(userId);const {error}=await supabase.from('finance_savings_fund_entries').insert({id:item.id,user_id:userId,fund_id:item.fundId,amount:centsToNumeric(item.amountCents),entry_date:item.entryDate,description:item.description??null});throwIfError(error) },
  async saveGoalItem(item:Omit<FinanceGoalItem,'createdAt'|'updatedAt'>,userId:string){await assertFinanceUser(userId);const {error}=await supabase.from('finance_goal_items').upsert({id:item.id,user_id:userId,goal_id:item.goalId,name:item.name,price:centsToNumeric(item.priceCents),priority:item.priority,url:item.url??null,notes:item.notes??null,status:item.status,purchase_date:item.purchaseDate??null,transaction_id:item.transactionId??null},{onConflict:'id'});throwIfError(error)},
  async removeGoalItem(id:string,userId:string){await assertFinanceUser(userId);const {error}=await supabase.from('finance_goal_items').delete().eq('id',id).eq('user_id',userId);throwIfError(error)},
  async closeBudget(budgetId:string,destination:'next_period'|'goal'|'savings_fund'|'available',goalId:string|undefined,userId:string){await assertFinanceUser(userId);// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const {error}=await(supabase.rpc as any)('close_finance_budget',{target_budget_id:budgetId,target_destination:destination,target_goal_id:goalId??null});throwIfError(error)},
}

export async function loadFinanceData(userId: string): Promise<FinanceData> {
  const [accounts, categories, transactions, recurring, recurringOccurrences, budgets, goalData, planning] = await Promise.allSettled([
    financeAccountRepository.list(userId), financeCategoryRepository.list(userId),
    financeTransactionRepository.list(userId), financeRecurringRepository.list(userId),
    financeRecurringOccurrenceRepository.list(userId), financeBudgetRepository.list(userId),
    financeGoalRepository.list(userId), financePlanningRepository.list(userId),
  ])
  if (accounts.status === 'rejected') throw accounts.reason
  if (categories.status === 'rejected') throw categories.reason
  const reportSecondaryFailure = (section: string, result: PromiseRejectedResult | PromiseFulfilledResult<unknown>) => {
    if (result.status === 'rejected' && import.meta.env.DEV) {
      console.error(`[FARO finance] No se pudo cargar ${section}.`, result.reason)
    }
  }
  reportSecondaryFailure('movimientos', transactions)
  reportSecondaryFailure('recurrentes', recurring)
  reportSecondaryFailure('ocurrencias recurrentes', recurringOccurrences)
  reportSecondaryFailure('presupuestos', budgets)
  reportSecondaryFailure('metas', goalData)
  return {
    accounts: accounts.value,
    categories: categories.value,
    transactions: transactions.status === 'fulfilled' ? transactions.value : [],
    recurring: recurring.status === 'fulfilled' ? recurring.value : [],
    recurringOccurrences: recurringOccurrences.status === 'fulfilled' ? recurringOccurrences.value : [],
    budgets: budgets.status === 'fulfilled' ? budgets.value : [],
    goals: goalData.status === 'fulfilled' ? goalData.value.goals : [],
    contributions: goalData.status === 'fulfilled' ? goalData.value.contributions : [],
    budgetClosures:planning.status==='fulfilled'?planning.value.budgetClosures:[], savingsFund:planning.status==='fulfilled'?planning.value.savingsFund:undefined,
    savingsFundEntries:planning.status==='fulfilled'?planning.value.savingsFundEntries:[],goalItems:planning.status==='fulfilled'?planning.value.goalItems:[],
  }
}
