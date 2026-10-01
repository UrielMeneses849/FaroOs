import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFaroRuntimeForTests } from '../core/platform/runtime'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), state: { tasks: [], projects: [], goals: [] } }))
vi.mock('../lib/supabase/client', () => ({ supabase: { functions: { invoke: mocks.invoke } } }))
vi.mock('../store/useFaroStore', () => ({ useFaroStore: { getState: () => mocks.state } }))

import { voiceService } from './voiceService'

describe('voiceService production surface routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue({ data: { status: 'completed', message: 'Listo', questions: [] }, error: null })
  })

  afterEach(() => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    resetFaroRuntimeForTests()
  })

  it('envía Finance productivo por faro-voice como surface web con su contexto de página', async () => {
    await voiceService.send('Gasté 350 en comida.', 'voice', [], 'finances')
    expect(mocks.invoke).toHaveBeenCalledWith('faro-voice', expect.objectContaining({
      body: expect.objectContaining({ surface: 'web', pageSurface: 'finances', pipeline: 'optimized' }),
    }))
  })

  it('mantiene Lab como superficie lab y permite futuros clientes desktop/mobile', async () => {
    await voiceService.send('¿Qué tengo mañana?', 'text', [], 'lab')
    await voiceService.send('¿Qué tengo mañana?', 'text', [], 'today', { runtimeSurface: 'desktop' })
    expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({ surface: 'lab', pageSurface: 'lab' })
    expect(mocks.invoke.mock.calls[1][1].body).toMatchObject({ surface: 'desktop', pageSurface: 'today' })
  })

  it('detecta Tauri y etiqueta automáticamente Voice productivo como desktop', async () => {
    ;(globalThis as typeof globalThis & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {}
    await voiceService.send('¿Qué tengo mañana?', 'voice', [], 'today')
    expect(mocks.invoke).toHaveBeenCalledWith('faro-voice', expect.objectContaining({
      body: expect.objectContaining({ surface: 'desktop', pageSurface: 'today' }),
    }))
  })
})
