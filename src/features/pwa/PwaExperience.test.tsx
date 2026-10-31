import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PwaExperience } from './PwaExperience'
const mocks = vi.hoisted(() => ({ register: undefined as undefined | ((url: string, registration: ServiceWorkerRegistration) => void), refresh: false, update: vi.fn(), setRefresh: vi.fn() }))
vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW: (options: { onRegisteredSW: typeof mocks.register }) => {
  mocks.register = options.onRegisteredSW
  return { needRefresh: [mocks.refresh, mocks.setRefresh], offlineReady: [false, vi.fn()], updateServiceWorker: mocks.update }
} }))
vi.mock('../../core/platform/runtime', () => ({ isFaroTauriRuntime: () => false }))
beforeEach(() => {
  vi.clearAllMocks(); mocks.refresh = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})
describe('PWA update delivery', () => {
  it('checks for updates when returning to the app without forcing a reload', () => {
    render(<PwaExperience />)
    const update = vi.fn().mockResolvedValue(undefined)
    act(() => mocks.register?.('/sw.js', { update } as unknown as ServiceWorkerRegistration))
    fireEvent(document, new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(2)
    expect(mocks.update).not.toHaveBeenCalled()
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    fireEvent(document, new Event('visibilitychange'))
    expect(update).toHaveBeenCalledTimes(2)
  })
  it('only activates a new worker when the user presses Actualizar', () => {
    mocks.refresh = true
    render(<PwaExperience />)
    expect(mocks.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Actualizar$/ }))
    expect(mocks.update).toHaveBeenCalledWith(true)
  })
  it('lets the mobile update action discover a waiting version without clearing stored scenarios', () => {
    localStorage.setItem('saved-scenario', 'keep')
    render(<PwaExperience />)
    act(() => mocks.register?.('/sw.js', { update: vi.fn().mockResolvedValue(undefined), waiting: {} } as unknown as ServiceWorkerRegistration))
    fireEvent(window, new Event('faro:pwa-check-update'))
    expect(mocks.setRefresh).toHaveBeenCalledWith(true)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(localStorage.getItem('saved-scenario')).toBe('keep')
    localStorage.removeItem('saved-scenario')
  })
})
