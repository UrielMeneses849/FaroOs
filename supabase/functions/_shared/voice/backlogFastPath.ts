import { normalizeVoiceText } from './financeFastPath.ts'
import { routeCalendarIntent } from './calendarFastPath.ts'

export type BacklogFastIntent =
  | 'list_backlog_tasks'
  | 'find_backlog_task'
  | 'list_tasks_by_workspace'
  | 'list_tasks_by_status'
  | 'list_tasks_due_today'
  | 'list_overdue_tasks'
  | 'get_current_task'
  | 'get_scheduled_tasks'
  | 'create_backlog_task'
  | 'schedule_backlog_task'
  | 'move_backlog_task_schedule'
  | 'unschedule_backlog_task'
  | 'update_backlog_task'
  | 'update_backlog_status'
  | 'delete_backlog_task'
  | 'unknown'

export type BacklogStatus = 'todo' | 'doing' | 'blocked' | 'done'
export type BacklogPriority = 'low' | 'medium' | 'high' | 'critical'

export type BacklogFastRoute = {
  skill: 'backlog'
  intent: BacklogFastIntent
  confidence: number
  entities: {
    normalized: string
    ordinal?: number
    workspaceName?: string
    targetTitle?: string
    createTitle?: string
    newTitle?: string
    description?: string
    projectName?: string
    status?: BacklogStatus
    priority?: BacklogPriority
    durationMinutes?: number
    time?: string
    endTime?: string
    relativeMinutes?: number
    hasDate: boolean
    unscheduledOnly?: boolean
  }
}

const wordNumbers: Record<string, number> = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }

function ordinal(value: string) {
  if (/\b(?:esa|ese|la anterior|el anterior|primera|primero|uno)\b/.test(value)) return 1
  if (/\b(?:segunda|segundo|dos)\b/.test(value)) return 2
  if (/\b(?:tercera|tercero|tres)\b/.test(value)) return 3
  return undefined
}

function duration(value: string) {
  const numeric = value.match(/\b(\d+(?:\.\d+)?)\s*(horas?|hrs?|minutos?|mins?)\b/)
  const word = value.match(/\b(una|un|dos|tres|cuatro|cinco|seis)\s+horas?\b/)
  const amount = numeric ? Number(numeric[1]) : word ? wordNumbers[word[1]] : undefined
  if (!amount) return undefined
  return /min/.test(numeric?.[2] ?? '') ? Math.round(amount) : Math.round(amount * 60)
}

function status(value: string): BacklogStatus | undefined {
  if (/\b(?:reabre|reabreme|regresa.*por hacer)\b/.test(value)) return 'todo'
  if (/\b(?:terminad[ao]s?|completad[ao]s?|hech[ao]s?)\b/.test(value)) return 'done'
  if (/\b(?:en progreso|progreso|haciendo|hacer ahora)\b/.test(value)) return 'doing'
  if (/\b(?:en revision|revision|revisar|bloquead[ao]s?)\b/.test(value)) return 'blocked'
  if (/\b(?:por hacer|pendiente|pendientes|todo)\b/.test(value)) return 'todo'
  return undefined
}

function priority(value: string): BacklogPriority | undefined {
  if (/\b(?:critica|critico)\b/.test(value)) return 'critical'
  if (/\b(?:alta|alto)\b/.test(value)) return 'high'
  if (/\b(?:baja|bajo)\b/.test(value)) return 'low'
  if (/\b(?:media|medio)\b/.test(value)) return 'medium'
  return undefined
}

