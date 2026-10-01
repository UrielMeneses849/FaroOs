/**
 * Desktop-only computer domain.  These types intentionally describe intent,
 * not shell commands: every intent is resolved by the native tool registry.
 * A future Android adapter can implement the same contract without inheriting
 * macOS details.
 */
export type ComputerSafetyLevel = 0 | 1 | 2 | 3

export type ComputerToolName =
  | 'openApp' | 'closeApp' | 'focusApp' | 'isAppRunning' | 'listRunningApps'
  | 'setVolume' | 'volumeUp' | 'volumeDown' | 'mute' | 'unmute'
  | 'brightnessUp' | 'brightnessDown' | 'setBrightness' | 'setNightShift'
  | 'lockComputer' | 'setDoNotDisturb' | 'getDoNotDisturbStatus'
  | 'findFile' | 'openFile' | 'openUrl' | 'revealInFinder' | 'createFolder'
  | 'focusWindow' | 'arrangeWorkLayout'

export interface ComputerToolDefinition {
  name: ComputerToolName
  safetyLevel: ComputerSafetyLevel
  confirmationRequired: boolean
  description: string
}

export const computerToolRegistry: readonly ComputerToolDefinition[] = [
  { name: 'listRunningApps', safetyLevel: 0, confirmationRequired: false, description: 'Lista aplicaciones abiertas.' },
  { name: 'isAppRunning', safetyLevel: 0, confirmationRequired: false, description: 'Comprueba si una aplicación está abierta.' },
  { name: 'findFile', safetyLevel: 0, confirmationRequired: false, description: 'Busca nombres de archivos sin leer su contenido.' },
  { name: 'openApp', safetyLevel: 1, confirmationRequired: false, description: 'Abre una aplicación.' },
  { name: 'focusApp', safetyLevel: 1, confirmationRequired: false, description: 'Trae una aplicación al frente.' },
  { name: 'setVolume', safetyLevel: 1, confirmationRequired: false, description: 'Ajusta el volumen de salida.' },
  { name: 'volumeUp', safetyLevel: 1, confirmationRequired: false, description: 'Sube el volumen.' },
  { name: 'volumeDown', safetyLevel: 1, confirmationRequired: false, description: 'Baja el volumen.' },
  { name: 'mute', safetyLevel: 1, confirmationRequired: false, description: 'Silencia el volumen.' },
  { name: 'unmute', safetyLevel: 1, confirmationRequired: false, description: 'Restaura el volumen.' },
  { name: 'brightnessUp', safetyLevel: 1, confirmationRequired: false, description: 'Sube un paso el brillo de la pantalla activa.' },
  { name: 'brightnessDown', safetyLevel: 1, confirmationRequired: false, description: 'Baja un paso el brillo de la pantalla activa.' },
  { name: 'setBrightness', safetyLevel: 1, confirmationRequired: false, description: 'Lleva el brillo de la pantalla activa al máximo o mínimo.' },
  { name: 'setNightShift', safetyLevel: 1, confirmationRequired: false, description: 'Activa o desactiva Night Shift mediante un Shortcut local aprobado.' },
  { name: 'setDoNotDisturb', safetyLevel: 1, confirmationRequired: false, description: 'Activa o desactiva concentración mediante un Shortcut aprobado.' },
  { name: 'openFile', safetyLevel: 1, confirmationRequired: false, description: 'Abre un archivo o carpeta permitido.' },
  { name: 'openUrl', safetyLevel: 1, confirmationRequired: false, description: 'Abre una URL https configurada localmente.' },
  { name: 'revealInFinder', safetyLevel: 1, confirmationRequired: false, description: 'Muestra un archivo en Finder.' },
  { name: 'createFolder', safetyLevel: 1, confirmationRequired: false, description: 'Crea una carpeta dentro de tu directorio de usuario.' },
  { name: 'arrangeWorkLayout', safetyLevel: 1, confirmationRequired: false, description: 'Aplica una distribución aprobada de ventanas.' },
  { name: 'closeApp', safetyLevel: 2, confirmationRequired: true, description: 'Cierra una aplicación; puede contener trabajo sin guardar.' },
  { name: 'lockComputer', safetyLevel: 2, confirmationRequired: true, description: 'Bloquea este Mac.' },
  { name: 'focusWindow', safetyLevel: 1, confirmationRequired: false, description: 'Enfoca una ventana de aplicación.' },
  { name: 'getDoNotDisturbStatus', safetyLevel: 0, confirmationRequired: false, description: 'Consulta el último estado de concentración gestionado por FARO.' },
] as const

export function computerToolDefinition(name: ComputerToolName) {
  return computerToolRegistry.find((tool) => tool.name === name)
}

