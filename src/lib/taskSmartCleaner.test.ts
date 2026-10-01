import { describe, expect, it } from 'vitest'
import { evaluateSmartCleaner, isTaskEligibleForSmartCleaning } from './taskSmartCleaner'

const now = new Date('2026-08-15T18:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString()

describe('Smart Cleaner policy', () => {
  it('limpia done completada hace tres días', () => expect(isTaskEligibleForSmartCleaning({ id: 'old', status: 'done', completedAt: daysAgo(3) }, now)).toBe(true))
  it('conserva done completada hace dos días', () => expect(isTaskEligibleForSmartCleaning({ id: 'recent', status: 'done', completedAt: daysAgo(2) }, now)).toBe(false))
  it('nunca limpia doing aunque tenga una fecha antigua', () => expect(isTaskEligibleForSmartCleaning({ id: 'doing', status: 'doing', completedAt: daysAgo(4) }, now)).toBe(false))
  it('limpia una done sin calendario', () => expect(isTaskEligibleForSmartCleaning({ id: 'no-calendar', status: 'done', completedAt: daysAgo(3) }, now)).toBe(true))
  it('limpia una done sin due date', () => expect(isTaskEligibleForSmartCleaning({ id: 'no-due', status: 'done', completedAt: daysAgo(3) }, now)).toBe(true))
  it('reporta legacy done sin completed_at como omitida hasta el backfill', () => expect(evaluateSmartCleaner([{ id: 'legacy', status: 'done' }], now).metrics).toMatchObject({ skippedMissingCompletedAt: 1, cleaned: 0 }))
  it('no limpia una tarea reabierta', () => expect(isTaskEligibleForSmartCleaning({ id: 'reopened', status: 'todo', completedAt: daysAgo(3) }, now)).toBe(false))
  it('reinicia el reloj cuando se completa de nuevo', () => expect(isTaskEligibleForSmartCleaning({ id: 'again', status: 'done', completedAt: daysAgo(0.5) }, now)).toBe(false))
  it('es idempotente: una segunda evaluación de las conservadas no vuelve a limpiar', () => {
    const first = evaluateSmartCleaner([{ id: 'old', status: 'done', completedAt: daysAgo(3) }, { id: 'keep', status: 'todo' }], now)
    const second = evaluateSmartCleaner([{ id: 'keep', status: 'todo' }], now)
    expect(first.cleanedIds).toEqual(['old'])
    expect(second.cleanedIds).toEqual([])
  })
})