function cleanTitle(value?: string) {
  return value?.trim().replace(/^['"“]|['"”.,?!]+$/g, '').trim().slice(0, 120) || undefined
}

function workspaceHint(message: string, normalized: string) {
  const direct = message.match(/\b(?:tarea\s+)?(?:a|de|en)\s+([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:para|con|hoy|mañana|manana|el\s+\d|a\s+las?|de\s+\d)|[,.?!]|$)/iu)?.[1]
  if (direct && !/^(?:la|el|esta|esta tarea|calendario|backlog)$/i.test(direct.trim())) return direct.trim()
  const listed = normalized.match(/\bque tengo de\s+([a-z0-9 ._-]+?)(?:[?.!]|$)/)?.[1]
  return listed?.trim()
}

function createTitle(message: string) {
  const cleaned = message.trim().replace(/[.?!]+$/, '')
  const explicit = cleaned.match(/\b(?:crea|crear|agrega|agregar|anade|anadir).*?\bpara\s+(.+)$/iu)?.[1]
    ?? cleaned.match(/\b(?:crea|crear|agrega|agregar|anade|anadir)\s+(?:una?\s+)?tarea(?:\s+(?:a|de|en)\s+[\p{L}0-9 ._-]+?)?\s+(?:para|que\s+sea)\s+(.+)$/iu)?.[1]
    ?? cleaned.match(/\b(?:agrega|agregar)\s+(?:al\s+)?backlog\s+(.+)$/iu)?.[1]
    ?? cleaned.match(/\b(?:crea|crear)\s+(?:una?\s+)?(?:tarea|pendiente)\s+(.+)$/iu)?.[1]
  return cleanTitle(explicit?.replace(/\s+\b(?:hoy|mañana|manana|a\s+las?\s+\d{1,2}(?::\d{2})?).*$/i, ''))
}

function targetTitle(message: string) {
  const patterns = [
    /\b(?:mueve|mover|programa|programar|agenda|agendar|desprograma|quita|elimina|borra|cambia|renombra|marca|reabre)\s+(?:la\s+)?(?:tarea\s+)?(?:llamada\s+)?([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:a\s+las?|para|mañana|manana|el\s+\d|una\s+hora|dos\s+horas|en\s+progreso|terminada|completada|del\s+calendario|con\s+prioridad|de\s+prioridad)|[,.?!]|$)/iu,
    /\b(?:tarea|pendiente)\s+(?:llamada\s+)?([\p{L}0-9][\p{L}0-9 ._-]*?)(?=\s+(?:a\s+las?|para|mañana|manana|en\s+progreso|terminada|completada)|[,.?!]|$)/iu,
  ]
  for (const pattern of patterns) {
    const candidate = cleanTitle(message.match(pattern)?.[1])
    if (candidate && !/^(?:esa|esta|la segunda|la primera|la anterior)$/i.test(candidate)) return candidate
  }
  return undefined
}

function newTitle(message: string) {
  return cleanTitle(message.match(/\b(?:cambia(?:le)?|renombra(?:la)?|ponle)\s+(?:el\s+)?(?:titulo|título|nombre)\s+(?:a\s+)?(.+)$/iu)?.[1])
}

export function routeBacklogIntent(message: string): BacklogFastRoute {
  const normalized = normalizeVoiceText(message)
  const calendar = routeCalendarIntent(message)
  const create = /\b(?:crea|crear|agrega|agregar|anade|anadir)\b/.test(normalized)
  const hasTaskWord = /\b(?:tarea|tareas|backlog|pendiente|pendientes)\b/.test(normalized)
  const moving = /\b(?:mueve|muevela|muevelo|mover|pasala|pasalo|cambiala|cambialo|recorre|reprograma)\b/.test(normalized)
  const scheduling = /\b(?:programa|programar|agenda|agendar|ponla|ponlo|busca\s+(?:un\s+)?(?:espacio|hueco))\b/.test(normalized)
  const unschedule = /\b(?:desprograma|desagend|quita|quitala|quitale|deja)\b/.test(normalized) && /\b(?:calendario|agenda|sin\s+horario|sin\s+programar)\b/.test(normalized)
  const calendarHasDate = /\b(?:hoy|mañana|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}\s+de\s+\p{L}+)\b/iu.test(message)
  const nextStatus = status(normalized)
  const nextPriority = priority(normalized)
  const entities = {
    normalized,
    ordinal: ordinal(normalized),
    workspaceName: workspaceHint(message, normalized),
    targetTitle: targetTitle(message),
    createTitle: createTitle(message),
    newTitle: newTitle(message),
    description: cleanTitle(message.match(/\b(?:descripcion|descripción|detalle|notas?)\s+(?:a|como)?\s*(.+)$/iu)?.[1]),
    projectName: cleanTitle(message.match(/\b(?:al|al proyecto|proyecto)\s+([\p{L}0-9][\p{L}0-9 ._-]*?)(?=[,.?!]|$)/iu)?.[1]),
    status: nextStatus,
    priority: nextPriority,
    durationMinutes: duration(normalized) ?? calendar.entities.durationMinutes,
    time: calendar.entities.time,
    endTime: calendar.entities.endTime,
    relativeMinutes: calendar.entities.relativeMinutes,
    hasDate: calendarHasDate,
    unscheduledOnly: /\b(?:sin programar|sin horario|no programad[ao]s?)\b/.test(normalized),
  }
  const base = { skill: 'backlog' as const, entities }

  if (unschedule) return { ...base, intent: 'unschedule_backlog_task', confidence: .99 }
  if (/\b(?:programad[ao]s?|sin programar|sin horario)\b/.test(normalized) && /\b(?:que|cuales|tareas|tengo)\b/.test(normalized)) return { ...base, intent: 'get_scheduled_tasks', confidence: .98 }
  if (create && (hasTaskWord || /\bagrega al backlog\b/.test(normalized))) return { ...base, intent: 'create_backlog_task', confidence: .98 }
  if (/\b(?:elimina|eliminar|eliminala|eliminalo|borra|borrar|borrala|borralo)\b/.test(normalized) && (hasTaskWord || entities.targetTitle || entities.ordinal || /\b(?:la|lo|esa|ese|eliminala|eliminalo|borrala|borralo)\b/.test(normalized))) return { ...base, intent: 'delete_backlog_task', confidence: .98 }
  if ((/\b(?:marca|pon|pasa|regresa|reabre)\b/.test(normalized) && nextStatus) || /\b(?:termina|completa)\b/.test(normalized)) return { ...base, intent: 'update_backlog_status', confidence: .97 }
  if (moving) return { ...base, intent: 'move_backlog_task_schedule', confidence: .96 }
  if (scheduling && (hasTaskWord || entities.ordinal || entities.targetTitle || /\b(?:ponla|ponlo)\b/.test(normalized))) return { ...base, intent: 'schedule_backlog_task', confidence: .96 }
  if (entities.newTitle || entities.description || entities.projectName || nextPriority || /\b(?:cambia(?:la|le)?\s+(?:a|de)\s+[\p{L}0-9])/iu.test(message) || /\b(?:dure|duracion|duración|fecha objetivo)\b/.test(normalized)) return { ...base, intent: 'update_backlog_task', confidence: .91 }
  if (/\b(?:que estoy haciendo|que hago ahora|tarea actual|actualmente)\b/.test(normalized)) return { ...base, intent: 'get_current_task', confidence: .99 }
  if (/\b(?:vencen hoy|vence hoy|para hoy)\b/.test(normalized)) return { ...base, intent: 'list_tasks_due_today', confidence: .99 }
  if (/\b(?:vencid[ao]s?|atrasad[ao]s?)\b/.test(normalized)) return { ...base, intent: 'list_overdue_tasks', confidence: .99 }
  if (/\b(?:en revision|revision|en progreso|completad[ao]s?|terminad[ao]s?|por hacer)\b/.test(normalized) && /\b(?:que|cuales|tareas|tengo)\b/.test(normalized)) return { ...base, intent: 'list_tasks_by_status', confidence: .98 }
  if (/\b(?:busca|buscar|encuentra|encontrar)\b/.test(normalized) && hasTaskWord) return { ...base, intent: 'find_backlog_task', confidence: .94 }
  if (/\b(?:que tengo de|tareas de|pendiente(?:s)? de)\b/.test(normalized) && entities.workspaceName) return { ...base, intent: 'list_tasks_by_workspace', confidence: .94 }
  if (/\b(?:que tengo|que me falta|mis pendientes|pendientes|backlog|tareas)\b/.test(normalized)) return { ...base, intent: 'list_backlog_tasks', confidence: .96 }
  return { ...base, intent: 'unknown', confidence: 0 }
}
