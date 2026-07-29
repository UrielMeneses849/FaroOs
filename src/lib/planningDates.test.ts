import { describe, expect, it } from 'vitest'
import { getDeadlineState, isValidDateRange } from './planningDates'

describe('fechas de planificación locales', () => {
  const now = new Date('2026-07-24T23:30:00-06:00')

  it('distingue vencido, próximo y completado sin convertir la fecha a UTC', () => {
    expect(getDeadlineState('2026-07-23', false, now)).toBe('overdue')
    expect(getDeadlineState('2026-07-25', false, now)).toBe('due-soon')
    expect(getDeadlineState('2026-07-23', true, now)).toBe('completed')
  })

  it('valida rangos y permite fechas opcionales', () => {
    expect(isValidDateRange('', '2026-07-25')).toBe(true)
    expect(isValidDateRange('2026-07-26', '2026-07-25')).toBe(false)
  })
})
