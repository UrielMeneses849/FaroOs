export type SprintStatus = 'planning' | 'active' | 'completed' | 'cancelled'
export type SprintOutcomeStatus = 'pending' | 'in_progress' | 'completed' | 'dropped'
export type SprintCommitment = 'committed' | 'emergent' | 'optional'

export interface Sprint {
  id: string; userId: string; name: string; startDate: string; endDate: string
  status: SprintStatus; mainOutcome: string; capacityMinutes?: number; notes?: string
  createdAt: string; updatedAt: string
}
export interface SprintOutcome {
  id: string; userId: string; sprintId: string; title: string; type: 'main' | 'secondary'
  status: SprintOutcomeStatus; sortOrder: number; createdAt: string; updatedAt: string
}
export interface SprintTask {
  id: string; userId: string; sprintId: string; taskId: string; commitmentType: SprintCommitment
  addedAt: string; completedInSprint: boolean; removedAt?: string; createdAt: string
}
export interface SprintReview {
  id: string; userId: string; sprintId: string; summary?: string; wins?: string
  blockers?: string; lessons?: string; carryOverNotes?: string; createdAt: string; updatedAt: string
}
export interface SprintData { sprints: Sprint[]; outcomes: SprintOutcome[]; sprintTasks: SprintTask[]; reviews: SprintReview[] }
