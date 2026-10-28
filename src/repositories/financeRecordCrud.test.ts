import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const query = { eq: vi.fn(), is: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() }
  query.eq.mockReturnValue(query); query.is.mockReturnValue(query); query.select.mockReturnValue(query)
  const update = vi.fn(() => query), remove = vi.fn(() => query), upsert = vi.fn()
  return { query, update, remove, upsert, from: vi.fn(() => ({ update, delete: remove, upsert })), getSession: vi.fn(), rpc: vi.fn().mockResolvedValue({ error: null }) }
})
vi.mock('../lib/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession }, from: mocks.from, rpc: mocks.rpc } }))
import { financeCategoryRepository, financeGoalRepository, financePlanningRepository } from './financeRepositories'
import { financeDebtRepository } from './financeDebtRepository'
const contribution = { id: 'contribution', goalId: 'goal', amountCents: 12345, contributionDate: '2026-10-27', createdAt: '' }
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner' } } }, error: null }); mocks.query.maybeSingle.mockResolvedValue({ data: { id: 'record' }, error: null }); mocks.upsert.mockResolvedValue({ error: null }) })
describe('Financial record persistence', () => {
  it('upserts fund edits using the original id instead of inserting a duplicate', async () => {
    await financePlanningRepository.saveFundEntry({ id: 'entry', fundId: 'fund', amountCents: -25000, entryDate: '2026-10-27' }, 'owner')
    expect(mocks.from).toHaveBeenCalledWith('finance_savings_fund_entries')
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry', user_id: 'owner', amount: -250 }), { onConflict: 'id' })
  })
  it('rejects a different authenticated owner before any write', async () => {
    await expect(financePlanningRepository.removeFundEntry('entry', 'somebody-else')).rejects.toThrow()
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('edits only an unlinked contribution owned by the session', async () => {
    await financeGoalRepository.updateReservedContribution(contribution, 'owner')
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ amount: 123.45 }))
    expect(mocks.query.eq).toHaveBeenCalledWith('id', 'contribution')
    expect(mocks.query.eq).toHaveBeenCalledWith('user_id', 'owner')
    expect(mocks.query.is).toHaveBeenCalledWith('transaction_id', null)
  })
  it('requires editing linked contributions through their transaction', async () => {
    await expect(financeGoalRepository.updateReservedContribution({ ...contribution, transactionId: 'ledger' }, 'owner')).rejects.toThrow('movimiento vinculado')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('guards against a contribution becoming linked before deletion', async () => {
    mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(financeGoalRepository.removeReservedContribution('contribution', 'owner')).rejects.toThrow('movimiento vinculado')
    expect(mocks.query.is).toHaveBeenCalledWith('transaction_id', null)
  })
  it('preserves default categories and explains a category with references', async () => {
    mocks.query.maybeSingle.mockResolvedValue({ data: null, error: { code: '23503' } })
    await expect(financeCategoryRepository.remove('category', 'owner')).rejects.toThrow('movimientos o presupuestos vinculados')
    expect(mocks.query.eq).toHaveBeenCalledWith('is_default', false)
    expect(mocks.query.eq).toHaveBeenCalledWith('user_id', 'owner')
  })
})


describe('Plan reservation persistence', () => {
  it('converts cents and sends the original reservation id to its guarded RPC', async () => {
    await financeDebtRepository.reviseEntry({ id: 'reserve', amountCents: -12345, date: '2026-10-20', notes: 'Correction' }, 'owner')
    expect(mocks.rpc).toHaveBeenCalledWith('revise_finance_debt_plan_entry', { target_id: 'reserve', target_amount: -123.45, target_date: '2026-10-20', target_notes: 'Correction', target_remove: false })
  })
  it('does not call the reservation RPC for a foreign owner', async () => {
    await expect(financeDebtRepository.reviseEntry({ id: 'reserve', remove: true }, 'other')).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
