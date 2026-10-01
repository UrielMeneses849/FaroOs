import { createClient } from 'npm:@supabase/supabase-js@2'
import { getCalendarAvailability } from './calendarSkill.ts'
import { addCalendarDays, calendarLocalDate, resolveExplicitCalendarDate, zonedCalendarIso } from './calendarDateTime.ts'
import { routeBacklogIntent, type BacklogFastIntent, type BacklogPriority, type BacklogStatus } from './backlogFastPath.ts'
import { normalizeVoiceText } from './financeFastPath.ts'
import { formatTimeForSpeech } from './timeForSpeech.ts'
import type { ServerVoiceTrace } from './trace.ts'

type Db = ReturnType<typeof createClient>
type Reference = { id: string; type: 'backlog_task' | 'calendar_task' | 'calendar_slot'; title: string; subtitle?: string }
type SessionContext = {
  lastResults?: Reference[]
  pendingClarification?: { intent?: string; missingFields?: string[]; entities?: Record<string, unknown> }
}
type LocalContext = { now: string; timezone: string; calendarItems?: Array<{ id: string; kind: 'event' | 'task'; title: string; start: string; end?: string; allDay?: boolean; workspaceId?: string }> }
type TaskRow = {
  id: string; title: string; description: string | null; notes: string | null; status: string; priority: string; due_at: string | null; estimated_minutes: number | null; workspace_id: string | null; project_id: string | null; created_at: string; updated_at: string
}
type Workspace = { id: string; name: string }
type Pending = NonNullable<SessionContext['pendingClarification']>

export type BacklogResolution =
  | { kind: 'read'; intent: BacklogFastIntent; message: string; result: unknown; references?: Reference[] }
  | { kind: 'clarify'; intent: BacklogFastIntent; message: string; references?: Reference[]; missingFields?: string[]; entities?: Record<string, unknown> }
  | { kind: 'action'; intent: BacklogFastIntent; toolName: string; arguments: Record<string, unknown>; summary: string; prompt: string }

const validUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const fold = (value: string) => normalizeVoiceText(value).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const weekdays: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }

function taskRef(task: TaskRow, workspaces: Workspace[]): Reference {
  const workspace = workspaces.find((item) => item.id === task.workspace_id)?.name
  const schedule = task.due_at?.includes('T') ? task.due_at : task.due_at ? `vence ${task.due_at}` : 'sin horario'
  return { id: task.id, type: 'backlog_task', title: task.title, subtitle: `${workspace ?? 'Sin workspace'} · ${task.status} · ${schedule}` }
}

function taskLine(task: TaskRow, workspaces: Workspace[], timezone: string) {
  const workspace = workspaces.find((item) => item.id === task.workspace_id)?.name ?? 'Sin workspace'
  const when = task.due_at?.includes('T') ? ` · ${formatTimeForSpeech(task.due_at, timezone)}` : task.due_at ? ` · vence ${task.due_at}` : ''
  return `${task.title} · ${workspace} · ${statusLabel(task.status)}${when}`
}

function statusLabel(status: string) {
  return ({ todo: 'Por hacer', doing: 'En progreso', blocked: 'En revisión', done: 'Completado' } as Record<string, string>)[status] ?? status
}

function priorityLabel(priority: string) {
  return ({ low: 'baja', medium: 'media', high: 'alta', critical: 'crítica' } as Record<string, string>)[priority] ?? priority
}

function dateFor(message: string, local: LocalContext, fallback?: string) {
  const today = calendarLocalDate(new Date(local.now), local.timezone)
  const explicit = resolveExplicitCalendarDate(message, today)
  if (explicit) return explicit
  const normalized = normalizeVoiceText(message)
  if (/\bmanana\b/.test(normalized)) return addCalendarDays(today, 1)
  const weekday = Object.entries(weekdays).find(([name]) => new RegExp(`\\b${name}\\b`).test(normalized))
  if (weekday) {
    const nowDay = new Date(`${today}T12:00:00Z`).getUTCDay()
    let days = (weekday[1] - nowDay + 7) % 7
    if (days === 0 && !/\bhoy\b/.test(normalized)) days = 7
    return addCalendarDays(today, days)
  }
  return fallback ?? today
}

