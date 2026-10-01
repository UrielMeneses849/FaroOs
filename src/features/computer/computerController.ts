import { isFaroDesktop, executeComputerTool, getComputerConfig, updateComputerConfig } from '../../desktop/desktopBridge'
import { calendarEntryRepository } from '../../repositories/calendarEntryRepository'
import { calendarRepository } from '../../repositories/calendarRepository'
import { taskRepository } from '../../repositories/taskRepository'
import { workspaceRepository } from '../../repositories/workspaceRepository'
import { supabase } from '../../lib/supabase/client'
import type { PendingVoiceAction, VoiceResponse } from '../voice/voiceSchemas'
import { advanceConcentrationSession, completeFocusSession, focusElapsedSeconds, formatFocusDuration, pauseFocusSession, resumeFocusSession } from './focusLifecycle'
import { normalizeComputerText, routeComputerVoiceCommand } from './computerRouter'
import { defaultComputerConfig, isComputerPendingTool, type AutomationAction, type ComputerConfig, type ComputerNativeRequest, type ComputerPendingTool, type ComputerToolName, type FocusSession, type ProjectRegistryEntry } from './computerTypes'

type PendingPayload = Record<string, unknown>

export interface ComputerVoiceResult {
  handled: true
  response: VoiceResponse
}

function localResponse(message: string, pendingAction?: PendingVoiceAction, qa: Record<string, unknown> = {}): VoiceResponse {
  return {
    status: pendingAction ? 'pending_confirmation' : 'completed',
    message,
    questions: [],
    pendingAction,
    qa: { intent: String(qa.intent ?? 'computer'), entities: qa, route: 'deterministic' },
  }
}

function localPending(toolName: ComputerPendingTool, summary: string, payload: PendingPayload): PendingVoiceAction {
  return { requestId: crypto.randomUUID(), toolName, arguments: { desktopLocal: true, ...payload }, summary }
}

function withFocusDefaults(config: ComputerConfig) {
  const preferences = config.focusPreferences ?? defaultComputerConfig().focusPreferences
  const hasBreakDuration = Number.isFinite(preferences.defaultBreakDurationMinutes)
  return {
    ...config,
    // Older Computer configs predate this field. Keep the concentration
    // command runnable while their config is upgraded in place.
    doNotDisturb: config.doNotDisturb ?? { state: 'unknown' },
    focusPreferences: {
      ...preferences,
      // A persisted 90-minute value without rest settings belongs to the old
      // Focus implementation. Migrate that legacy default to 45/15 once the
      // new concentration flow is used, without overwriting custom values.
      defaultDurationMinutes: !hasBreakDuration && preferences.defaultDurationMinutes === 90 ? 45 : Math.max(1, Math.min(480, preferences.defaultDurationMinutes ?? 45)),
      defaultBreakDurationMinutes: hasBreakDuration ? Math.max(1, Math.min(120, preferences.defaultBreakDurationMinutes)) : 15,
    },
  }
}

function currentConfig() {
  return getComputerConfig().then((config) => withFocusDefaults(config ?? defaultComputerConfig()))
}

async function native(tool: ComputerToolName, arguments_: Record<string, unknown>) {
  const request: ComputerNativeRequest = { tool, arguments: arguments_, route: 'deterministic', llmUsed: false }
  const result = await executeComputerTool(request)
  if (!result) throw new Error('Computer Control sólo está disponible en FARO Desktop.')
  return result
}

function appMessage(result: Awaited<ReturnType<typeof native>>) {
  return result.message || 'Listo.'
}

function focusDate(dateHint: 'today' | 'tomorrow' | undefined) {
  const start = new Date()
  if (dateHint === 'tomorrow') { start.setDate(start.getDate() + 1); start.setHours(9, 0, 0, 0) }
  else { start.setSeconds(0, 0); start.setMinutes(Math.ceil(start.getMinutes() / 5) * 5) }
  return start
}

function overlaps(start: Date, end: Date, busy: Array<{ start: string; end?: string; allDay: boolean }>) {
  return busy.find((item) => !item.allDay && item.end && Date.parse(item.start) < end.getTime() && Date.parse(item.end) > start.getTime())
}

function nextFreeSlot(start: Date, durationMinutes: number, busy: Array<{ start: string; end?: string; allDay: boolean }>) {
  const sorted = busy.filter((item) => item.end && !item.allDay).sort((a, b) => a.start.localeCompare(b.start))
  let candidate = new Date(start)
  for (const item of sorted) {
    const end = new Date(candidate.getTime() + durationMinutes * 60_000)
    if (Date.parse(item.start) >= end.getTime()) break
    if (item.end && Date.parse(item.end) > candidate.getTime()) candidate = new Date(item.end)
  }
  return candidate
}

