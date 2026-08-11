import { describe, expect, it } from 'vitest'
import { assertFaroCalendarMutation } from '../../supabase/functions/_shared/voice/calendarAuthorization'

describe('autorización de mutaciones Calendar', () => {
  it('permite únicamente entidades internas FARO', () => {
    expect(() => assertFaroCalendarMutation({ provider: 'faro', targetKind: 'event' })).not.toThrow()
    expect(() => assertFaroCalendarMutation({ provider: 'faro', targetKind: 'task' })).not.toThrow()
  })

  it.each([
    { provider: 'google', targetKind: 'google' },
    { provider: 'google', targetKind: 'event' },
    { provider: 'faro', targetKind: 'google' },
  ])('rechaza escrituras Google incluso con argumentos manipulados', (args) => {
    expect(() => assertFaroCalendarMutation(args)).toThrow('Google Calendar es de solo lectura.')
  })
})
