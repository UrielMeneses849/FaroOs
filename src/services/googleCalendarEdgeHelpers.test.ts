import { describe, expect, it } from 'vitest'
import { calendarAppUrl, googleErrorDetails, googleEventsUrl } from '../../supabase/functions/_shared/googleCalendarPure'

describe('Google Calendar Edge helpers', () => {
  it('preserva el subpath de APP_URL al construir el callback', () => {
    expect(calendarAppUrl('https://urielmeneses849.github.io/FaroOs', 'connected').toString())
      .toBe('https://urielmeneses849.github.io/FaroOs/calendar?googleCalendar=connected')
  })

  it('codifica un calendarId con correo en la ruta de events.list', () => {
    const url = googleEventsUrl('equipo.bbva@example.com', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'))
    expect(url).toContain('/calendars/equipo.bbva%40example.com/events?')
    expect(url).toContain('timeZone=America%2FMexico_City')
  })

  it('codifica caracteres reservados del calendarId sin alterar el identificador', () => {
    const url = googleEventsUrl('shared#team/group@example.com', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z'))
    expect(url).toContain('/calendars/shared%23team%2Fgroup%40example.com/events?')
  })

  it('extrae un error estructurado de Google', () => {
    expect(googleErrorDetails(403, { error: { message: 'Forbidden', errors: [{ reason: 'insufficientPermissions' }] } }))
      .toEqual({ status: 403, reason: 'insufficientPermissions', message: 'Forbidden' })
  })
})
