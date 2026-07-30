import { describe, expect, it } from 'vitest'
import { demoData } from '../data/mockData'
import { useFaroStore } from '../store'
import { calculateDashboardMetrics, generateWeeklyInsights, weeklySeries } from './personalMetrics'

const reference = new Date('2026-07-23T12:00:00')

describe('dashboard personal', () => {
  it('calcula indicadores conectados correctamente', () => {
    const healthLogs = [
      { ...demoData.journalEntries[0], id: 'metric-health-1', area: 'health' as const, occurredAt: '2026-07-23T08:00:00', energy: 8, mood: 8, trainingMinutes: 30, meditationMinutes: 10 },
      { ...demoData.journalEntries[0], id: 'metric-health-2', area: 'health' as const, occurredAt: '2026-07-22T08:00:00', energy: 7, mood: 7, trainingMinutes: 20, meditationMinutes: 8 },
      { ...demoData.journalEntries[0], id: 'metric-health-3', area: 'health' as const, occurredAt: '2026-07-21T08:00:00', energy: 7, mood: undefined, trainingMinutes: 15, meditationMinutes: 12 },
    ]
    const metrics = calculateDashboardMetrics({ ...demoData, healthLogs }, reference)
    expect(metrics.weeklyStudyMinutes).toBe(140)
    expect(metrics.monthlyBalance).toBe(17150)
    expect(metrics.averageMood7Days).toBe(7.5)
    expect(metrics.trainingDays).toBe(3)
    expect(metrics.meditationMinutes).toBe(30)
  })

  it('genera insights deterministas sin IA', () => {
    const insights = generateWeeklyInsights(demoData, reference)
    expect(insights.length).toBeGreaterThan(0)
    expect(insights.join(' ')).toMatch(/ánimo|estudiaste|tareas/)
  })

  it('maneja gráficas vacías', () => {
    const empty = { ...demoData, studySessions: [], healthLogs: [] }
    const series = weeklySeries(empty, reference)
    expect(series).toHaveLength(7)
    expect(series.every((item) => item.study === 0)).toBe(true)
  })

  it('actualiza métricas del dashboard al registrar datos', () => {
    const before = calculateDashboardMetrics(useFaroStore.getState(), reference).weeklyStudyMinutes
    useFaroStore.getState().createStudySession({ id: 'live-study', area: 'learning', topic: 'React', skill: 'React', durationMinutes: 30, occurredAt: '2026-07-23T14:00:00', createdAt: '2026-07-23T14:00:00', updatedAt: '2026-07-23T14:00:00' })
    const after = calculateDashboardMetrics(useFaroStore.getState(), reference).weeklyStudyMinutes
    expect(after).toBe(before + 30)
  })
})
