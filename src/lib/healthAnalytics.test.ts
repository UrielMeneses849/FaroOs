import { describe, expect, it } from 'vitest'
import { forecastWeight } from './healthAnalytics'
import type { HealthLog } from '../types'

const log = (date: string, weightKg: number): HealthLog => ({
  id: date, area: 'health', occurredAt: date, energy: 7, weightKg,
  createdAt: `${date}T12:00:00Z`, updatedAt: `${date}T12:00:00Z`,
})

describe('forecastWeight', () => {
  it('pide más datos antes de proyectar', () => {
    expect(forecastWeight([log('2026-01-01', 80)], 70).status).toBe('insufficient')
  })

  it('detecta una trayectoria hacia la meta', () => {
    const result = forecastWeight([
      log('2026-01-01', 80), log('2026-01-08', 79), log('2026-01-15', 78),
    ], 70, new Date('2026-03-01T12:00:00'))
    expect(result.status).toBe('positive')
    expect(result.weeklyChangeKg).toBe(-1)
  })
})
