import { describe, expect, it } from 'vitest'
import { demoData } from '../data/mockData'
import { upcoming48Hours, weightRegistrationIsStale, workspaceOpenLoad } from './dashboardMetrics'

describe('dashboard operativo', () => {
  it('calcula carga usando sólo tareas abiertas', () => {
    const workspace = { id: 'w', name: 'FARO OS', type: 'business' as const, isActive: true, sortOrder: 0, createdAt: '', updatedAt: '' }
    const tasks = [
      { ...demoData.tasks[0], id: 'open', workspaceId: 'w', status: 'todo' as const },
      { ...demoData.tasks[0], id: 'done', workspaceId: 'w', status: 'done' as const },
    ]
    expect(workspaceOpenLoad(tasks, [workspace], '2026-08-03')[0]).toMatchObject({ open: 1, pending: 1, completionPercent: 50 })
  })

  it('limita compromisos a las próximas 48 horas y cinco resultados', () => {
    const now = new Date('2026-08-03T12:00:00.000Z')
    const items = Array.from({ length: 7 }, (_, index) => ({ id: String(index), sourceId: String(index), sourceType: 'task' as const, title: String(index), start: new Date(now.getTime() + (index + 1) * 3_600_000).toISOString(), allDay: false, status: 'todo', editable: true }))
    items.push({ ...items[0], id: 'late', start: '2026-08-06T12:00:00.000Z' })
    expect(upcoming48Hours(items, now)).toHaveLength(5)
    expect(upcoming48Hours(items, now).some((item) => item.id === 'late')).toBe(false)
  })

  it('activa la alerta de peso después de dos días', () => {
    expect(weightRegistrationIsStale('2026-08-01', '2026-08-03')).toBe(true)
    expect(weightRegistrationIsStale('2026-08-02', '2026-08-03')).toBe(false)
  })
})