function rangeForDate(date: string, timezone: string) {
  return { start: zonedCalendarIso(date, '00:00', timezone), end: zonedCalendarIso(addCalendarDays(date, 1), '00:00', timezone) }
}

function slotsReferences(slots: Array<{ start: string; end: string }>, timezone: string): Reference[] {
  return slots.map((slot, index) => ({
    id: `${slot.start}|${slot.end}`,
    type: 'calendar_slot',
    title: `Opción ${index + 1}: ${formatTimeForSpeech(slot.start, timezone)}–${formatTimeForSpeech(slot.end, timezone)}`,
  }))
}

function selectedSlot(context: SessionContext | undefined, ordinal?: number) {
  const refs = context?.lastResults ?? []
  const slots = refs.filter((item) => item.type === 'calendar_slot')
  const selected = slots[(ordinal ?? 1) - 1]
  if (!selected) return undefined
  const [start, end] = selected.id.split('|')
  return start && end ? { start, end } : undefined
}

function taskIdFromContext(context: SessionContext | undefined, ordinal?: number) {
  const prior = context?.pendingClarification?.entities
  if (validUuid(prior?.taskId)) return String(prior.taskId)
  const refs = context?.lastResults ?? []
  const selected = refs[(ordinal ?? 1) - 1]
  return selected && ['backlog_task', 'calendar_task'].includes(selected.type) && validUuid(selected.id) ? selected.id : undefined
}

async function loadTasks(db: Db, userId: string) {
  const { data, error } = await db.from('tasks').select('id,title,description,notes,status,priority,due_at,estimated_minutes,workspace_id,project_id,created_at,updated_at').eq('user_id', userId).is('archived_at', null).order('updated_at', { ascending: false }).limit(250)
  if (error) throw error
  return (data ?? []) as TaskRow[]
}

async function loadTaskById(db: Db, userId: string, id: string) {
  if (!validUuid(id)) return null
  const { data, error } = await db.from('tasks').select('id,title,description,notes,status,priority,due_at,estimated_minutes,workspace_id,project_id,created_at,updated_at').eq('user_id', userId).eq('id', id).maybeSingle()
  if (error) throw error
  return data as TaskRow | null
}

async function loadWorkspaces(db: Db, userId: string) {
  const { data, error } = await db.from('workspaces').select('id,name').eq('user_id', userId).eq('is_active', true).order('sort_order')
  if (error) throw error
  return (data ?? []) as Workspace[]
}

function workspaceFromMessage(message: string, hint: string | undefined, workspaces: Workspace[]) {
  const normalized = fold(message)
  const candidates = workspaces.filter((workspace) => {
    const name = fold(workspace.name)
    return (hint && (name === fold(hint) || name.includes(fold(hint)) || fold(hint).includes(name))) || (name.length > 1 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalized))
  })
  return candidates.length === 1 ? candidates[0] : undefined
}

function candidateScore(task: TaskRow, title: string) {
  const query = fold(title)
  const candidate = fold(task.title)
  if (!query) return 0
  if (candidate === query) return 1
  if (candidate.includes(query) || query.includes(candidate)) return .85
  const words = query.split(' ').filter((word) => word.length > 2)
  const hits = words.filter((word) => candidate.includes(word)).length
  return words.length ? hits / words.length * .72 : 0
}

function matchesForTitle(tasks: TaskRow[], title: string) {
  return tasks.map((task) => ({ task, score: candidateScore(task, title) })).filter((item) => item.score >= .45).sort((left, right) => right.score - left.score)
}

