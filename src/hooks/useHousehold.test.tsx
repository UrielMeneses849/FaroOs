import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyHousehold } from '../features/needs/household'
import { useHousehold } from './useHousehold'
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), legacy: vi.fn(), owner: 'one' }))
vi.mock('./auth', () => ({ useAuth: () => ({ user: { id: mocks.owner } }) }))
vi.mock('../repositories/householdRepository', () => ({ householdRepository: { load: mocks.load, save: mocks.save } }))
vi.mock('../repositories/needsRepository', () => ({ needsRepository: { list: mocks.legacy } }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.owner = 'one'
  mocks.load.mockResolvedValue({ revision: 0, state: emptyHousehold() })
  mocks.save.mockResolvedValue(1); mocks.legacy.mockResolvedValue([])
})
describe('household synchronization', () => {
  it('initializes once from legacy records only when no household exists', async () => {
    mocks.load.mockResolvedValue(null)
    const { result } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mocks.save).toHaveBeenCalledWith({ ...emptyHousehold(), importedLegacy: true }, -1)
    expect(mocks.legacy).toHaveBeenCalledWith('one')
  })
  it('requires remote success before changing stock or budget', async () => {
    const { result } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mocks.save.mockRejectedValue(new Error('offline'))
    await act(async () => { await expect(result.current.change(s => ({ ...s, budgetCents: 50000 }))).rejects.toThrow() })
    expect(result.current.state.budgetCents).toBeNull()
  })
  it('reloads a conflicting revision without silently replaying a purchase', async () => {
    const { result } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.loading).toBe(false))
    mocks.save.mockRejectedValue({ code: '40001' })
    mocks.load.mockResolvedValue({ revision: 2, state: { ...emptyHousehold(), budgetCents: 120000 } })
    await act(async () => { await expect(result.current.change(s => ({ ...s, budgetCents: 50000 }))).rejects.toThrow('otro dispositivo') })
    expect(result.current.state.budgetCents).toBe(120000)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })
  it('shows only the matching account cache read-only when offline', async () => {
    localStorage.setItem('faro.needs.household.v1.one', JSON.stringify({ owner: 'one', revision: 3, state: { ...emptyHousehold(), budgetCents: 80000 } }))
    mocks.load.mockRejectedValue(new Error('offline'))
    const { result, rerender } = renderHook(() => useHousehold())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.budgetCents).toBe(80000)
    expect(result.current.readOnly).toBe(true)
    await expect(result.current.change(s => s)).rejects.toThrow()
    mocks.owner = 'two'; rerender()
    expect(result.current.state.budgetCents).toBeNull()
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.state.budgetCents).toBeNull()
  })
})
