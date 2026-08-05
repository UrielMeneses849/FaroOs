import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase/client', () => ({ supabase: { functions: { invoke } } }))

import { googleCalendarService } from './googleCalendarService'

describe('Google Calendar service', () => {
  beforeEach(() => invoke.mockReset())

  it('expone errores de autorización como recuperables sin abrir conexiones externas', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } })
    await expect(googleCalendarService.status()).rejects.toThrow('Edge Function returned a non-2xx status code')
    expect(invoke).toHaveBeenCalledWith('google-calendar-api', { body: { action: 'status' } })
  })

  it('expone el mensaje estructurado devuelto por la Edge Function', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: new Response(JSON.stringify({
          error: 'google_events_failed',
          message: 'Google no permitió leer este calendario.',
          googleStatus: 403,
          googleReason: 'insufficientPermissions',
        }), { status: 403, headers: { 'Content-Type': 'application/json' } }),
      },
    })
    await expect(googleCalendarService.events('2026-08-01', '2026-08-02', true))
      .rejects.toThrow('Google no permitió leer este calendario.')
  })
})
