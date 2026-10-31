import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FinanceData } from '../features/finance/financeTypes'
import { useFinanceForecastJournal } from './useFinanceForecastJournal'

const mocks = vi.hoisted(() => ({ load: vi.fn(), hasWeek: vi.fn(), capture: vi.fn(), build: vi.fn() }))
vi.mock('../services/financeDecisionTools', () => ({ buildFinanceDecisionReport: mocks.build }))
vi.mock('../services/financeForecastJournal', () => ({ loadFinanceForecastJournal: mocks.load, hasFinanceForecastSnapshotForWeek: mocks.hasWeek, captureFinanceForecastJournal: mocks.capture }))
const data = { accounts: [{ id: 'account' }] } as FinanceData
beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockReturnValue({ status: 'ready', entries: [] })
  mocks.hasWeek.mockReturnValue(false)
  mocks.build.mockReturnValue({ report: 'real' })
  mocks.capture.mockReturnValue({ status: 'ready', entries: [], captured: true })
})
describe('weekly real forecast capture', () => {
  it('waits for trusted loaded data and never captures while simulation is enabled', async () => {
    const { rerender } = renderHook(({ loading, simulated }) => useFinanceForecastJournal(data, 'owner', loading, null, simulated), { initialProps: { loading: true, simulated: false } })
    await waitFor(() => expect(mocks.load).toHaveBeenCalled())
    expect(mocks.capture).not.toHaveBeenCalled()
    rerender({ loading: false, simulated: true })
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2))
    expect(mocks.build).not.toHaveBeenCalled()
    rerender({ loading: false, simulated: false })
    await waitFor(() => expect(mocks.capture).toHaveBeenCalledWith('owner', { report: 'real' }))
    expect(mocks.build).toHaveBeenCalledWith(data)
  })
  it('does not recalculate or overwrite an existing weekly snapshot', async () => {
    mocks.hasWeek.mockReturnValue(true)
    renderHook(() => useFinanceForecastJournal(data, 'owner', false, null, false))
    await waitFor(() => expect(mocks.hasWeek).toHaveBeenCalled())
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.build).not.toHaveBeenCalled()
  })
  it('preserves unreadable history and exposes its message', async () => {
    mocks.load.mockReturnValue({ status: 'invalid', entries: [], message: 'Respaldo conservado' })
    const { result } = renderHook(() => useFinanceForecastJournal(data, 'owner', false, null, false))
    await waitFor(() => expect(result.current.message).toBe('Respaldo conservado'))
    expect(mocks.capture).not.toHaveBeenCalled()
  })
})
