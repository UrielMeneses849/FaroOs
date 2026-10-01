import { describe, expect, it } from 'vitest'
import { assessFinanceDuplicate, financeDuplicateScore } from '../../supabase/functions/_shared/voice/financeDuplicate'

const proposal = {
  type: 'expense' as const,
  amount: 150,
  date: '2026-08-15',
  accountId: 'account-1',
  categoryId: 'food',
  description: 'Comida de Kira',
}

describe('duplicate confidence de FARO Finance Voice', () => {
  it('no marca como duplicado Recarga $150 frente a Comida de Kira $150', () => {
    const score = financeDuplicateScore(proposal, {
      id: 'candidate-1', type: 'expense', amount: 150, transaction_date: '2026-08-15', account_id: 'account-1', category_id: 'subscriptions', description: 'Recarga',
    })
    expect(score).toBeLessThan(.7)
    expect(assessFinanceDuplicate(proposal, [{ id: 'candidate-1', type: 'expense', amount: 150, transaction_date: '2026-08-15', account_id: 'account-1', category_id: 'subscriptions', description: 'Recarga' }])).toBeUndefined()
  })

  it('solicita confirmación de duplicado sólo con similitud alta', () => {
    const match = assessFinanceDuplicate(proposal, [{
      id: 'candidate-2', type: 'expense', amount: 150, transaction_date: '2026-08-15', account_id: 'account-1', category_id: 'food', description: 'Comida de Kira',
    }])
    expect(match).toMatchObject({ confidence: 'high' })
    expect(match?.score).toBeGreaterThanOrEqual(.86)
  })

  it('distingue una coincidencia media sin bloquear la propuesta', () => {
    const match = assessFinanceDuplicate(proposal, [{
      id: 'candidate-3', type: 'expense', amount: 150, transaction_date: '2026-08-15', account_id: 'account-1', category_id: 'food', description: 'Comida con Ana',
    }])
    expect(match).toMatchObject({ confidence: 'medium' })
  })
})
