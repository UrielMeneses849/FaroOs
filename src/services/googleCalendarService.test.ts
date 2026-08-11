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

  it('envía disponibilidad con zona horaria explícita', async () => {
    invoke.mockResolvedValue({data:{busy:[]},error:null})
    await expect(googleCalendarService.freeBusy('2026-08-09T13:00:00Z','2026-08-09T23:00:00Z','America/Mexico_City')).resolves.toEqual({busy:[]})
    expect(invoke).toHaveBeenCalledWith('google-calendar-api',{body:{action:'freebusy',timeMin:'2026-08-09T13:00:00Z',timeMax:'2026-08-09T23:00:00Z',timeZone:'America/Mexico_City'}})
  })

  it('no expone operaciones de escritura sobre Google Calendar', () => {
    expect('insertEvent' in googleCalendarService).toBe(false)
    expect('patchEvent' in googleCalendarService).toBe(false)
    expect('deleteEvent' in googleCalendarService).toBe(false)
  })
})
