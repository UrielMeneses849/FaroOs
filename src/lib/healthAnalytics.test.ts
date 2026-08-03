import { describe, expect, it } from 'vitest'
import type { HealthLog } from '../types'
import { weightGoalProgress, weightProjectionSeries } from './healthAnalytics'

const log = (date: string, weightKg: number, updatedAt = `${date}T12:00:00Z`): HealthLog => ({ id: `${date}-${updatedAt}`, area: 'health', occurredAt: date, energy: 7, weightKg, createdAt: updatedAt, updatedAt })
const target = new Date('2026-12-31T12:00:00')
const now = new Date('2026-08-01T12:00:00')

describe('weightGoalProgress', () => {
  it('no proyecta con menos de tres registros y normaliza duplicados diarios', () => {
    const logs = [log('2026-08-01', 80, '2026-08-01T08:00:00Z'), log('2026-08-01', 79, '2026-08-01T20:00:00Z'), log('2026-08-02', 78)]
    const series = weightProjectionSeries(logs, new Date('2026-09-01T12:00:00'), new Date('2026-08-03T12:00:00'))
    expect(series).toHaveLength(2)
    expect(series[0].actual).toBe(79)
  })
  it('genera una serie futura punteada a partir de tres registros', () => {
    const logs = [log('2026-07-15', 82), log('2026-07-25', 81), log('2026-08-02', 80)]
    const series = weightProjectionSeries(logs, new Date('2026-08-10T12:00:00'), new Date('2026-08-03T12:00:00'))
    expect(series.filter((point) => point.actual != null)).toHaveLength(3)
    expect(series.some((point) => point.projected != null)).toBe(true)
    expect(series.at(-1)?.date).toBe('2026-08-10')
  })
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
