import { describe, expect, it } from 'vitest'
import { routeBacklogIntent } from '../../supabase/functions/_shared/voice/backlogFastPath'

describe('Backlog deterministic fast path', () => {
  it('clasifica lecturas del Backlog sin confirmación', () => {
    expect(routeBacklogIntent('¿Qué tengo pendiente de BIMSA?')).toMatchObject({ intent: 'list_tasks_by_workspace', entities: { workspaceName: 'BIMSA' } })
    expect(routeBacklogIntent('¿Qué tareas vencen hoy?')).toMatchObject({ intent: 'list_tasks_due_today' })
    expect(routeBacklogIntent('¿Qué estoy haciendo ahora?')).toMatchObject({ intent: 'get_current_task' })
    expect(routeBacklogIntent('¿Qué tareas tengo sin programar?')).toMatchObject({ intent: 'get_scheduled_tasks', entities: { unscheduledOnly: true } })
  })

  it('clasifica escrituras, estados y scheduling sobre la misma tarea', () => {
    expect(routeBacklogIntent('Crea una tarea de BIMSA para revisar ETL.')).toMatchObject({ intent: 'create_backlog_task', entities: { createTitle: 'revisar ETL' } })
    expect(routeBacklogIntent('Pon la segunda en progreso.')).toMatchObject({ intent: 'update_backlog_status', entities: { ordinal: 2, status: 'doing' } })
    expect(routeBacklogIntent('Muévela una hora después.')).toMatchObject({ intent: 'move_backlog_task_schedule', entities: { relativeMinutes: 60 } })
    expect(routeBacklogIntent('Quita esta tarea del calendario.')).toMatchObject({ intent: 'unschedule_backlog_task' })
    expect(routeBacklogIntent('Reabre esa tarea.')).toMatchObject({ intent: 'update_backlog_status', entities: { status: 'todo' } })
    expect(routeBacklogIntent('Elimínala.')).toMatchObject({ intent: 'delete_backlog_task' })
  })
})
