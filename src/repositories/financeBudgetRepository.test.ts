import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const select = vi.fn(() => ({ single }))
  const upsert = vi.fn(() => ({ select }))
  const match = vi.fn()
  const remove = vi.fn(() => ({ match }))
  const from = vi.fn(() => ({ upsert, delete: remove }))
  const getSession = vi.fn()
  return { from, getSession, match, remove, select, single, upsert }
})

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  },
}))

import { financeBudgetRepository } from './financeRepositories'
import { throwIfError } from './financeRepositoryUtils'

const savedBudget = {
  id: 'budget-1', user_id: 'user-1', category_id: 'personal', month: '2026-08-01',
  planned_amount: 1000, name: 'Gastos Personales', period_start: '2026-08-01',
  period_end: '2026-08-15', carry_over_enabled: false,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
}

describe('financeBudgetRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
    mocks.single.mockResolvedValue({ data: savedBudget, error: null })
    mocks.match.mockResolvedValue({ error: null })
  })

  it('guarda ambas quincenas del mismo mes con la identidad del período', async () => {
    await financeBudgetRepository.save({
      categoryId: 'personal', month: '2026-08-01', plannedAmountCents: 100_000,
      name: 'Gastos Personales', periodStart: '2026-08-01', periodEnd: '2026-08-15', carryOverEnabled: false,
    }, 'user-1')
    await financeBudgetRepository.save({
      categoryId: 'personal', month: '2026-08-01', plannedAmountCents: 100_000,
      name: 'Gastos Personales', periodStart: '2026-08-16', periodEnd: '2026-08-31', carryOverEnabled: false,
    }, 'user-1')

    expect(mocks.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      period_start: '2026-08-01', period_end: '2026-08-15', month: '2026-08-01',
    }), { onConflict: 'user_id,category_id,period_start,period_end' })
    expect(mocks.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      period_start: '2026-08-16', period_end: '2026-08-31', month: '2026-08-01',
    }), { onConflict: 'user_id,category_id,period_start,period_end' })
  })

  it('edita de forma idempotente al guardar dos veces el mismo período', async () => {
    const item = {
      categoryId: 'personal', month: '2026-08-01', plannedAmountCents: 125_000,
      name: 'Gastos Personales', periodStart: '2026-08-01', periodEnd: '2026-08-15', carryOverEnabled: false,
    }
    await financeBudgetRepository.save(item, 'user-1')
    await financeBudgetRepository.save(item, 'user-1')

    expect(mocks.upsert).toHaveBeenCalledTimes(2)
    expect(mocks.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ planned_amount: 1250 }), {
      onConflict: 'user_id,category_id,period_start,period_end',
    })
  })

  it('traduce un duplicate key residual sin exponer SQL al usuario', () => {
    expect(() => throwIfError({
      code: '23505', message: 'duplicate key value violates unique constraint',
    })).toThrow('Ya existe un registro para estos datos.')
  })

  it('elimina únicamente el presupuesto del usuario autenticado', async () => {
    await financeBudgetRepository.remove('budget-1', 'user-1')

    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(mocks.match).toHaveBeenCalledWith({ id: 'budget-1', user_id: 'user-1' })
  })
})
