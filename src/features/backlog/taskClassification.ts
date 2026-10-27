import type { TaskType } from '../../types'

export const taskTypeOptions: Array<{ value: TaskType; label: string; shortLabel: string }> = [
  { value: 'bug', label: 'Bug / Fix', shortLabel: 'Fix' },
  { value: 'feature', label: 'Funcionalidad', shortLabel: 'Feature' },
  { value: 'ui', label: 'UI / UX', shortLabel: 'UI/UX' },
  { value: 'tech', label: 'Mejora técnica', shortLabel: 'Técnica' },
  { value: 'research', label: 'Investigación', shortLabel: 'Research' },
  { value: 'content', label: 'Contenido / Datos', shortLabel: 'Contenido' },
]

export const taskTypeLabel = (value?: TaskType) =>
  taskTypeOptions.find((option) => option.value === value)?.shortLabel ?? 'Sin clasificar'
