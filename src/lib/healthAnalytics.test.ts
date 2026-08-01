import { describe, expect, it } from 'vitest'
import type { HealthLog } from '../types'
import { weightGoalProgress } from './healthAnalytics'

const log = (date: string, weightKg: number, updatedAt = `${date}T12:00:00Z`): HealthLog => ({ id: `${date}-${updatedAt}`, area: 'health', occurredAt: date, energy: 7, weightKg, createdAt: updatedAt, updatedAt })
const target = new Date('2026-12-31T12:00:00')
const now = new Date('2026-08-01T12:00:00')

describe('weightGoalProgress', () => {
  it('pide tres mediciones recientes', () => expect(weightGoalProgress([log('2026-07-31', 85)], 75, target, now).status).toBe('insufficient'))
  it('usa sólo el último registro de un día', () => {
    const result = weightGoalProgress([log('2026-07-20', 86), log('2026-07-25', 85), log('2026-07-31', 84.5, '2026-07-31T08:00:00Z'), log('2026-07-31', 84, '2026-07-31T20:00:00Z')], 75, target, now)
    expect(result.measurements).toBe(3); expect(result.currentKg).toBe(84)
  })
  it('calcula regresión y fecha estimada sin proyectar un peso absurdo', () => {
    const result = weightGoalProgress([log('2026-07-10', 86), log('2026-07-20', 85), log('2026-07-30', 84)], 75, target, now)
    expect(result.recentWeeklyKg).toBe(-0.7); expect(result.estimatedCompletionDate).toMatch(/^2026-/); expect(result.status).toBe('ahead')
  })
})
