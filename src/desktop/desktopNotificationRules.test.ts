import { describe, expect, it } from 'vitest'
import { calendarAnnouncement, desktopNotificationCandidates, financeRiskNotification } from './desktopNotificationRules'

const now = new Date('2026-08-16T12:00:00.000Z')

describe('desktop notification rules', () => {
  it('returns only deterministic imminent calendar and overdue backlog reminders', () => {
    const values = desktopNotificationCandidates({ now, calendarLeadMinutes: 10, calendarItems: [{ id: 'event', sourceId: 'event', sourceType: 'event', title: 'Reunión', start: '2026-08-16T12:05:00.000Z', allDay: false, status: 'active', editable: false }], tasks: [{ id: 'late', title: 'Entregar', area: 'personal', status: 'todo', priority: 'high', dueDate: '2026-08-15', createdAt: '', updatedAt: '' }] })
    expect(values.map((item) => item.route)).toEqual(['/calendar', '/backlog'])
  })

  it('keeps finance messages as domain-provided rather than inventing a recommendation', () => {
    expect(financeRiskNotification('budget', 'Presupuesto superado.', '2026-08-16')).toMatchObject({ route: '/finance', key: 'finance:budget:2026-08-16' })
  })

  it('uses the requested spoken wording for an imminent event', () => {
    expect(calendarAnnouncement('Junta BIMSA', 'BIMSA')).toBe('En 10 minutos tienes Junta BIMSA para BIMSA.')
  })
})
