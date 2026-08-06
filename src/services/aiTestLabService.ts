import { supabase } from '../lib/supabase/client'

export interface AiTestBaseline {
  id: string
  captured_at: string
  period_start: string
  period_end: string
  available_operating: number
  real_balance: number
  projected_balance: number
  period_expenses: number
  personal_budget_consumed: number
}

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc

function baselineFrom(value: unknown): AiTestBaseline {
  if (!value || typeof value !== 'object') throw new Error('Supabase devolvió una línea base inválida.')
  return value as AiTestBaseline
}

export const aiTestLabService = {
  async prepare(nuBalance: number, bbvaBalance: number, personalBudget: number) {
    const { data, error } = await rpc('prepare_ai_test_environment', {
      p_nu_balance: nuBalance,
      p_bbva_balance: bbvaBalance,
      p_personal_budget: personalBudget,
      p_confirm_is_test_user: true,
    })
    if (error) throw new Error(error.message)
    const result = data as { baseline?: unknown }
    return baselineFrom(result.baseline)
  },
  async captureBaseline() {
    const { data, error } = await rpc('capture_ai_test_baseline')
    if (error) throw new Error(error.message)
    return baselineFrom(data)
  },
  async restoreScenario() {
    const { data, error } = await rpc('restore_ai_finance_scenario', { p_confirm_is_test_user: true })
    if (error) throw new Error(error.message)
    return data
  },
}
