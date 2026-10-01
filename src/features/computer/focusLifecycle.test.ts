import { describe, expect, it } from 'vitest'
import { advanceConcentrationSession, completeFocusSession, focusElapsedSeconds, focusRemainingSeconds, pauseFocusSession, resumeFocusSession } from './focusLifecycle'
import type { FocusSession } from './computerTypes'

const active: FocusSession = { id: 'focus-1', workspace: 'BIMSA', startTime: '2026-08-19T10:00:00.000Z', plannedDurationMinutes: 120, accumulatedActiveSeconds: 0, status: 'active' }

describe('focus lifecycle', () => {
  it('does not create a second session when paused/resumed', () => {
    const paused = pauseFocusSession(active, new Date('2026-08-19T10:30:00.000Z'))
    const resumed = resumeFocusSession(paused, new Date('2026-08-19T11:00:00.000Z'))
    expect(resumed.id).toBe(active.id)
    expect(focusElapsedSeconds(resumed, new Date('2026-08-19T11:15:00.000Z'))).toBe(2700)
  })
  it('keeps actual duration when completing a paused session', () => {
    const paused = pauseFocusSession(active, new Date('2026-08-19T10:47:00.000Z'))
    const done = completeFocusSession(paused, new Date('2026-08-19T12:00:00.000Z'))
    expect(done.status).toBe('completed')
    expect(done.actualDurationSeconds).toBe(2820)
  })
  it('moves a concentration from its focus interval into the configured break', () => {
    const concentration: FocusSession = { ...active, kind: 'concentration', phase: 'focus', plannedDurationMinutes: 45, breakDurationMinutes: 15 }
    const resting = advanceConcentrationSession(concentration, new Date('2026-08-19T10:45:05.000Z'))
    expect(resting).toMatchObject({ status: 'break', phase: 'break', accumulatedActiveSeconds: 2700 })
    expect(focusRemainingSeconds(resting!, new Date('2026-08-19T10:50:00.000Z'))).toBe(600)
  })
  it('ends the concentration after its break finishes', () => {
    const resting: FocusSession = { ...active, kind: 'concentration', phase: 'break', status: 'break', plannedDurationMinutes: 45, breakDurationMinutes: 15, accumulatedActiveSeconds: 2700 }
    const done = advanceConcentrationSession(resting, new Date('2026-08-19T10:15:00.000Z'))
    expect(done).toMatchObject({ status: 'completed', actualDurationSeconds: 2700 })
  })
  it('runs the 10 second / 5 second trial through both deadlines and preserves pause time', () => {
    const trial: FocusSession = { ...active, kind: 'concentration', phase: 'focus', plannedDurationMinutes: 10 / 60, breakDurationMinutes: 5 / 60 }
    expect(advanceConcentrationSession(trial, new Date('2026-08-19T10:00:09Z'))).toBeUndefined()
    const rest = advanceConcentrationSession(trial, new Date('2026-08-19T10:00:10Z'))!
    expect(rest.status).toBe('break')
    expect(focusRemainingSeconds(rest, new Date('2026-08-19T10:00:10Z'))).toBe(5)
    const paused = pauseFocusSession(rest, new Date('2026-08-19T10:00:12Z'))
    expect(advanceConcentrationSession(paused, new Date('2026-08-19T10:05:00Z'))).toBeUndefined()
    const resumed = resumeFocusSession(paused, new Date('2026-08-19T10:05:00Z'))
    expect(focusRemainingSeconds(resumed, new Date('2026-08-19T10:05:00Z'))).toBe(3)
    expect(advanceConcentrationSession(resumed, new Date('2026-08-19T10:05:03Z'))).toMatchObject({ status: 'completed', actualDurationSeconds: 10 })
  })

  it('caps work time when resuming after both deadlines have passed', () => {
    const trial: FocusSession = { ...active, kind: 'concentration', phase: 'focus', plannedDurationMinutes: 10 / 60, breakDurationMinutes: 5 / 60 }
    expect(advanceConcentrationSession(trial, new Date('2026-08-19T10:10:00Z'))).toMatchObject({ status: 'completed', actualDurationSeconds: 10 })
  })

})
