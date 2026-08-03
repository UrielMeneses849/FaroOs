export type FinanceAccountType = 'cash' | 'checking' | 'savings' | 'credit' | 'investment' | 'loan'
export type FinanceCategoryType = 'income' | 'expense' | 'saving' | 'debt' | 'transfer'
export type FinanceTransactionType = 'income' | 'expense' | 'transfer' | 'saving' | 'debt_payment' | 'refund'
export type FinanceTransactionStatus = 'planned' | 'pending' | 'completed' | 'cancelled'
export type FinanceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
export type FinanceGoalStatus = 'active' | 'paused' | 'completed' | 'cancelled'
export type FinanceGoalPriority = 'low' | 'medium' | 'high' | 'critical'
export type FinanceRecurringOccurrenceStatus = 'pending' | 'paid' | 'skipped' | 'postponed'

export interface FinanceAccount {
  id: string
  name: string
  type: FinanceAccountType
  currency: string
  initialBalanceCents: number
  creditLimitCents?: number
  closingDay?: number
  paymentDay?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface FinanceCategory {
  id: string
  name: string
  type: FinanceCategoryType
  icon?: string
  color?: string
  isDefault: boolean
  isActive: boolean
}

export interface FinanceTransaction {
  id: string
  accountId: string
  destinationAccountId?: string
  categoryId?: string
  type: FinanceTransactionType
  amountCents: number
  transactionDate: string
  description: string
  status: FinanceTransactionStatus
  notes?: string
  recurringTransactionId?: string
  legacyTransactionId?: string
  budgetId?: string
  createdAt: string
  updatedAt: string
}

export interface FinanceRecurringTransaction {
  id: string
  accountId: string
  destinationAccountId?: string
  categoryId?: string
  type: FinanceTransactionType
  amountCents: number
  description: string
  frequency: FinanceFrequency
  startDate: string
  nextOccurrence: string
  endDate?: string
  dayOfMonth?: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface FinanceRecurringOccurrence {
  id: string
  recurringTransactionId: string
  period: string
  expectedDate: string
  amountCents?: number
  description?: string
  status: FinanceRecurringOccurrenceStatus
  transactionId?: string
  paidAt?: string
  skippedAt?: string
  createdAt: string
  updatedAt: string
}

export interface FinanceBudget {
  id: string
  categoryId: string
  month: string
  plannedAmountCents: number
  name?: string
  periodStart?: string
  periodEnd?: string
  carryOverEnabled?: boolean
  createdAt: string
  updatedAt: string
}

export interface FinanceBudgetClosure { id:string; budgetId:string; leftoverAmountCents:number; destination:'next_period'|'goal'|'savings_fund'|'available'; goalId?:string; closedAt:string }
export interface FinanceSavingsFund { id:string; name:string; createdAt:string; updatedAt:string }
export interface FinanceSavingsFundEntry { id:string; fundId:string; amountCents:number; entryDate:string; description?:string; createdAt:string }
export interface FinanceGoalItem { id:string; goalId:string; name:string; priceCents:number; priority:FinanceGoalPriority; url?:string; notes?:string; status:'pending'|'purchased'|'discarded'; purchaseDate?:string; transactionId?:string; createdAt:string; updatedAt:string }

export interface FinanceGoal {
  id: string
  name: string
  description?: string
  targetAmountCents: number
  targetDate?: string
  status: FinanceGoalStatus
  priority: FinanceGoalPriority
  linkedAccountId?: string
  createdAt: string
  updatedAt: string
}

export interface FinanceGoalContribution {
  id: string
  goalId: string
  accountId?: string
  amountCents: number
  contributionDate: string
  notes?: string
  transactionId?: string
  contributionSource?: 'from_account' | 'previously_reserved'
  description?: string
  createdAt: string
}

export interface FinanceData {
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  transactions: FinanceTransaction[]
  recurring: FinanceRecurringTransaction[]
  recurringOccurrences: FinanceRecurringOccurrence[]
  budgets: FinanceBudget[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  budgetClosures: FinanceBudgetClosure[]
  savingsFund?: FinanceSavingsFund
  savingsFundEntries: FinanceSavingsFundEntry[]
  goalItems: FinanceGoalItem[]
}

export interface FinanceMetrics {
  monthlyIncomeCents: number
  monthlyExpensesCents: number
  monthlySavingsCents: number
  availableBalanceCents: number
  totalMoneyCents: number
  projectedBalanceCents: number
  actualBalanceCents: number
  budgetVarianceCents: number
  savingsRate: number
}