export interface ProjectRegistryEntry {
  id: string
  name: string
  /** A user-approved absolute local path. It never goes to Supabase. */
  path: string
  editorApp?: string
  openFinder?: boolean
  urls: string[]
  workspaceName?: string
  apps: string[]
}

export type FocusStatus = 'planned' | 'active' | 'break' | 'paused' | 'completed' | 'cancelled'
export type FocusPhase = 'focus' | 'break'

export interface FocusSession {
  id: string
  /** Quick sessions started with “FARO, activa modo concentración”. */
  kind?: 'focus' | 'concentration'
  phase?: FocusPhase
  workspace: string
  projectId?: string
  projectName?: string
  taskId?: string
  taskTitle?: string
  /** Start of the current active segment; startTime remains the session origin. */
  activeSince?: string
  startTime: string
  plannedDurationMinutes: number
  /** Used by concentration sessions after the focus interval ends. */
  breakDurationMinutes?: number
  /** Seconds already consumed in the current rest interval. */
  breakElapsedSeconds?: number
  /** Seconds accumulated before the currently open active segment. */
  accumulatedActiveSeconds: number
  pausedAt?: string
  completedAt?: string
  actualDurationSeconds?: number
  status: FocusStatus
  calendarEntryId?: string
  doNotDisturbBefore?: 'enabled' | 'disabled' | 'unknown'
}

export type AutomationAction =
  | { type: 'activateFocus' }
  | { type: 'openProject'; projectId: string }
  | { type: 'openApp'; app: string }
  | { type: 'openUrl'; url: string }
  | { type: 'setDoNotDisturb'; enabled: boolean }

export interface FaroAutomation {
  id: string
  name: string
  trigger: { type: 'voice_phrase'; phrase: string }
  conditions: Record<string, never>
  actions: AutomationAction[]
  enabled: boolean
}

export interface WindowLayout {
  id: string
  name: string
  windows: Array<{ app: string; x: number; y: number; width: number; height: number }>
}

export interface ComputerConfig {
  version: 1
  enabled: boolean
  projects: ProjectRegistryEntry[]
  automations: FaroAutomation[]
  focusPreferences: {
    defaultDurationMinutes: number
    defaultBreakDurationMinutes: number
    enableDoNotDisturb: boolean
    focusOnShortcut?: string
    focusOffShortcut?: string
  }
  displayPreferences: {
    nightShiftOnShortcut?: string
    nightShiftOffShortcut?: string
  }
  layouts: WindowLayout[]
  focusSession?: FocusSession
  /** Last state explicitly set by FARO; it never claims to read macOS Focus. */
  doNotDisturb: { state: 'enabled' | 'disabled' | 'unknown'; managedAt?: string }
}

export const defaultComputerConfig = (): ComputerConfig => ({
  version: 1,
  enabled: true,
  projects: [],
  automations: [],
  focusPreferences: { defaultDurationMinutes: 45, defaultBreakDurationMinutes: 15, enableDoNotDisturb: false },
  displayPreferences: {},
  layouts: [],
  doNotDisturb: { state: 'unknown' },
})

export interface ComputerNativeRequest {
  tool: ComputerToolName
  arguments: Record<string, unknown>
  route: 'deterministic' | 'cheap_model' | 'smart_model'
  llmUsed: boolean
}

export interface ComputerNativeResult {
  success: boolean
  message: string
  tool: ComputerToolName
  safetyLevel: ComputerSafetyLevel
  data?: Record<string, unknown>
  permissionHint?: string
}

export type ComputerPendingTool = 'computerAction' | 'startFocusSession' | 'finishFocusTask' | 'saveAutomation'

export function isComputerPendingTool(value: string): value is ComputerPendingTool {
  return ['computerAction', 'startFocusSession', 'finishFocusTask', 'saveAutomation'].includes(value)
}

export type ComputerVoiceRoute =
  | { kind: 'tool'; tool: ComputerToolName; arguments: Record<string, unknown>; summary: string; confirmationRequired: boolean }
  | { kind: 'openProject'; project: ProjectRegistryEntry; summary: string }
  | { kind: 'startFocus'; workspace: string; project?: ProjectRegistryEntry; taskQuery?: string; durationMinutes?: number; dateHint?: 'today' | 'tomorrow'; summary: string }
  | { kind: 'pauseFocus' | 'resumeFocus' | 'finishFocus'; summary: string }
  | { kind: 'changeFocusDuration'; durationMinutes: number; summary: string }
  | { kind: 'runAutomation'; automation: FaroAutomation; summary: string }
  | { kind: 'teachAutomation'; automation: FaroAutomation; summary: string }
  | { kind: 'needsConfiguration'; message: string }
  | { kind: 'unhandled' }
