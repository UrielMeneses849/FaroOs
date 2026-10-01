import { describe, expect, it } from 'vitest'
import { calendarItemsInRange, calendarWorkspaceCounts, resolveCalendarWorkspaceId } from './calendarWorkspaceCounts'
import type { CalendarItem } from '../features/calendar/calendarTypes'

const workspaces = [
  { id: 'bbva', name: 'BBVA', type: 'employment', isActive: true, sortOrder: 0, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  { id: 'personal', name: 'Personal', type: 'personal', isActive: true, sortOrder: 1, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
] as const
const range = { start: '2026-08-10T00:00:00.000Z', end: '2026-08-17T00:00:00.000Z' }
const item = (changes: Partial<CalendarItem>): CalendarItem => ({
  id: 'item', sourceType: 'event', sourceId: 'item', title: 'Evento', start: '2026-08-12T14:00:00.000Z',
  allDay: false, status: 'scheduled', editable: true, ...changes,
})

describe('conteos de workspaces del calendario', () => {
  it('cuenta eventos FARO y tareas programadas del rango visible, no historial completado', () => {
    const visible = calendarItemsInRange([
      item({ id: 'faro', workspaceId: 'personal' }),
      item({ id: 'task', sourceType: 'task', workspaceId: 'bbva', status: 'doing' }),
      item({ id: 'done', sourceType: 'task', workspaceId: 'bbva', status: 'done' }),
      item({ id: 'outside', workspaceId: 'personal', start: '2026-08-20T14:00:00.000Z' }),
    ], range)

    expect(calendarWorkspaceCounts(visible, [...workspaces])).toEqual({ all: 2, byWorkspace: { bbva: 1, personal: 1 } })
  })

  it('incluye Google sólo cuando el calendario se asocia a un workspace y evita duplicados', () => {
    const google = item({ id: 'google:bbva:event-1', source: 'google', readOnly: true, editable: false, calendarName: 'BBVA' })
    const visible = calendarItemsInRange([google, { ...google, title: 'Duplicado actualizado' }], range)

    expect(resolveCalendarWorkspaceId(google, [...workspaces])).toBe('bbva')
    expect(calendarWorkspaceCounts(visible, [...workspaces])).toEqual({ all: 1, byWorkspace: { bbva: 1, personal: 0 } })
  })

  it('no atribuye a un workspace eventos Google sin una asociación explícita', () => {
    const visible = calendarItemsInRange([item({ id: 'google:other:event', source: 'google', readOnly: true, editable: false, calendarName: 'Equipo externo' })], range)
    expect(calendarWorkspaceCounts(visible, [...workspaces])).toEqual({ all: 1, byWorkspace: { bbva: 0, personal: 0 } })
  })
})