async function resolveTarget(db: Db, userId: string, tasks: TaskRow[], workspaces: Workspace[], message: string, context: SessionContext | undefined, route: ReturnType<typeof routeBacklogIntent>): Promise<TaskRow | BacklogResolution | null> {
  const contextualId = taskIdFromContext(context, route.entities.ordinal)
  if (contextualId && !route.entities.targetTitle) {
    const task = await loadTaskById(db, userId, contextualId)
    if (task) return task
  }
  const title = route.entities.targetTitle
  if (title) {
    const matches = matchesForTitle(tasks, title)
    if (matches.length === 1 || (matches[0] && (!matches[1] || matches[0].score - matches[1].score >= .2))) return matches[0].task
    if (matches.length > 1) return {
      kind: 'clarify', intent: route.intent,
      message: `Encontré varias tareas parecidas:\n${matches.slice(0, 3).map((item, index) => `${index + 1}. ${taskLine(item.task, workspaces, 'America/Mexico_City')}`).join('\n')}\n¿Cuál quieres usar?`,
      references: matches.slice(0, 3).map((item) => taskRef(item.task, workspaces)),
      missingFields: ['target'], entities: { taskTitle: title },
    }
  }
  if (contextualId) {
    const task = await loadTaskById(db, userId, contextualId)
    if (task) return task
  }
  return null
}

