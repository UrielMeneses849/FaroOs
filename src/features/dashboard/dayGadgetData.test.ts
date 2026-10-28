import { describe, expect, it } from 'vitest'
import { commitmentTiming, dayPriorities, nextDayCommitment } from './dayGadgetData'
import type { Task } from '../../types'
import type { CalendarItem } from '../calendar/calendarTypes'
const now = new Date(2026, 9, 27, 19, 5)
const task = (id: string, changes: Partial<Task> = {}): Task => ({ id, title: id, status: 'todo', priority: 'medium', area: 'personal', createdAt: '', updatedAt: '', ...changes })
const event = (id: string, changes: Partial<CalendarItem> = {}): CalendarItem => ({ id, title: id, sourceType: 'event', sourceId: id, start: new Date(2026, 9, 27, 19, 30).toISOString(), allDay: false, status: 'planned', editable: true, ...changes })
describe('Mi día data', () => {
  it('prioritizes actionable work due today and caps at three without mutating tasks', () => {
    const data = [task('later', { priority: 'critical', dueDate: '2026-10-28' }), task('waiting', { status: 'waiting', dueDate: '2026-10-27' }), task('blocked', { status: 'blocked', dueDate: '2026-10-27' }), task('critical', { priority: 'critical', dueDate: '2026-10-27' }), task('working', { status: 'doing', priority: 'high' }), task('due', { dueDate: '2026-10-27' }), task('undated'), task('archived', { archivedAt: now.toISOString() }), task('done', { status: 'done' }), task('paused', { status: 'paused', pausedUntil: '2026-10-28' })]
    const before = [...data]
    expect(dayPriorities(data, now).map(t => t.id)).toEqual(['critical', 'working', 'due'])
    expect(data).toEqual(before)
  })
  it('uses local dueAt dates ahead of a stale dueDate', () => {
    expect(dayPriorities([task('scheduled', { dueDate: '2026-10-28', dueAt: new Date(2026, 9, 27, 18).toISOString() })], now).map(t => t.id)).toEqual(['scheduled'])
  })
  it('keeps an ongoing event, skips cancelled or expired events and selects the next timed commitment', () => {
    const current = event('current', { start: new Date(2026, 9, 27, 19).toISOString(), end: new Date(2026, 9, 27, 20).toISOString() })
    const data = [event('cancelled', { status: 'cancelled' }), event('past', { start: new Date(2026, 9, 27, 17).toISOString(), end: new Date(2026, 9, 27, 18).toISOString() }), ...Array.from({ length: 6 }, (_, i) => event(`all-${i}`, { allDay: true, start: '2026-10-27', end: '2026-10-28' })), current, event('next')]
    expect(nextDayCommitment(data, now)?.id).toBe('current')
  })
  it('shows a real countdown, an in-progress state and the all-day fallback', () => {
    expect(commitmentTiming(event('next'), now)).toBe('En 25 min')
    expect(commitmentTiming(event('current', { start: now.toISOString() }), now)).toBe('En curso')
    const allDay = event('all', { allDay: true, start: '2026-10-27', end: '2026-10-28' })
    expect(nextDayCommitment([allDay], now)?.id).toBe('all')
    expect(commitmentTiming(allDay, now)).toBe('Todo el día')
  })
})
