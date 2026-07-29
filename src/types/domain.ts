export type LifeArea =
  | 'personal'
  | 'health'
  | 'finance'
  | 'learning'
  | 'nexvora'
  | 'portfolio'
  | 'travel'
  | 'relationships'

export type GoalStatus = 'active' | 'paused' | 'completed'
export type ProjectStatus = 'idea' | 'planned' | 'active' | 'paused' | 'completed'
export type EntityStatus = GoalStatus | ProjectStatus
export type TaskStatus = 'inbox' | 'todo' | 'doing' | 'paused' | 'blocked' | 'done'
export type IdeaStatus = 'inbox' | 'archived' | 'converted'
export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type BacklogKind = 'idea' | 'task' | 'project' | 'goal'

export interface BaseEntity {
  id: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface Idea extends BaseEntity {
  title: string
  description?: string
  area: LifeArea
  status: IdeaStatus
  date?: string
  projectId?: string
  goalId?: string
}

export interface Goal extends BaseEntity {
  title: string
  description?: string
  area: LifeArea
  status: GoalStatus
  targetDate?: string
  projectIds: string[]
  workspaceId?: string
}

export interface Project extends BaseEntity {
  title: string
  description?: string
  area: LifeArea
  status: ProjectStatus
  goalId?: string
  priority: Priority
  startDate?: string
  endDate?: string
  workspaceId?: string
}

export interface Task extends BaseEntity {
  title: string
  description?: string
  notes?: string
  area: LifeArea
  status: TaskStatus
  priority: Priority
  projectId?: string
  goalId?: string
  dueDate?: string
  dueAt?: string
  estimatedMinutes?: number
  sortOrder?: number
  workspaceId?: string
  stakeholder?: string
  waitingFor?: string
  blockerReason?: string
  pausedUntil?: string
}

export type WorkspaceType = 'personal' | 'employment' | 'business' | 'client'

export interface Workspace {
  id: string
  name: string
  type: WorkspaceType
  color?: string
  icon?: string
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface StudySession extends BaseEntity {
  topic: string
  skill: string
  area: 'learning'
  durationMinutes: number
  occurredAt: string
  notes?: string
}

export interface Transaction extends BaseEntity {
  description: string
  area: 'finance'
  amount: number
  kind: 'income' | 'expense' | 'saving'
  occurredAt: string
  category: string
}

export interface HealthLog extends BaseEntity {
  area: 'health'
  occurredAt: string
  energy: number
  mood?: number
  anxiety?: number
  sleepHours?: number
  movementMinutes?: number
  trainingMinutes?: number
  meditationMinutes?: number
  weightKg?: number
  waterLiters?: number
  notes?: string
}

export interface TreatmentLog extends BaseEntity {
  area: 'health'
  occurredAt: string
  treatment: 'isotretinoin'
  medicationTaken: boolean
  dosage?: string
  dryness?: number
  skinCondition?: string
  sideEffects?: string
  notes?: string
}

export interface JournalEntry extends BaseEntity {
  area: LifeArea
  title: string
  content: string
  occurredAt: string
  mood?: number
  gratitude?: string
  lesson?: string
  tags: string[]
}

export interface FaroData {
  ideas: Idea[]
  goals: Goal[]
  projects: Project[]
  tasks: Task[]
  studySessions: StudySession[]
  transactions: Transaction[]
  healthLogs: HealthLog[]
  treatmentLogs: TreatmentLog[]
  journalEntries: JournalEntry[]
}
