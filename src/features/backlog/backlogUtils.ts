import type { FaroData } from '../../types'
import type { BacklogFilterState, BacklogItem, BacklogView } from './backlogTypes'

export function buildBacklogItems(state: Pick<FaroData, 'ideas' | 'tasks' | 'projects' | 'goals'>): BacklogItem[] {
  return [
    ...state.ideas.map((item) => ({ ...item, kind: 'idea' as const, date: item.date })),
    ...state.tasks.map((item) => ({ ...item, kind: 'task' as const, description: item.notes, date: item.dueDate })),
    ...state.projects.map((item) => ({ ...item, kind: 'project' as const })),
    ...state.goals.map((item) => ({ ...item, kind: 'goal' as const, date: item.targetDate })),
  ]
}

const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 }

export function filterBacklog(items: BacklogItem[], view: BacklogView, filters: BacklogFilterState) {
  const query = filters.query.trim().toLocaleLowerCase('es')
  return items
    .filter((item) => {
      const completed = Boolean(item.archivedAt) || item.status === 'done' || item.status === 'completed' || item.status === 'archived'
      if (view === 'completed') return completed
      if (completed) return false
      if (view === 'inbox' && !['inbox', 'idea'].includes(item.status)) return false
      if (view === 'ideas' && item.kind !== 'idea') return false
      if (view === 'tasks' && item.kind !== 'task') return false
      if (view === 'projects' && item.kind !== 'project') return false
      if (view === 'goals' && item.kind !== 'goal') return false
      if (query && !`${item.title} ${item.description ?? ''}`.toLocaleLowerCase('es').includes(query)) return false
      if (filters.area !== 'all' && item.area !== filters.area) return false
      if (filters.priority !== 'all' && item.priority !== filters.priority) return false
      if (filters.status !== 'all' && item.status !== filters.status) return false
      return true
    })
    .sort((a, b) => {
      if (filters.sort === 'priority') return (priorityWeight[b.priority ?? 'low'] - priorityWeight[a.priority ?? 'low']) || b.createdAt.localeCompare(a.createdAt)
      if (filters.sort === 'due') return (a.date || '9999').localeCompare(b.date || '9999')
      return b.createdAt.localeCompare(a.createdAt)
    })
}
