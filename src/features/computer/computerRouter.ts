import type { AutomationAction, ComputerConfig, ComputerToolName, ComputerVoiceRoute, FaroAutomation, ProjectRegistryEntry } from './computerTypes'
import { computerToolDefinition } from './computerTypes'

export const normalizeComputerText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const cleanSpokenEntity = (value: string) => value.trim().replace(/[.!?,;:]+$/g, '').trim()

function durationMinutes(value: string) {
  const normalized = normalizeComputerText(value)
  const number = normalized.match(/\b(\d+)\s*(?:hora|horas|hr|hrs|minuto|minutos|min)\b/)
  if (number) {
    const amount = Number(number[1])
    return /min/.test(number[0]) ? amount : amount * 60
  }
  const words: Record<string, number> = { una: 60, un: 60, dos: 120, tres: 180, cuatro: 240 }
  const word = Object.entries(words).find(([candidate]) => new RegExp(`\\b${candidate}\\s+hora`).test(normalized))
  return word?.[1]
}

function resolveProject(value: string, projects: ProjectRegistryEntry[]) {
  const normalized = normalizeComputerText(value)
  return projects.find((project) => {
    const name = normalizeComputerText(project.name)
    return normalized === name || normalized.includes(name) || name.includes(normalized)
  })
}

function routeTool(tool: ComputerToolName, arguments_: Record<string, unknown>, summary: string): ComputerVoiceRoute {
  return { kind: 'tool', tool, arguments: arguments_, summary, confirmationRequired: computerToolDefinition(tool)?.confirmationRequired ?? true }
}

