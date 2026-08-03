import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoData } from '../data/mockData'
import { mergePlanningCalendarItems, normalizeCalendarData, normalizeCalendarRows } from './calendarService'

describe('normalización del calendario', () => {
  afterEach(() => vi.restoreAllMocks())

  it('deduplica una tarea optimista cuando un refetch devuelve el mismo id', () => {
    const local = normalizeCalendarData({ tasks: [{ ...demoData.tasks[0], id: 'same-task', dueDate: '2026-08-03' }], projects: [], goals: [] })
    const remote = [{ ...local[0], title: 'Versión remota anterior' }]
    expect(mergePlanningCalendarItems(remote, local)).toEqual(local)
  })

  it('separa el modelo visual de Tasks, Projects y Goals', () => {
    const task = { ...demoData.tasks[0], dueAt: '2026-07-27T16:00:00.000Z', estimatedMinutes: 60, workspaceId: 'workspace-personal' }
    const items = normalizeCalendarData({ tasks: [task], projects: [demoData.projects[0]], goals: [demoData.goals[0]] })
    expect(items.map((item) => item.sourceType)).toEqual(['task', 'project', 'goal'])
    expect(items[0]).toMatchObject({ editable: true, allDay: false, workspaceId: 'workspace-personal' })
    expect(items[1]).toMatchObject({ editable: false, allDay: true })
    expect(items[2]).toMatchObject({ editable: false, allDay: true })
  })

  it('excluye entidades archivadas o sin fecha', () => {
    const task = { ...demoData.tasks[0], dueDate: undefined, dueAt: undefined }
    expect(normalizeCalendarData({ tasks: [task], projects: [], goals: [] })).toEqual([])
  })

  it('conserva los eventos válidos aunque otros registros tengan fechas corruptas', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const validTask = {
      ...demoData.tasks[0],
      id: 'task-valid',
      dueAt: '2026-07-27T16:00:00.000Z',
      dueDate: undefined,
    }
    const invalidTask = {
      ...demoData.tasks[0],
      id: 'task-invalid',
      dueAt: 'Invalid Date',
      dueDate: '2026-99-99',
    }
    const validProject = {
      ...demoData.projects[0],
      id: 'project-valid',
      startDate: '2026-07-20',
      endDate: '2026-07-30',
    }
    const undatedProject = {
      ...demoData.projects[0],
      id: 'project-undated',
      startDate: undefined,
      endDate: undefined,
    }
    const validGoal = {
      ...demoData.goals[0],
      id: 'goal-valid',
      targetDate: '2026-12-01',
    }

    const items = normalizeCalendarData({
      tasks: [validTask, invalidTask],
      projects: [validProject, undatedProject],
      goals: [validGoal],
    })

    expect(items).toHaveLength(3)
    expect(items.map((item) => item.sourceId)).toEqual([
      'task-valid',
      'project-valid',
      'goal-valid',
    ])
    expect(console.warn).toHaveBeenCalled()
  })

  it('nunca entrega a FullCalendar un rango de proyecto invertido', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const project = {
      ...demoData.projects[0],
      startDate: '2026-08-30',
      endDate: '2026-08-01',
    }
    const [item] = normalizeCalendarData({ tasks: [], projects: [project], goals: [] })

    expect(item.start).toBe('2026-08-01')
    expect(item.end).toBeUndefined()
  })

  it('mantiene los eventos fuera del modelo de tareas y conserva su intención', () => {
    const result = normalizeCalendarRows({
      tasks: [],
      projects: [],
      goals: [],
      entries: [{
        id: 'event-1',
        user_id: 'user-1',
        workspace_id: 'workspace-personal',
        linked_task_id: null,
        kind: 'event',
        title: 'Junta con stakeholder',
        description: 'Revisión semanal',
        starts_at: '2026-08-01T19:30:00.000Z',
        ends_at: '2026-08-01T20:00:00.000Z',
        all_day: false,
        created_at: '2026-08-01T18:00:00.000Z',
        updated_at: '2026-08-01T18:00:00.000Z',
      }],
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      sourceType: 'event',
      entryKind: 'event',
      title: 'Junta con stakeholder',
      status: 'scheduled',
      editable: true,
    })
  })
})
