import { describe, expect, it } from 'vitest'
import { formatTimeForSpeech } from '../../supabase/functions/_shared/voice/timeForSpeech'

describe('formatTimeForSpeech', () => {
  it.each([
    ['08:00', '8 de la mañana'],
    ['09:30', '9 y media de la mañana'],
    ['10:15', '10 y cuarto de la mañana'],
    ['12:00', '12 del día'],
    ['13:00', '1 de la tarde'],
    ['14:30', '2 y media de la tarde'],
    ['17:00', '5 de la tarde'],
    ['19:00', '7 de la noche'],
    ['21:30', '9 y media de la noche'],
    ['00:00', '12 de la noche'],
  ])('convierte %s en %s', (value, expected) => {
    expect(formatTimeForSpeech(value)).toBe(expected)
  })

  it('formatea timestamps conservando la zona horaria', () => {
    expect(formatTimeForSpeech('2026-08-09T18:00:00.000Z', 'America/Mexico_City')).toBe('12 del día')
  })
})