function durationLabel(minutes: number) {
  return minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}` : `${minutes} minutos`
}

function statusFromMessage(message: string): BacklogStatus | undefined {
  const normalized = normalizeVoiceText(message)
  if (/\b(?:terminad[ao]|completad[ao]|marca(?:la)? como terminad[ao]|completa)\b/.test(normalized)) return 'done'
  if (/\b(?:reabre|regresa.*por hacer|por hacer)\b/.test(normalized)) return 'todo'
  if (/\b(?:en progreso|progreso)\b/.test(normalized)) return 'doing'
  if (/\b(?:en revision|revision)\b/.test(normalized)) return 'blocked'
  return undefined
}

async function scheduleProposal(db: Db, userId: string, task: TaskRow | null, input: { title: string; taskId: string; workspaceId: string | null; durationMinutes: number; date: string; start?: string; end?: string; create?: boolean }, local: LocalContext, trace: ServerVoiceTrace) : Promise<BacklogResolution> {
  const range = rangeForDate(input.date, local.timezone)
  const availability = await getCalendarAvailability(db, userId, range, input.durationMinutes, local, trace, { ignoreTaskId: task?.id })
  let start = input.start
  let end = input.end
  if (start && !end) end = new Date(new Date(start).getTime() + input.durationMinutes * 60000).toISOString()
  const conflicts = start && end
    ? availability.items.filter((item) => new Date(item.start) < new Date(end!) && new Date(item.end) > new Date(start!))
    : []
  if (!start || !end || conflicts.length) {
    const references = slotsReferences(availability.slots, local.timezone)
    const conflict = conflicts[0]
    const suffix = conflict ? `Tienes “${conflict.title}” a las ${formatTimeForSpeech(conflict.start, local.timezone)}${conflict.provider === 'google' ? ' en Google Calendar' : ''}. ` : ''
    return {
      kind: 'clarify', intent: input.create ? 'create_backlog_task' : 'schedule_backlog_task',
      message: references.length ? `${suffix}Tengo libres:\n${references.map((item) => item.title).join('\n')}\n¿Cuál eliges?` : `${suffix}No encontré un hueco de ${durationLabel(input.durationMinutes)} ese día.`,
      references,
      missingFields: references.length ? ['slot_selection'] : ['schedule'],
      entities: {
        taskId: task?.id ?? input.taskId,
        createTask: Boolean(input.create),
        title: input.title,
        workspaceId: input.workspaceId,
        durationMinutes: input.durationMinutes,
        date: input.date,
      },
    }
  }
  const toolName = input.create ? 'createBacklogTask' : 'scheduleBacklogTask'
  const args = input.create
    ? { taskId: input.taskId, title: input.title, workspaceId: input.workspaceId, durationMinutes: input.durationMinutes, start, end, offerSchedule: false }
    : { taskId: input.taskId, start, end, durationMinutes: input.durationMinutes }
  const verb = input.create ? 'crear y programar' : task?.due_at?.includes('T') ? 'mover' : 'programar'
  return {
    kind: 'action', intent: input.create ? 'create_backlog_task' : 'schedule_backlog_task', toolName, arguments: args,
    summary: `${verb.charAt(0).toUpperCase()}${verb.slice(1)} “${input.title}” el ${input.date} de ${formatTimeForSpeech(start, local.timezone)} a ${formatTimeForSpeech(end, local.timezone)}.`,
    prompt: `Voy a ${verb} “${input.title}” el ${input.date} de ${formatTimeForSpeech(start, local.timezone)} a ${formatTimeForSpeech(end, local.timezone)}. ¿Confirmas?`,
  }
}

function slotContinuation(context: SessionContext | undefined, route: ReturnType<typeof routeBacklogIntent>) {
  const prior = context?.pendingClarification
  if (!prior?.missingFields?.includes('slot_selection')) return undefined
  const slot = selectedSlot(context, route.entities.ordinal)
  if (!slot) return undefined
  const entities = prior.entities ?? {}
  return { slot, entities }
}

export async function resolveFastBacklog(db: Db, userId: string, message: string, context: SessionContext | undefined, local: LocalContext | undefined, trace: ServerVoiceTrace): Promise<BacklogResolution | null> {
  if (!local || !Number.isFinite(new Date(local.now).getTime())) return null
  const route = trace.measureSync('routing', () => routeBacklogIntent(message))
  const prior = context?.pendingClarification
  const affirmative = /^(?:si|sí|claro|dale|correcto|ok|vale)[.! ]*$/i.test(message.trim())
  let intent = route.intent
  if (intent === 'unknown' && prior?.intent?.includes('backlog') && (route.entities.ordinal || route.entities.durationMinutes || route.entities.time || route.entities.relativeMinutes || route.entities.status || affirmative)) intent = prior.intent as BacklogFastIntent
  if (intent === 'unknown' && prior?.intent === 'schedule_backlog_task' && (affirmative || route.entities.durationMinutes || route.entities.ordinal)) intent = 'schedule_backlog_task'
  if (intent === 'unknown') return null

  const [tasks, workspaces] = await Promise.all([loadTasks(db, userId), loadWorkspaces(db, userId)])
  const today = calendarLocalDate(new Date(local.now), local.timezone)

  const selected = slotContinuation(context, route)
  if (selected) {
    const durationMinutes = Number(selected.entities.durationMinutes ?? 0)
    const taskId = validUuid(selected.entities.taskId) ? String(selected.entities.taskId) : crypto.randomUUID()
    const task = validUuid(selected.entities.taskId) ? await loadTaskById(db, userId, String(selected.entities.taskId)) : null
    if (!Number.isFinite(durationMinutes) || durationMinutes < 15) return { kind: 'clarify', intent, message: '¿Cuánto tiempo necesitas?', missingFields: ['duration'], entities: selected.entities }
    return scheduleProposal(db, userId, task, {
      title: task?.title ?? String(selected.entities.title ?? 'esta tarea'), taskId,
      workspaceId: validUuid(selected.entities.workspaceId) ? String(selected.entities.workspaceId) : null,
      durationMinutes, date: String(selected.entities.date ?? today), start: selected.slot.start, end: selected.slot.end, create: Boolean(selected.entities.createTask),
    }, local, trace)
  }

  if (intent === 'list_backlog_tasks' || intent === 'list_tasks_by_status' || intent === 'list_tasks_by_workspace' || intent === 'list_tasks_due_today' || intent === 'list_overdue_tasks' || intent === 'get_scheduled_tasks' || intent === 'get_current_task' || intent === 'find_backlog_task') {
    let selectedTasks = tasks.filter((task) => task.status !== 'done')
    const workspace = workspaceFromMessage(message, route.entities.workspaceName, workspaces)
    const requestedStatus = route.entities.status ?? statusFromMessage(message)
    if (intent === 'list_tasks_by_workspace' && route.entities.workspaceName && !workspace) return { kind: 'clarify', intent, message: `No encontré un workspace activo llamado “${route.entities.workspaceName}”.`, missingFields: ['workspace'], entities: { workspaceName: route.entities.workspaceName } }
    if (workspace) selectedTasks = selectedTasks.filter((task) => task.workspace_id === workspace.id)
    if (intent === 'list_tasks_by_status' && requestedStatus) selectedTasks = tasks.filter((task) => task.status === requestedStatus)
    if (intent === 'list_tasks_due_today') selectedTasks = selectedTasks.filter((task) => task.due_at?.slice(0, 10) === today && task.status !== 'done')
    if (intent === 'list_overdue_tasks') selectedTasks = selectedTasks.filter((task) => task.status !== 'done' && Boolean(task.due_at) && task.due_at!.slice(0, 10) < today)
    if (intent === 'get_scheduled_tasks') selectedTasks = selectedTasks.filter((task) => route.entities.unscheduledOnly ? !task.due_at?.includes('T') : task.due_at?.includes('T'))
    if (intent === 'get_current_task') selectedTasks = tasks.filter((task) => task.status === 'doing').slice(0, 1)
    if (intent === 'find_backlog_task') {
      const query = route.entities.targetTitle ?? message.replace(/.*?\b(?:busca|buscar|encuentra|encontrar)\s+(?:la\s+)?(?:tarea\s+)?/i, '')
      selectedTasks = matchesForTitle(tasks, query).map((item) => item.task)
    }
    selectedTasks = selectedTasks.slice(0, 10)
    const label = intent === 'get_current_task' ? 'Ahora estás trabajando en' : intent === 'list_overdue_tasks' ? 'Tareas vencidas' : intent === 'list_tasks_due_today' ? 'Tareas que vencen hoy' : intent === 'get_scheduled_tasks' ? route.entities.unscheduledOnly ? 'Tareas sin horario' : 'Tareas programadas' : 'Encontré estas tareas'
    return { kind: 'read', intent, message: selectedTasks.length ? `${label}:\n${selectedTasks.map((task, index) => `${index + 1}. ${taskLine(task, workspaces, local.timezone)}`).join('\n')}` : intent === 'get_current_task' ? 'No tienes una tarea en progreso ahora.' : 'No encontré tareas que coincidan.', result: { items: selectedTasks }, references: selectedTasks.map((task) => taskRef(task, workspaces)) }
  }

  if (intent === 'create_backlog_task') {
    const title = route.entities.createTitle ?? String(prior?.entities?.title ?? '')
    if (!title) return { kind: 'clarify', intent, message: '¿Cuál es el título de la tarea?', missingFields: ['title'], entities: { workspaceName: route.entities.workspaceName } }
    const workspace = workspaceFromMessage(message, route.entities.workspaceName, workspaces) ?? workspaces[0]
    if (!workspace) return { kind: 'clarify', intent, message: 'Crea o activa un workspace antes de agregar la tarea.', missingFields: ['workspace'] }
    const id = crypto.randomUUID()
    const durationMinutes = route.entities.durationMinutes
    const hasScheduleRequest = Boolean(route.entities.time || route.entities.hasDate && durationMinutes)
    if (hasScheduleRequest) {
      const date = dateFor(message, local)
      const start = route.entities.time ? zonedCalendarIso(date, route.entities.time, local.timezone) : undefined
      const end = route.entities.endTime ? zonedCalendarIso(date, route.entities.endTime, local.timezone) : undefined
      return scheduleProposal(db, userId, null, { title, taskId: id, workspaceId: workspace.id, durationMinutes: Math.max(15, durationMinutes ?? 60), date, start, end, create: true }, local, trace)
    }
    const args = { taskId: id, title, description: route.entities.description ?? null, workspaceId: workspace.id, priority: route.entities.priority ?? 'medium', durationMinutes: durationMinutes ?? null, dueAt: null, offerSchedule: true }
    return { kind: 'action', intent, toolName: 'createBacklogTask', arguments: args, summary: `Crear “${title}” en ${workspace.name}${durationMinutes ? ` · ${durationLabel(durationMinutes)}` : ''}.`, prompt: `Voy a crear la tarea “${title}” en ${workspace.name}. ¿Confirmas?` }
  }

  if (intent === 'schedule_backlog_task' && prior?.missingFields?.includes('schedule_offer') && affirmative) {
    const targetId = taskIdFromContext(context)
    const task = targetId ? await loadTaskById(db, userId, targetId) : null
    if (!task) return { kind: 'clarify', intent, message: '¿Qué tarea quieres programar?', missingFields: ['target'] }
    const durationMinutes = task.estimated_minutes ?? Number(prior.entities?.durationMinutes ?? 0)
    if (!durationMinutes) return { kind: 'clarify', intent, message: '¿Cuánto tiempo necesitas?', missingFields: ['duration'], entities: { taskId: task.id, durationMinutes: null, date: dateFor(message, local) } }
    return scheduleProposal(db, userId, task, { title: task.title, taskId: task.id, workspaceId: task.workspace_id, durationMinutes, date: dateFor(message, local), create: false }, local, trace)
  }

  const target = await resolveTarget(db, userId, tasks, workspaces, message, context, route)
  if (target && 'kind' in target) return target
  if (!target) return { kind: 'clarify', intent, message: '¿Qué tarea quieres usar?', missingFields: ['target'] }

  if (intent === 'unschedule_backlog_task') {
    if (!target.due_at) return { kind: 'read', intent, message: `“${target.title}” ya está pendiente sin horario.`, result: { item: target }, references: [taskRef(target, workspaces)] }
    return { kind: 'action', intent, toolName: 'unscheduleBacklogTask', arguments: { taskId: target.id }, summary: `Quitar “${target.title}” del calendario sin borrar la tarea.`, prompt: `Voy a quitar “${target.title}” del calendario y conservarla en Backlog. ¿Confirmas?` }
  }

  if (intent === 'delete_backlog_task') return { kind: 'action', intent, toolName: 'deleteBacklogTask', arguments: { taskId: target.id }, summary: `Eliminar la tarea “${target.title}”.`, prompt: `¿Confirmas que elimine “${target.title}”?` }

  if (intent === 'update_backlog_status') {
    const nextStatus = route.entities.status ?? statusFromMessage(message)
    if (!nextStatus) return { kind: 'clarify', intent, message: '¿La paso a por hacer, en progreso, en revisión o completada?', missingFields: ['status'], entities: { taskId: target.id } }
    if (target.status === nextStatus) return { kind: 'read', intent, message: `“${target.title}” ya está ${statusLabel(nextStatus).toLocaleLowerCase('es-MX')}.`, result: { item: target }, references: [taskRef(target, workspaces)] }
    return { kind: 'action', intent, toolName: 'updateBacklogTaskStatus', arguments: { taskId: target.id, status: nextStatus }, summary: `Cambiar “${target.title}” a ${statusLabel(nextStatus)}.`, prompt: `Voy a pasar “${target.title}” a ${statusLabel(nextStatus)}. ¿Confirmas?` }
  }

  if (intent === 'schedule_backlog_task' || intent === 'move_backlog_task_schedule') {
    const durationMinutes = route.entities.durationMinutes ?? target.estimated_minutes
    if (!durationMinutes) return { kind: 'clarify', intent, message: '¿Cuánto tiempo necesitas para esa tarea?', missingFields: ['duration'], entities: { taskId: target.id, date: dateFor(message, local) } }
    const scheduledDate = target.due_at?.includes('T') ? calendarLocalDate(new Date(target.due_at), local.timezone) : undefined
    const date = dateFor(message, local, scheduledDate)
    let start: string | undefined
    let end: string | undefined
    if (route.entities.relativeMinutes && target.due_at?.includes('T')) {
      start = new Date(new Date(target.due_at).getTime() + route.entities.relativeMinutes * 60000).toISOString()
      end = new Date(new Date(start).getTime() + durationMinutes * 60000).toISOString()
    } else if (route.entities.time) {
      start = zonedCalendarIso(date, route.entities.time, local.timezone)
      end = route.entities.endTime ? zonedCalendarIso(date, route.entities.endTime, local.timezone) : undefined
    } else if (target.due_at?.includes('T') && route.entities.hasDate) {
      const hour = new Intl.DateTimeFormat('en-GB', { timeZone: local.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(target.due_at))
      start = zonedCalendarIso(date, hour, local.timezone)
    }
    return scheduleProposal(db, userId, target, { title: target.title, taskId: target.id, workspaceId: target.workspace_id, durationMinutes, date, start, end, create: false }, local, trace)
  }

  if (intent === 'update_backlog_task') {
    const workspace = workspaceFromMessage(message, route.entities.workspaceName, workspaces)
    let projectId: string | undefined
    let projectWorkspaceId: string | undefined
    if (route.entities.projectName) {
      const { data: projects, error } = await db.from('projects').select('id,title,workspace_id').eq('user_id', userId).is('archived_at', null).limit(100)
      if (error) throw error
      const matches = (projects ?? []).filter((project) => {
        const query = fold(route.entities.projectName!)
        const title = fold(project.title)
        return title === query || title.includes(query) || query.includes(title)
      })
      if (matches.length !== 1) return { kind: 'clarify', intent, message: matches.length ? `Encontré varios proyectos parecidos a “${route.entities.projectName}”. ¿Cuál quieres usar?` : `No encontré un proyecto llamado “${route.entities.projectName}”.`, missingFields: ['project'], entities: { taskId: target.id, projectName: route.entities.projectName } }
      projectId = matches[0].id
      projectWorkspaceId = matches[0].workspace_id ?? undefined
    }
    const dueDate = /\b(?:fecha objetivo|vence|vencimiento)\b/.test(route.entities.normalized) ? dateFor(message, local) : undefined
    const updates: Record<string, unknown> = { taskId: target.id }
    if (route.entities.newTitle) updates.title = route.entities.newTitle
    if (route.entities.description) updates.description = route.entities.description
    if (workspace && workspace.id !== target.workspace_id) updates.workspaceId = workspace.id
    if (projectId) { updates.projectId = projectId; if (projectWorkspaceId) updates.workspaceId = projectWorkspaceId }
    if (route.entities.priority) updates.priority = route.entities.priority as BacklogPriority
    if (route.entities.durationMinutes) updates.durationMinutes = route.entities.durationMinutes
    if (dueDate) updates.dueAt = dueDate
    if (Object.keys(updates).length === 1) return { kind: 'clarify', intent, message: '¿Qué cambio quieres hacerle a la tarea?', missingFields: ['changes'], entities: { taskId: target.id } }
    const summary = [updates.title ? `título “${updates.title}”` : '', updates.workspaceId ? `workspace ${workspaces.find((item) => item.id === updates.workspaceId)?.name ?? ''}` : '', updates.priority ? `prioridad ${priorityLabel(String(updates.priority))}` : '', updates.durationMinutes ? `duración ${durationLabel(Number(updates.durationMinutes))}` : '', updates.dueAt ? `fecha ${updates.dueAt}` : ''].filter(Boolean).join(', ')
    return { kind: 'action', intent, toolName: 'updateBacklogTask', arguments: updates, summary: `Actualizar “${target.title}”: ${summary}.`, prompt: `Voy a actualizar “${target.title}”: ${summary}. ¿Confirmas?` }
  }

  return null
}
