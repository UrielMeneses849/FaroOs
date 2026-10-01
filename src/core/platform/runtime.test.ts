import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureFaroRuntime, getFaroRuntimeSurface, getFaroSessionStorage, resetFaroRuntimeForTests } from './runtime'

describe('FARO runtime multiplataforma', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    vi.unstubAllGlobals()
    resetFaroRuntimeForTests()
  })

  it('detecta Tauri como desktop y conserva Lab como surface explícita', () => {
    ;(globalThis as typeof globalThis & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {}
    expect(getFaroRuntimeSurface()).toBe('desktop')
    expect(getFaroRuntimeSurface('lab')).toBe('lab')
  })

  it('acepta storage async para una futura implementación Tauri Stronghold/Store', async () => {
    const values = new Map<string, string>()
    configureFaroRuntime({ sessionStorage: {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => { values.set(key, value) },
      removeItem: async (key) => { values.delete(key) },
    } })
    const storage = getFaroSessionStorage()
    await storage.setItem('faro-auth', 'session')
    expect(await storage.getItem('faro-auth')).toBe('session')
  })

  it('reconoce el origen nativo aunque WebKit publique el bridge después', () => {
    vi.stubGlobal('location', { protocol: 'tauri:' })
    expect(getFaroRuntimeSurface()).toBe('desktop')
  })
})
