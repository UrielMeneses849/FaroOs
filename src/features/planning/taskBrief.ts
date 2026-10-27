import type { Priority, TaskStatus, TaskType } from '../../types'

export interface TaskBrief {
  objective: string
  currentBehavior: string
  reproductionSteps: string
  acceptanceCriteria: string
  references: string
}

export interface DotHandoffContext {
  id: string
  title: string
  workspace?: string
  section?: string
  project?: string
  taskType?: TaskType | ''
  status: TaskStatus
  priority: Priority
  brief: TaskBrief
}

const marker = '<!-- faro-task-brief:v1 -->'
const headings: Array<[keyof TaskBrief, string]> = [
  ['objective', 'Objetivo / resultado esperado'],
  ['currentBehavior', 'Contexto / comportamiento actual'],
  ['reproductionSteps', 'Pasos para reproducir'],
  ['acceptanceCriteria', 'Criterios de aceptación'],
  ['references', 'Referencias / capturas'],
]

const emptyBrief = (): TaskBrief => ({
  objective: '',
  currentBehavior: '',
  reproductionSteps: '',
  acceptanceCriteria: '',
  references: '',
})

export function parseTaskBrief(description?: string): TaskBrief {
  const source = description?.trim() ?? ''
  if (!source) return emptyBrief()
  if (!source.includes(marker)) return { ...emptyBrief(), currentBehavior: source }

  const result = emptyBrief()
  for (const [index, [key, heading]] of headings.entries()) {
    const startToken = `## ${heading}`
    const start = source.indexOf(startToken)
    if (start < 0) continue
    const contentStart = start + startToken.length
    const nextHeading = headings.slice(index + 1)
      .map(([, candidate]) => source.indexOf(`## ${candidate}`, contentStart))
      .find((position) => position >= 0)
    result[key] = source.slice(contentStart, nextHeading ?? source.length).trim()
  }
  return result
}

export function serializeTaskBrief(brief: TaskBrief): string | undefined {
  const sections = headings
    .map(([key, heading]) => [heading, brief[key].trim()] as const)
    .filter(([, value]) => Boolean(value))
  if (!sections.length) return undefined
  return [marker, ...sections.flatMap(([heading, value]) => [`## ${heading}`, value])].join('\n\n')
}

const statusLabels: Record<TaskStatus, string> = {
  inbox: 'Inbox', todo: 'Por hacer', doing: 'En progreso', waiting: 'En espera', paused: 'Pausada', blocked: 'En revisión', done: 'Completada',
}
const priorityLabels: Record<Priority, string> = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' }
const typeLabels: Record<TaskType, string> = { bug: 'Bug', feature: 'Funcionalidad', ui: 'UI / UX', tech: 'Técnica', research: 'Investigación', content: 'Contenido' }

export function buildDotHandoff(context: DotHandoffContext): string {
  const { brief } = context
  const metadata = [
    `- ID: ${context.id}`,
    context.workspace ? `- Workspace: ${context.workspace}` : '',
    context.section ? `- Sección: ${context.section}` : '',
    context.project ? `- Proyecto: ${context.project}` : '',
    context.taskType ? `- Tipo: ${typeLabels[context.taskType]}` : '',
    `- Estado: ${statusLabels[context.status]}`,
    `- Prioridad: ${priorityLabels[context.priority]}`,
  ].filter(Boolean)
  const detail = headings
    .map(([key, heading]) => brief[key].trim() ? `## ${heading}\n${brief[key].trim()}` : '')
    .filter(Boolean)

  return [
    'Encargo preparado desde FARO OS para pegar en dot. No ha sido enviado ni iniciado automáticamente.',
    '',
    `# ${context.title.trim()}`,
    ...metadata,
    '',
    ...detail,
    '',
    'Trabaja sobre el repositorio correcto después de verificarlo. Conserva cambios locales, valida la solución con las pruebas disponibles y reporta archivos modificados, pruebas y límites. No hagas commit, push, despliegue ni publiques sin autorización.',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('No se pudo copiar el encargo')
}