function automationFromTeaching(raw: string, config: ComputerConfig): FaroAutomation | undefined {
  const match = raw.match(/cuando\s+(?:me\s+)?digas\s+[“"']?(.+?)[”"']?\s*,?\s*quiero que\s+(.+)/i)
  if (!match) return undefined
  const phrase = match[1].trim().replace(/[“”"']/g, '')
  const instructions = match[2]
  if (!phrase || phrase.length > 80) return undefined
  const actions: AutomationAction[] = []
  const project = resolveProject(instructions, config.projects)
  if (/concentracion|concentrarme|focus/.test(normalizeComputerText(instructions))) actions.push({ type: 'activateFocus' })
  if (project) actions.push({ type: 'openProject', projectId: project.id })
  for (const app of ['Visual Studio Code', 'VS Code', 'Spotify', 'Google Chrome', 'Safari']) {
    if (normalizeComputerText(instructions).includes(normalizeComputerText(app))) actions.push({ type: 'openApp', app })
  }
  if (!actions.length) return undefined
  return { id: crypto.randomUUID(), name: phrase.replace(/^modo\s+/i, 'Modo '), trigger: { type: 'voice_phrase', phrase }, conditions: {}, actions, enabled: true }
}

export function routeComputerVoiceCommand(value: string, config: ComputerConfig): ComputerVoiceRoute {
  const raw = value.trim()
  const normalized = normalizeComputerText(raw)
  if (!raw || !config.enabled) return { kind: 'unhandled' }

  const taught = automationFromTeaching(raw, config)
  if (taught) return { kind: 'teachAutomation', automation: taught, summary: `Guardar automatización “${taught.name}” con ${taught.actions.length} acción${taught.actions.length === 1 ? '' : 'es'}.` }

  const automation = config.automations.find((candidate) => candidate.enabled && normalizeComputerText(candidate.trigger.phrase) === normalized)
  if (automation) return { kind: 'runAutomation', automation, summary: `Ejecutar “${automation.name}” (${automation.actions.length} acciones).` }

  if (/\b(?:para|deten|detener|termina|terminar|finaliza|finalizar)\b.*\bmodo\s+(?:de\s+)?concentracion\b/.test(normalized)) return { kind: 'finishFocus', summary: 'Terminar modo concentración.' }
  const changeDuration = normalized.match(/\b(?:cambia|cambiar|ajusta|ajustar)\b.*\bduracion\b.*\b(?:concentracion|focus|enfoque)\b/)
  if (changeDuration) {
    const duration = durationMinutes(raw)
    return duration
      ? { kind: 'changeFocusDuration', durationMinutes: Math.max(5, Math.min(480, duration)), summary: `Cambiar duración de esta concentración a ${duration} minutos.` }
      : { kind: 'needsConfiguration', message: 'Dime la nueva duración en minutos, por ejemplo: “Cambia la duración de la concentración a 30 minutos”.' }
  }
  if (/\b(?:pausa|pausar)\b/.test(normalized)) return { kind: 'pauseFocus', summary: 'Pausar sesión de enfoque.' }
  if (/\b(?:continuamos|continuar|reanuda|reanudar)\b/.test(normalized)) return { kind: 'resumeFocus', summary: 'Reanudar sesión de enfoque.' }
  if (/^(?:faro\s+)?(?:termine|terminé|acab[eé]|finalice|finalicé)(?:\s+de\s+trabajar)?$/.test(normalized)) return { kind: 'finishFocus', summary: 'Terminar sesión de enfoque.' }

  if (/\b(?:bloquea|bloquear)\b.*\b(?:mac|computadora|equipo)\b/.test(normalized)) return routeTool('lockComputer', {}, 'Bloquear este Mac.')
  if (/\b(?:lista|muestra)\b.*\b(?:apps|aplicaciones)\b.*\b(?:abiertas|ejecucion|ejecución)?\b/.test(normalized)) return routeTool('listRunningApps', {}, 'Listar aplicaciones abiertas.')
  const running = raw.match(/^(?:esta|está)\s+abiert[oa]\s+(.+?)\??$/i) ?? raw.match(/^(.+?)\s+(?:esta|está)\s+abiert[oa]\??$/i)
  if (running) { const app = cleanSpokenEntity(running[1]); return routeTool('isAppRunning', { app }, `Comprobar si ${app} está abierto.`) }
  const focus = raw.match(/^\s*(?:enfoca|trae al frente)\s+(.+?)\s*$/i)
  if (focus) { const app = cleanSpokenEntity(focus[1]); return routeTool('focusApp', { app }, `Enfocar ${app}.`) }
  if (/\b(?:silencia|silenciar|mutea)\b/.test(normalized)) return routeTool('mute', {}, 'Silenciar el volumen.')
  if (/\b(?:activa|quitar|quita|desactiva)\b.*\b(?:silencio|mute)\b/.test(normalized)) return routeTool('unmute', {}, 'Restaurar el volumen.')
  if (/\b(?:sube|aumenta)\b.*\bvolumen\b/.test(normalized)) return routeTool('volumeUp', {}, 'Subir el volumen.')
  if (/\b(?:baja|reduce)\b.*\bvolumen\b/.test(normalized)) return routeTool('volumeDown', {}, 'Bajar el volumen.')
  const volume = normalized.match(/\bvolumen\s+(?:al?|en)\s*(\d{1,3})\b/)
  if (volume) return routeTool('setVolume', { percent: Math.max(0, Math.min(100, Number(volume[1]))) }, `Ajustar el volumen a ${volume[1]}%.`)
  if (/\bnight shift\b/.test(normalized)) {
    const enabled = !/\b(?:desactiva|apaga|quita|deshabilita)\b/.test(normalized)
    return routeTool('setNightShift', { enabled }, `${enabled ? 'Activar' : 'Desactivar'} Night Shift.`)
  }
  if (/\bbrillo\b/.test(normalized)) {
    if (/\b(?:maximo|max|al tope)\b/.test(normalized)) return routeTool('setBrightness', { level: 'max' }, 'Subir el brillo al máximo.')
    if (/\b(?:minimo|min)\b/.test(normalized)) return routeTool('setBrightness', { level: 'min' }, 'Bajar el brillo al mínimo.')
    if (/\b(?:sube|aumenta|mas)\b/.test(normalized)) return routeTool('brightnessUp', {}, 'Subir el brillo.')
    if (/\b(?:baja|reduce|menos)\b/.test(normalized)) return routeTool('brightnessDown', {}, 'Bajar el brillo.')
  }
  if (/\b(?:activa|activar|inicia|iniciar)\b.*\bmodo\s+(?:de\s+)?concentracion\b/.test(normalized)) return { kind: 'startFocus', workspace: 'Concentración', durationMinutes: 45, summary: 'Activar modo concentración.' }
  if (/\bmodo\s+(?:de\s+)?concentracion\b/.test(normalized)) return { kind: 'startFocus', workspace: 'Concentración', durationMinutes: 45, summary: 'Activar modo concentración.' }

  const projectMatch = raw.match(/\b(?:abre|abrir)\s+(?:el\s+)?proyecto\s+(?:de\s+)?(.+)$/i)
  if (projectMatch) {
    const project = resolveProject(projectMatch[1], config.projects)
    return project
      ? { kind: 'openProject', project, summary: `Abrir proyecto ${project.name}.` }
      : { kind: 'needsConfiguration', message: `No tengo un proyecto local llamado “${projectMatch[1].trim()}”. Agrégalo en Configuración → Computer → Project Registry.` }
  }

  const layoutMatch = raw.match(/\b(?:acomoda|organiza|ordena)\s+(?:las\s+)?ventanas(?:\s+en)?\s+(.+)$/i)
  if (layoutMatch) {
    const layout = config.layouts.find((item) => normalizeComputerText(item.name) === normalizeComputerText(layoutMatch[1]))
    return layout
      ? routeTool('arrangeWorkLayout', { windows: layout.windows }, `Aplicar layout ${layout.name}.`)
      : { kind: 'needsConfiguration', message: `No tengo un layout llamado “${layoutMatch[1].trim()}”. Configúralo en Ajustes → Computer.` }
  }

  const openFile = raw.match(/^\s*(?:abre|abrir)\s+(?:el\s+)?(?:archivo|carpeta)\s+(.+?)\s*$/i)
  if (openFile) return routeTool('openFile', { path: openFile[1] }, `Abrir ${openFile[1]}.`)
  const reveal = raw.match(/^\s*(?:muestra|revela)\s+(?:en\s+finder\s+)?(.+?)\s*$/i)
  if (reveal && /\b(?:finder|archivo|carpeta)\b/i.test(raw)) return routeTool('revealInFinder', { path: reveal[1].replace(/^en\s+finder\s+/i, '') }, `Mostrar ${reveal[1]} en Finder.`)
  const folder = raw.match(/^\s*(?:crea|crear)\s+(?:una\s+)?carpeta\s+(.+?)\s*$/i)
  if (folder) return routeTool('createFolder', { path: folder[1] }, `Crear carpeta ${folder[1]}.`)

  const working = /\b(?:voy a trabajar|quiero trabajar|quiero concentrarme|prepara mi computadora para trabajar)\b/.test(normalized)
  if (working) {
    const project = resolveProject(raw, config.projects)
    const workspace = project?.workspaceName ?? project?.name ?? raw.match(/\ben\s+([^,.]+)$/i)?.[1]?.trim() ?? 'FARO'
    const quotedTask = raw.match(/[“"']([^“”"']+)[”"']/)?.[1]?.trim()
    return { kind: 'startFocus', workspace, project, taskQuery: quotedTask, durationMinutes: durationMinutes(raw), dateHint: /\bmanana\b/.test(normalized) ? 'tomorrow' : 'today', summary: `Iniciar enfoque en ${workspace}.` }
  }

  const openFinder = raw.match(/^\s*(?:abre|abrir)\s+(?:el\s+)?finder[.!?,;:]*\s*$/i)
  if (openFinder) return routeTool('openApp', { app: 'Finder' }, 'Abrir Finder.')

  const openApp = raw.match(/^\s*(?:abre|abrir)\s+(.+?)\s*$/i)
  if (openApp && !/\b(?:archivo|carpeta|finder|proyecto)\b/i.test(openApp[1])) { const app = cleanSpokenEntity(openApp[1]); return routeTool('openApp', { app }, `Abrir ${app}.`) }
  const closeApp = raw.match(/^\s*(?:cierra|cerrar)\s+(.+?)\s*$/i)
  if (closeApp) { const app = cleanSpokenEntity(closeApp[1]); return routeTool('closeApp', { app }, `Cerrar ${app}.`) }
  const find = raw.match(/^\s*(?:busca|encuentra)\s+(?:el\s+|la\s+)?(?:archivo\s+)?(.+?)\s*$/i)
  if (find && /\b(?:archivo|excel|documento|pdf|carpeta)\b/i.test(raw)) return routeTool('findFile', { query: find[1] }, `Buscar “${find[1]}”.`)

  return { kind: 'unhandled' }
}
