import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankProduct, emptyHousehold, shoppingSaturday } from './household'
import { NeedsWeekendReport } from './NeedsWeekendReport'
const mocks = vi.hoisted(() => ({ load: vi.fn(), owner: 'one' }))
vi.mock('../../hooks/auth', () => ({ useAuth: () => ({ user: { id: mocks.owner } }) }))
vi.mock('../../repositories/householdRepository', () => ({ householdRepository: { load: mocks.load } }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.owner = 'one'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 30, 12))
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  mocks.load.mockResolvedValue({ revision: 0, state: { ...emptyHousehold(), products: [{ ...blankProduct(), name: 'Arroz' }] } })
})
afterEach(() => vi.useRealTimers())
describe('weekend replenishment report', () => {
  it('shows a Friday report with unknown prices clearly identified', async () => {
    render(<NeedsWeekendReport />)
    expect(await screen.findByText(/1 producto por reponer/)).toHaveTextContent('1 sin precio')
    expect(screen.getByRole('link', { name: 'Revisar reporte y lista' })).toHaveAttribute('href', '/needs')
  })
  it('does not fetch or display a weekend report on Monday', async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 12))
    render(<NeedsWeekendReport />)
    await act(async () => {})
    expect(mocks.load).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
  it('respects per-account and per-week dismissal', async () => {
    localStorage.setItem(`faro.needs.report.dismissed.one.${shoppingSaturday()}`, 'true')
    const { rerender } = render(<NeedsWeekendReport />)
    expect(mocks.load).not.toHaveBeenCalled()
    mocks.owner = 'two'; rerender(<NeedsWeekendReport />)
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })
  it('clears the report when inventory no longer needs replenishment', async () => {
    render(<NeedsWeekendReport />)
    expect(await screen.findByRole('status')).toBeInTheDocument()
    mocks.load.mockResolvedValue({ revision: 1, state: emptyHousehold() })
    act(() => { window.dispatchEvent(new Event('faro:household-updated')) })
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
})
