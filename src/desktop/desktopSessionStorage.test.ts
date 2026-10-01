import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('desktopSessionStorage', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    ;(globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  })

  it('recupera la sesión desde WebView sin consultar el Llavero al arrancar', async () => {
    localStorage.setItem('session', 'recovery-session')
    const { desktopSessionStorage } = await import('./desktopSessionStorage')

    await expect(desktopSessionStorage.getItem('session')).resolves.toBe('recovery-session')
  })

  it('guarda la sesión de escritorio sin provocar una petición al Llavero', async () => {
    const { desktopSessionStorage } = await import('./desktopSessionStorage')

    await desktopSessionStorage.setItem('session', 'new-session')

    expect(localStorage.getItem('session')).toBe('new-session')
  })

  it('cierra sesión aun cuando no hay acceso al Llavero', async () => {
    localStorage.setItem('session', 'stale-session')
    const { desktopSessionStorage } = await import('./desktopSessionStorage')

    await desktopSessionStorage.removeItem('session')

    expect(localStorage.getItem('session')).toBeNull()
  })
})
