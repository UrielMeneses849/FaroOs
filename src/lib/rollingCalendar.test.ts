import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import { relativeDayLabel, rollingWeekRange } from './rollingCalendar'

describe('rollingWeek', () => {
  it('coloca ayer primero y hoy segundo durante siete días reales', () => {
    const range = rollingWeekRange(new Date(2026, 6, 24, 15))
    expect(format(range.start, 'yyyy-MM-dd')).toBe('2026-07-23')
    expect(format(range.end, 'yyyy-MM-dd')).toBe('2026-07-30')
  })

  it('etiqueta ayer, hoy y mañana sin cambiar fechas', () => {
    const today = new Date(2026, 6, 24, 12)
    expect(relativeDayLabel(new Date(2026, 6, 23), today)).toBe('AYER')
    expect(relativeDayLabel(new Date(2026, 6, 24), today)).toBe('HOY')
    expect(relativeDayLabel(new Date(2026, 6, 25), today)).toBe('MAÑANA')
  })
})