function isoLabel(value: Date) {
  return value.toLocaleString('es-MX', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
}

async function prepareFocus(config: ComputerConfig, workspace: string, project: ProjectRegistryEntry | undefined, taskQuery: string | undefined, durationMinutes: number | undefined, dateHint: 'today' | 'tomorrow' | undefined): Promise<ComputerVoiceResult> {
  const existing = config.focusSession
  if (existing?.status === 'active' || existing?.status === 'paused' || existing?.status === 'break') return { handled: true, response: localResponse(`Ya tienes una sesión ${existing.status === 'break' ? 'en descanso' : existing.status === 'active' ? 'activa' : 'en pausa'} en ${existing.workspace}. No crearé una segunda sesión.`) }
  const duration = Math.max(15, Math.min(480, durationMinutes ?? config.focusPreferences.defaultDurationMinutes))
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { handled: true, response: { status: 'error', message: 'Inicia sesión en FARO para reservar el bloque de enfoque.', questions: [] } }
  const [calendar, workspaces, tasks] = await Promise.all([
    calendarRepository.getAll(user.id),
    workspaceRepository.getActive(user.id),
    taskQuery ? taskRepository.list(user.id) : Promise.resolve([]),
  ])
  const workspaceRow = workspaces.find((item) => normalizeComputerText(item.name) === normalizeComputerText(project?.workspaceName ?? workspace))
  const task = taskQuery ? tasks.find((item) => normalizeComputerText(item.title).includes(normalizeComputerText(taskQuery))) : undefined
  const requestedStart = focusDate(dateHint)
  const requestedEnd = new Date(requestedStart.getTime() + duration * 60_000)
  const busy = calendar.items.map((item) => ({ start: item.start, end: item.end, allDay: item.allDay }))
  const conflict = overlaps(requestedStart, requestedEnd, busy)
  const start = conflict ? nextFreeSlot(requestedStart, duration, busy) : requestedStart
  const end = new Date(start.getTime() + duration * 60_000)
  const session: FocusSession = {
    id: crypto.randomUUID(), workspace: workspaceRow?.name ?? project?.workspaceName ?? workspace,
    projectId: project?.id, projectName: project?.name, taskId: task?.id, taskTitle: task?.title,
    startTime: start.toISOString(), plannedDurationMinutes: duration, accumulatedActiveSeconds: 0, status: 'planned',
    doNotDisturbBefore: config.doNotDisturb.state,
  }
  const summary = `${session.workspace} · ${formatFocusDuration(duration * 60)} · ${isoLabel(start)}`
  const pending = localPending('startFocusSession', summary, { session, workspaceId: workspaceRow?.id, calendarStart: start.toISOString(), calendarEnd: end.toISOString() })
  const message = conflict
    ? `Tienes un compromiso en ese horario. Encontré ${formatFocusDuration(duration * 60)} libre ${isoLabel(start)}. ¿Confirmas el bloque de enfoque?`
    : `Reservaré ${formatFocusDuration(duration * 60)} para ${session.workspace} ${isoLabel(start)}. ¿Confirmas?`
  return { handled: true, response: localResponse(message, pending, { intent: 'start_focus', workspace: session.workspace, durationMinutes: duration, conflict: Boolean(conflict) }) }
}

type CalendarConcentration = { workspace: string; title: string; taskId?: string; durationMinutes: number }

async function startConcentration(config: ComputerConfig, testMode = false, calendar?: CalendarConcentration): Promise<ComputerVoiceResult> {
  const existing = config.focusSession
  if (existing?.status === 'active' || existing?.status === 'paused' || existing?.status === 'break') {
    return { handled: true, response: localResponse(`Ya tienes ${existing.status === 'break' ? 'un descanso' : 'una concentración'} en curso. Termínala o cambia la duración de esta sesión.`) }
  }
  const now = new Date()
  const duration = testMode ? 10 / 60 : Math.max(15, Math.min(480, calendar?.durationMinutes ?? config.focusPreferences.defaultDurationMinutes))
  const breakDuration = testMode ? 5 / 60 : config.focusPreferences.defaultBreakDurationMinutes
  const session: FocusSession = {
    id: crypto.randomUUID(),
    kind: 'concentration',
    phase: 'focus',
    workspace: calendar?.workspace ?? 'Concentración',
    taskId: calendar?.taskId,
    taskTitle: calendar?.title,
    startTime: now.toISOString(),
    activeSince: now.toISOString(),
    plannedDurationMinutes: duration,
    breakDurationMinutes: breakDuration,
    accumulatedActiveSeconds: 0,
    status: 'active',
    doNotDisturbBefore: testMode ? undefined : config.doNotDisturb.state,
  }
  let doNotDisturb = config.doNotDisturb
  let focusNotice = ''
  if (!testMode && config.focusPreferences.enableDoNotDisturb) {
    try {
      await native('setDoNotDisturb', { enabled: true })
      doNotDisturb = { state: 'enabled', managedAt: now.toISOString() }
    } catch {
      focusNotice = ' El temporizador sí inició; revisa los Shortcuts de Concentración en Ajustes si también quieres silenciar notificaciones.'
    }
  }
  await updateComputerConfig({ ...config, focusSession: session, doNotDisturb })
  return { handled: true, response: localResponse(testMode ? 'Prueba iniciada: 10 segundos de concentración y 5 de descanso.' : `Modo concentración activado: ${duration} minutos de enfoque y ${breakDuration} de descanso.${focusNotice}`, undefined, { intent: 'concentration_started', focusSession: session }) }
}

/**
 * Starts the same local concentration cycle used by the voice command, but
 * without opening a voice channel. FARO Mini uses this for people who want to
 * begin working quietly in a shared space.
 */
export async function startSilentConcentration(testMode = false): Promise<ComputerVoiceResult> {
  if (!isFaroDesktop()) {
    return { handled: true, response: localResponse('El modo concentración silencioso sólo está disponible en FARO Desktop.') }
  }
  const config = await currentConfig()
  return startConcentration(config, testMode)
}

/** Starts a scheduled task's concentration with the exact block duration. */
export async function startCalendarConcentration(calendar: CalendarConcentration): Promise<ComputerVoiceResult> {
  if (!isFaroDesktop()) return { handled: true, response: localResponse('El modo concentración programado sólo está disponible en FARO Desktop.') }
  return startConcentration(await currentConfig(), false, calendar)
}

/** Direct Mini controls deliberately bypass Voice: a timer must work quietly. */
export async function toggleSilentConcentrationPause(): Promise<ComputerVoiceResult> {
  const config = await currentConfig()
  const session = config.focusSession
  if (!session || session.kind !== 'concentration' || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) {
    return { handled: true, response: localResponse('No hay una concentración activa para pausar o continuar.') }
  }
  const nextSession = session.status === 'paused' ? resumeFocusSession(session) : pauseFocusSession(session)
  await updateComputerConfig({ ...config, focusSession: nextSession })
  return {
    handled: true,
    response: localResponse(nextSession.status === 'paused' ? 'Concentración en pausa.' : nextSession.phase === 'break' ? 'Descanso reanudado.' : 'Concentración reanudada.'),
  }
}

/** Moves a quick concentration to its configured rest interval immediately. */
export async function startSilentConcentrationBreak(): Promise<ComputerVoiceResult> {
  const config = await currentConfig()
  const session = config.focusSession
  if (!session || session.kind !== 'concentration' || session.phase === 'break' || (session.status !== 'active' && session.status !== 'paused')) {
    return { handled: true, response: localResponse('No hay una concentración activa que pueda pasar a descanso.') }
  }
  const now = new Date()
  const nextSession: FocusSession = {
    ...session,
    phase: 'break',
    status: 'break',
    accumulatedActiveSeconds: session.plannedDurationMinutes * 60,
    breakElapsedSeconds: 0,
    activeSince: now.toISOString(),
    pausedAt: undefined,
  }
  await updateComputerConfig({ ...config, focusSession: nextSession })
  return { handled: true, response: localResponse(`Descanso iniciado: ${nextSession.breakDurationMinutes ?? 15} minutos.`) }
}

/** Cancelling a concentration is distinct from completing it and restores DND. */
export async function cancelSilentConcentration(): Promise<ComputerVoiceResult> {
  const config = await currentConfig()
  const session = config.focusSession
  if (!session || session.kind !== 'concentration' || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) {
    return { handled: true, response: localResponse('No hay una concentración activa para cancelar.') }
  }
  const now = new Date()
  let doNotDisturb = config.doNotDisturb
  if (session.doNotDisturbBefore && session.doNotDisturbBefore !== 'unknown' && config.focusPreferences.enableDoNotDisturb) {
    try {
      await native('setDoNotDisturb', { enabled: session.doNotDisturbBefore === 'enabled' })
      doNotDisturb = { state: session.doNotDisturbBefore, managedAt: now.toISOString() }
    } catch {
      // The local cancellation must never remain blocked by a missing Shortcut.
    }
  }
  const nextSession: FocusSession = {
    ...session,
    status: 'cancelled',
    actualDurationSeconds: focusElapsedSeconds(session, now),
    completedAt: now.toISOString(),
    pausedAt: undefined,
  }
  await updateComputerConfig({ ...config, focusSession: nextSession, doNotDisturb })
  return { handled: true, response: localResponse('Concentración cancelada. No guardé esta sesión como completada.') }
}

async function changeFocusDuration(config: ComputerConfig, durationMinutes: number): Promise<ComputerVoiceResult> {
  const session = config.focusSession
  if (!session || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) {
    return { handled: true, response: localResponse('No hay una concentración activa para cambiar.') }
  }
  if (session.phase === 'break' || session.status === 'break') {
    return { handled: true, response: localResponse('Ahora estás en descanso. Esta orden cambia sólo la duración de enfoque; úsala al iniciar la siguiente concentración.') }
  }
  const nextSession = { ...session, plannedDurationMinutes: durationMinutes }
  const advanced = advanceConcentrationSession(nextSession)
  await updateComputerConfig({ ...config, focusSession: advanced ?? nextSession })
  const elapsed = formatFocusDuration(focusElapsedSeconds(nextSession))
  if (advanced?.status === 'break') return { handled: true, response: localResponse(`La sesión quedó en ${durationMinutes} minutos. Ya completaste ${elapsed}, así que inicia tu descanso de ${nextSession.breakDurationMinutes ?? 15} minutos.`) }
  return { handled: true, response: localResponse(`Listo: esta concentración dura ${durationMinutes} minutos. Llevas ${elapsed}. No cambié tu configuración por defecto.`) }
}

async function openProject(project: ProjectRegistryEntry) {
  const actions: Array<() => Promise<unknown>> = []
  if (project.editorApp) actions.push(() => native('openFile', { path: project.path, app: project.editorApp }))
  else actions.push(() => native('openFile', { path: project.path }))
  if (project.openFinder) actions.push(() => native('revealInFinder', { path: project.path }))
  for (const app of project.apps) actions.push(() => native('openApp', { app }))
  for (const url of project.urls) actions.push(() => native('openUrl', { url }))
  await Promise.all(actions.map((action) => action()))
  return `Abrí el proyecto ${project.name}.`
}

async function executeAutomationAction(config: ComputerConfig, action: AutomationAction) {
  if (action.type === 'activateFocus') {
    if (!config.focusPreferences.enableDoNotDisturb) return
    await native('setDoNotDisturb', { enabled: true })
    return
  }
  if (action.type === 'setDoNotDisturb') return native('setDoNotDisturb', { enabled: action.enabled })
  if (action.type === 'openApp') return native('openApp', { app: action.app })
  if (action.type === 'openUrl') return native('openUrl', { url: action.url })
  const project = config.projects.find((item) => item.id === action.projectId)
  if (!project) throw new Error('El proyecto de esta automatización ya no existe.')
  return openProject(project)
}

async function executeStartFocus(action: PendingVoiceAction, config: ComputerConfig) {
  const session = action.arguments.session as FocusSession | undefined
  const calendarStart = action.arguments.calendarStart as string | undefined
  const calendarEnd = action.arguments.calendarEnd as string | undefined
  const workspaceId = typeof action.arguments.workspaceId === 'string' ? action.arguments.workspaceId : undefined
  if (!session || !calendarStart || !calendarEnd) throw new Error('La propuesta de enfoque ya no es válida.')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Tu sesión de FARO expiró.')
  const entry = await calendarEntryRepository.create({
    title: `Focus · ${session.workspace}${session.taskTitle ? ` · ${session.taskTitle}` : ''}`,
    kind: 'focus', startsAt: calendarStart, endsAt: calendarEnd, allDay: false, workspaceId, linkedTaskId: session.taskId,
  }, user.id)
  const startsNow = Date.parse(calendarStart) <= Date.now() + 60_000
  const nextSession: FocusSession = startsNow
    ? { ...session, calendarEntryId: entry.id, status: 'active', activeSince: new Date().toISOString() }
    : { ...session, calendarEntryId: entry.id, status: 'planned' }
  if (startsNow && session.taskId) {
    const task = await taskRepository.getById(session.taskId, user.id)
    if (task && (task.status === 'todo' || task.status === 'inbox')) await taskRepository.update({ ...task, status: 'doing', updatedAt: new Date().toISOString() }, user.id)
  }
  if (startsNow && config.focusPreferences.enableDoNotDisturb) await native('setDoNotDisturb', { enabled: true })
  if (startsNow && session.projectId) {
    const project = config.projects.find((item) => item.id === session.projectId)
    if (project) await openProject(project)
  }
  const next = { ...config, focusSession: nextSession, ...(startsNow && config.focusPreferences.enableDoNotDisturb ? { doNotDisturb: { state: 'enabled' as const, managedAt: new Date().toISOString() } } : {}) }
  await updateComputerConfig(next)
  window.dispatchEvent(new Event('faro:calendar-updated'))
  return localResponse(startsNow ? `Enfoque iniciado en ${nextSession.workspace}.` : `Reservé el enfoque en ${nextSession.workspace}. Se activará cuando lo inicies.`, undefined, { intent: startsNow ? 'focus_started' : 'focus_planned', focusSession: nextSession })
}

export async function tryHandleComputerVoiceCommand(message: string): Promise<ComputerVoiceResult | undefined> {
  if (!isFaroDesktop()) return undefined
  const config = await currentConfig()
  const route = routeComputerVoiceCommand(message, config)
  if (route.kind === 'unhandled') return undefined
  if (route.kind === 'needsConfiguration') return { handled: true, response: localResponse(route.message) }
  if (route.kind === 'tool') {
    if (route.confirmationRequired) return { handled: true, response: localResponse(`Esto puede afectar tu trabajo actual. ¿Confirmas?`, localPending('computerAction', route.summary, { tool: route.tool, toolArguments: route.arguments })) }
    const result = await native(route.tool, route.arguments)
    return { handled: true, response: localResponse(appMessage(result), undefined, { intent: route.tool, llmUsed: false }) }
  }
  if (route.kind === 'openProject') return { handled: true, response: localResponse(await openProject(route.project), undefined, { intent: 'open_project', project: route.project.name, llmUsed: false }) }
  if (route.kind === 'startFocus') return route.workspace === 'Concentración' && !route.project && !route.taskQuery
    ? startConcentration(config)
    : prepareFocus(config, route.workspace, route.project, route.taskQuery, route.durationMinutes, route.dateHint)
  if (route.kind === 'changeFocusDuration') return changeFocusDuration(config, route.durationMinutes)
  if (route.kind === 'pauseFocus' || route.kind === 'resumeFocus') {
    const session = config.focusSession
    if (!session || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) return { handled: true, response: localResponse('No hay una sesión de enfoque activa.') }
    const nextSession = route.kind === 'pauseFocus' ? pauseFocusSession(session) : resumeFocusSession(session)
    await updateComputerConfig({ ...config, focusSession: nextSession })
    return { handled: true, response: localResponse(route.kind === 'pauseFocus' ? `Pausé tu sesión en ${session.workspace}.` : `Continuamos con ${session.workspace}.`) }
  }
  if (route.kind === 'finishFocus') {
    const session = config.focusSession
    if (!session || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) return { handled: true, response: localResponse('No hay una sesión de enfoque activa para terminar.') }
    const completed = completeFocusSession(session)
    const next = { ...config, focusSession: completed }
    await updateComputerConfig(next)
    if (completed.calendarEntryId) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await calendarEntryRepository.updateSchedule(completed.calendarEntryId, session.startTime, new Date().toISOString(), user.id)
    }
    if (session.doNotDisturbBefore && session.doNotDisturbBefore !== 'unknown' && config.focusPreferences.enableDoNotDisturb) await native('setDoNotDisturb', { enabled: session.doNotDisturbBefore === 'enabled' })
    window.dispatchEvent(new Event('faro:calendar-updated'))
    if (completed.taskId && completed.taskTitle) {
      const pending = localPending('finishFocusTask', `Marcar “${completed.taskTitle}” como completada.`, { taskId: completed.taskId, focusSessionId: completed.id })
      return { handled: true, response: localResponse(`Trabajaste ${formatFocusDuration(completed.actualDurationSeconds ?? 0)} en ${completed.taskTitle}. ¿La marco como completada?`, pending) }
    }
    return { handled: true, response: localResponse(`Sesión terminada: ${formatFocusDuration(completed.actualDurationSeconds ?? 0)} en ${completed.workspace}.`) }
  }
  if (route.kind === 'runAutomation') return { handled: true, response: localResponse(`“${route.automation.name}” realizará ${route.automation.actions.length} acciones locales. ¿Confirmas?`, localPending('computerAction', route.summary, { automationId: route.automation.id })) }
  if (route.kind === 'teachAutomation') return { handled: true, response: localResponse(`Crearé “${route.automation.name}” con ${route.automation.actions.length} acciones. ¿Confirmas?`, localPending('saveAutomation', route.summary, { automation: route.automation })) }
  return undefined
}

