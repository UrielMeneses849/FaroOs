import type { BacklogKind, FaroData, Goal, HealthLog, Idea, JournalEntry, LifeArea, Project, StudySession, Task, Transaction, TreatmentLog } from '../types'

export interface ItemRef {
  id: string
  kind: BacklogKind
}

export interface FaroActions {
  createIdea: (idea: Idea) => void
  updateIdea: (id: string, changes: Partial<Idea>) => void
  deleteIdea: (id: string) => void
  createGoal: (goal: Goal) => void
  updateGoal: (id: string, changes: Partial<Goal>) => void
  deleteGoal: (id: string) => void
  createProject: (project: Project) => void
  updateProject: (id: string, changes: Partial<Project>) => void
  deleteProject: (id: string) => void
  createTask: (task: Task) => void
  updateTask: (id: string, changes: Partial<Task>) => void
  deleteTask: (id: string) => void
  createHealthLog: (log: HealthLog) => void
  createStudySession: (session: StudySession) => void
  createTransaction: (transaction: Transaction) => void
  createTreatmentLog: (log: TreatmentLog) => void
  createJournalEntry: (entry: JournalEntry) => void
  replaceData: (data: FaroData) => void
  clearAllData: () => void
  convertIdea: (id: string, target: Exclude<BacklogKind, 'idea'>) => void
  archiveItems: (items: ItemRef[]) => void
  changeItemsArea: (items: ItemRef[], area: LifeArea) => void
  restoreDemoData: () => void
}

export type FaroStore = FaroData & FaroActions
