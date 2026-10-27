import type { FinanceFrequency } from './financeTypes'

export interface FinanceDebt {
  id: string
  name: string
  creditor: string
  kind: 'purchase' | 'loan' | 'negotiable'
  status: 'active' | 'paused' | 'archived'
  balanceCents: number
  balanceDate: string
  paymentCents: number
  frequency: FinanceFrequency
  nextPaymentDate: string
  deadline?: string
  settlementCents?: number
  quoteDate?: string
  quoteValidUntil?: string
  agreementCents?: number
  agreementDate?: string
  agreementPayments?: number
  agreementStatus: 'none' | 'proposed' | 'confirmed'
  priority: number
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface DebtPlanEntry {
  id: string
  accountId: string
  amountCents: number
  entryDate: string
  notes?: string
  createdAt: string
}

export interface DebtPlanPreferences {
  monthlyContributionCents: number
  contributionDay: number
  targetDate: string
  strategy: 'minimum' | 'balanced' | 'fast'
}

export interface DebtPlanData {
  debts: FinanceDebt[]
  entries: DebtPlanEntry[]
  preferences: DebtPlanPreferences
}

export const defaultDebtPlanPreferences = (): DebtPlanPreferences => ({
  monthlyContributionCents: 0,
  contributionDay: 15,
  targetDate: `${new Date().getFullYear()}-12-31`,
  strategy: 'balanced',
})
