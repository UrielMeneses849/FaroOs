import type { BacklogKind, LifeArea, Priority } from '../../types'

export type BacklogView = 'inbox' | 'ideas' | 'tasks' | 'projects' | 'goals' | 'completed'
export type SortKey = 'created' | 'priority' | 'due'

export interface BacklogItem {
  id: string
  kind: BacklogKind
  title: string
  description?: string
  area: LifeArea
  status: string
  priority?: Priority
  date?: string
  projectId?: string
  goalId?: string
  workspaceId?: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface BacklogFilterState {
  query: string
  area: LifeArea | 'all'
  priority: Priority | 'all'
  status: string
  sort: SortKey
}
