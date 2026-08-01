/** Contract reserved for a future Supabase Edge Function. No provider credentials or calls live in the client. */
export interface FinancialPlanningContext {
  period: string
  availableOperatingCents: number
  savingsFundCents: number
  activeGoals: Array<{ id: string; remainingCents: number; targetDate?: string }>
}

export interface FinancialPlanningInsight {
  summary: string
  actions: Array<{ label: string; amountCents?: number; reason: string }>
}

export const financialPlanningEdgeFunction = 'financial-planning-assistant' as const