/** Keeps the local Pomodoro transition alive even when no voice turn occurs. */
export async function advanceTimedConcentration(config: ComputerConfig) {
  const session = config.focusSession
  if (!session) return undefined
  const nextSession = advanceConcentrationSession(session)
  if (!nextSession) return undefined
  const next = { ...config, focusSession: nextSession }
  const restoreDoNotDisturb = session.doNotDisturbBefore
  if (nextSession.status === 'completed' && restoreDoNotDisturb && restoreDoNotDisturb !== 'unknown' && config.focusPreferences.enableDoNotDisturb) {
    try {
      await native('setDoNotDisturb', { enabled: restoreDoNotDisturb === 'enabled' })
      next.doNotDisturb = { state: restoreDoNotDisturb, managedAt: new Date().toISOString() }
    } catch {
      // The timed session still ends locally; a missing Shortcut must not
      // leave the timer stuck in its final minute.
    }
  }
  return updateComputerConfig(next)
}

export async function resolveComputerPendingAction(action: PendingVoiceAction, confirmed: boolean): Promise<VoiceResponse | undefined> {
  if (!isComputerPendingTool(action.toolName) || action.arguments.desktopLocal !== true) return undefined
  if (!confirmed) return localResponse('De acuerdo. No ejecuté esa acción local.')
  const config = await currentConfig()
  if (action.toolName === 'computerAction') {
    const automationId = typeof action.arguments.automationId === 'string' ? action.arguments.automationId : undefined
    if (automationId) {
      const automation = config.automations.find((item) => item.id === automationId && item.enabled)
      if (!automation) throw new Error('Esa automatización ya no está disponible.')
      for (const item of automation.actions) await executeAutomationAction(config, item)
      return localResponse(`Ejecuté “${automation.name}”.`, undefined, { intent: 'run_automation', automation: automation.name })
    }
    const tool = action.arguments.tool
    if (typeof tool !== 'string') throw new Error('La acción local no es válida.')
    const result = await native(tool as ComputerToolName, (action.arguments.toolArguments as Record<string, unknown>) ?? {})
    return localResponse(appMessage(result), undefined, { intent: tool })
  }
  if (action.toolName === 'startFocusSession') return executeStartFocus(action, config)
  if (action.toolName === 'finishFocusTask') {
    const taskId = typeof action.arguments.taskId === 'string' ? action.arguments.taskId : ''
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !taskId) throw new Error('No pude encontrar la tarea de esta sesión.')
    const task = await taskRepository.getById(taskId, user.id)
    if (!task) throw new Error('La tarea ya no existe.')
    await taskRepository.update({ ...task, status: 'done', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, user.id)
    window.dispatchEvent(new CustomEvent('faro:backlog-updated', { detail: { toolName: 'finishFocusTask' } }))
    return localResponse(`Marqué “${task.title}” como completada.`)
  }
  const automation = action.arguments.automation as ComputerConfig['automations'][number] | undefined
  if (!automation) throw new Error('La automatización propuesta no es válida.')
  if (config.automations.some((item) => normalizeComputerText(item.trigger.phrase) === normalizeComputerText(automation.trigger.phrase))) throw new Error('Ya existe una automatización con esa frase.')
  await updateComputerConfig({ ...config, automations: [...config.automations, automation] })
  return localResponse(`Guardé la automatización “${automation.name}”.`)
}

export function activeFocusSnapshot(config: ComputerConfig | undefined) {
  const session = config?.focusSession
  if (!session || (session.status !== 'active' && session.status !== 'paused' && session.status !== 'break')) return undefined
  const seconds = session.status === 'active'
    ? session.accumulatedActiveSeconds + Math.max(0, Math.floor((Date.now() - Date.parse(session.activeSince ?? session.startTime)) / 1000))
    : session.accumulatedActiveSeconds
  return { workspace: session.workspace, status: session.status, phase: session.phase ?? 'focus', elapsedSeconds: seconds }
}
