import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const single = vi.fn()
  const select = vi.fn(() => ({ single }))
  const upsert = vi.fn(() => ({ select }))
  const from = vi.fn(() => ({ upsert }))
  const getSession = vi.fn()
  return { from, getSession, select, single, upsert }
})

vi.mock('../lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    from: mocks.from,
  },
}))

import { financeCategoryRepository } from './financeRepositories'

const savedCategory = {
  id: 'debts-category', user_id: 'user-1', name: 'Deudas', type: 'expense' as const,
  icon: null, color: null, is_default: false, is_active: true,
  created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
}

describe('financeCategoryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
    mocks.single.mockResolvedValue({ data: savedCategory, error: null })
  })

  it('persiste una categoría creada por la persona y la devuelve activa', async () => {
    const saved = await financeCategoryRepository.save({
      id: 'debts-category', name: ' Deudas ', type: 'expense', isDefault: false, isActive: true,
    }, 'user-1')

    expect(mocks.from).toHaveBeenCalledWith('finance_categories')
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      id: 'debts-category', user_id: 'user-1', name: 'Deudas', type: 'expense', is_default: false, is_active: true,
    }), { onConflict: 'id' })
    expect(saved).toMatchObject({ id: 'debts-category', name: 'Deudas', type: 'expense', isActive: true })
  })
})
