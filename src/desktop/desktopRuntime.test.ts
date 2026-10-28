import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FARO_DESKTOP_NAVIGATE_EVENT } from '../features/voice/desktopVoiceEvents'

const mocks = vi.hoisted(() => ({
  nativeListeners: new Map<string, (event: { payload: unknown }) => void>(),
  navigate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((name: string, callback: (event: { payload: unknown }) => void) => {
    mocks.nativeListeners.set(name, callback)
    return Promise.resolve(() => mocks.nativeListeners.delete(name))
  }),
}))
vi.mock('../app/router', () => ({ router: { navigate: mocks.navigate } }))
vi.mock('../core/voice/adapters', () => ({ getConfiguredFaroVoiceAdapters: () => ({}) }))
vi.mock('./desktopBridge', () => ({
  getDesktopPreferences: vi.fn().mockResolvedValue(undefined),
  publishFaroDesktopVoiceSnapshot: vi.fn().mockResolvedValue(undefined),
  showFaroMini: vi.fn().mockResolvedValue(undefined),
  updateDesktopPreferences: vi.fn().mockResolvedValue(undefined),
}))

describe('native FARO navigation', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.nativeListeners.clear()
    const { installFaroDesktopRuntime } = await import('./desktopRuntime')
    installFaroDesktopRuntime()
  })

  it.each([
    '/finance', '/calendar', '/backlog', '/settings', '/today',
    '/backlog?quick=task', '/finance?quick=movement',
  ])('opens %s without dropping its quick action', (route) => {
    const received: unknown[] = []
    const onNavigate = (event: Event) => received.push((event as CustomEvent).detail)
    window.addEventListener(FARO_DESKTOP_NAVIGATE_EVENT, onNavigate)
    try {
      mocks.nativeListeners.get('faro://navigate')!({ payload: route })
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(route)
      expect(received).toEqual([route])
    } finally {
      window.removeEventListener(FARO_DESKTOP_NAVIGATE_EVENT, onNavigate)
    }
  })

  it.each([
    '', '/dashboard', '/today/', '/TODAY', ' /today', '/today?quick=task',
    '/finance?quick=expense', '/backlog?quick=task&extra=1',
    '/finance?quick=movement#details', '/settings?quick=task',
    '/backlog?quick=%74ask', 'https://example.com/finance', '//example.com',
    'javascript:alert(1)', null, undefined, 42, {},
  ])('rejects an unapproved payload: %j', (payload) => {
    const onNavigate = vi.fn()
    window.addEventListener(FARO_DESKTOP_NAVIGATE_EVENT, onNavigate)
    try {
      mocks.nativeListeners.get('faro://navigate')!({ payload })
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(onNavigate).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(FARO_DESKTOP_NAVIGATE_EVENT, onNavigate)
    }
  })
})
