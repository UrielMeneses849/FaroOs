import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { demoData } from '../data/mockData'
import { emptyData, faroDataSchema } from '../lib/backup'
import type { FaroData, LifeArea } from '../types'
import type { ItemRef } from './storeTypes'
import type { FaroStore } from './storeTypes'

const stamp = () => new Date().toISOString()
const safeLocalStorage = {
  getItem: (name: string) => {
    const value = localStorage.getItem(name)
    if (!value) return null
    try {
      JSON.parse(value)
      return value
    } catch {
      localStorage.removeItem(name)
      return null
    }
  },
  setItem: (name: string, value: string) => localStorage.setItem(name, value),
  removeItem: (name: string) => localStorage.removeItem(name),
}
const hasRef = (items: ItemRef[], kind: ItemRef['kind'], id: string) =>
  items.some((item) => item.kind === kind && item.id === id)
const updateArea = <T extends { id: string; area: LifeArea; updatedAt: string }>(
  collection: T[],
  items: ItemRef[],
  kind: ItemRef['kind'],
  area: LifeArea,
) => collection.map((item) => hasRef(items, kind, item.id) ? { ...item, area, updatedAt: stamp() } : item)
const archive = <T extends { id: string; updatedAt: string; archivedAt?: string }>(
  collection: T[],
  items: ItemRef[],
  kind: ItemRef['kind'],
) => collection.map((item) => hasRef(items, kind, item.id) ? { ...item, archivedAt: stamp(), updatedAt: stamp() } : item)

export const useFaroStore = create<FaroStore>()(
  persist(
    (set) => ({
      ...structuredClone(demoData),
      createIdea: (idea) => set((state) => ({ ideas: [...state.ideas, idea] })),
      updateIdea: (id, changes) =>
        set((state) => ({
          ideas: state.ideas.map((idea) =>
            idea.id === id ? { ...idea, ...changes, updatedAt: stamp() } : idea,
          ),
        })),
      deleteIdea: (id) => set((state) => ({ ideas: state.ideas.filter((idea) => idea.id !== id) })),
      createGoal: (goal) => set((state) => ({ goals: [...state.goals, goal] })),
      updateGoal: (id, changes) =>
        set((state) => ({
          goals: state.goals.map((goal) =>
            goal.id === id ? { ...goal, ...changes, updatedAt: stamp() } : goal,
          ),
        })),
      deleteGoal: (id) =>
        set((state) => ({
          goals: state.goals.filter((goal) => goal.id !== id),
          projects: state.projects.map((project) =>
            project.goalId === id ? { ...project, goalId: undefined, updatedAt: stamp() } : project,
          ),
          tasks: state.tasks.map((task) =>
            task.goalId === id ? { ...task, goalId: undefined, updatedAt: stamp() } : task,
          ),
        })),
      createProject: (project) => set((state) => ({
        projects: [...state.projects, project],
        goals: project.goalId
          ? state.goals.map((goal) => goal.id === project.goalId && !goal.projectIds.includes(project.id)
            ? { ...goal, projectIds: [...goal.projectIds, project.id], updatedAt: stamp() }
            : goal)
          : state.goals,
      })),
      updateProject: (id, changes) =>
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, ...changes, updatedAt: stamp() } : project,
          ),
          goals: !Object.prototype.hasOwnProperty.call(changes, 'goalId') ? state.goals : state.goals.map((goal) => {
            const shouldContain = goal.id === changes.goalId
            const projectIds = shouldContain
              ? [...new Set([...goal.projectIds, id])]
              : goal.projectIds.filter((projectId) => projectId !== id)
            return projectIds.length !== goal.projectIds.length || projectIds.some((projectId, index) => projectId !== goal.projectIds[index])
              ? { ...goal, projectIds, updatedAt: stamp() }
              : goal
          }),
        })),
      deleteProject: (id) =>
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== id),
          goals: state.goals.map((goal) => goal.projectIds.includes(id)
            ? { ...goal, projectIds: goal.projectIds.filter((projectId) => projectId !== id), updatedAt: stamp() }
            : goal),
          tasks: state.tasks.map((task) =>
            task.projectId === id ? { ...task, projectId: undefined, updatedAt: stamp() } : task,
          ),
        })),
      createTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
      updateTask: (id, changes) =>
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? { ...task, ...changes, updatedAt: stamp() } : task,
          ),
        })),
      deleteTask: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
      createHealthLog: (log) => set((state) => ({ healthLogs: [...state.healthLogs, log] })),
      updateHealthLog: (id, changes) => set((state) => ({
        healthLogs: state.healthLogs.map((log) =>
          log.id === id ? { ...log, ...changes, updatedAt: stamp() } : log),
      })),
      deleteHealthLog: (id) => set((state) => ({ healthLogs: state.healthLogs.filter((log) => log.id !== id) })),
      createStudySession: (session) => set((state) => ({ studySessions: [...state.studySessions, session] })),
      createTransaction: (transaction) => set((state) => ({ transactions: [...state.transactions, transaction] })),
      createTreatmentLog: (log) => set((state) => ({ treatmentLogs: [...state.treatmentLogs, log] })),
      createJournalEntry: (entry) => set((state) => ({ journalEntries: [...state.journalEntries, entry] })),
      replaceData: (data) => set(faroDataSchema.parse(data)),
      clearAllData: () => set(emptyData()),
      convertIdea: (id, target) =>
        set((state) => {
          const idea = state.ideas.find((item) => item.id === id)
          if (!idea) return state
          const updatedAt = stamp()
          const ideas = state.ideas.filter((item) => item.id !== id)
          if (target === 'task') {
            return {
              ideas,
              tasks: [...state.tasks, {
                id: idea.id, title: idea.title, notes: idea.description, area: idea.area,
                status: 'todo', priority: 'medium', dueDate: idea.date, projectId: idea.projectId,
                goalId: idea.goalId, createdAt: idea.createdAt, updatedAt,
              }],
            }
          }
          if (target === 'project') {
            return {
              ideas,
              projects: [...state.projects, {
                id: idea.id, title: idea.title, description: idea.description, area: idea.area,
                status: 'idea', goalId: idea.goalId, priority: 'medium',
                createdAt: idea.createdAt, updatedAt,
              }],
            }
          }
          const projectIds = idea.projectId && state.projects.some((project) => project.id === idea.projectId)
            ? [idea.projectId]
            : []
          return {
            ideas,
            goals: [...state.goals, {
              id: idea.id, title: idea.title, description: idea.description, area: idea.area,
              status: 'active', targetDate: idea.date, projectIds,
              createdAt: idea.createdAt, updatedAt,
            }],
            projects: state.projects.map((project) =>
              projectIds.includes(project.id) ? { ...project, goalId: idea.id, updatedAt } : project,
            ),
          }
        }),
      archiveItems: (items) =>
        set((state) => ({
          ideas: archive(state.ideas, items, 'idea').map((idea) =>
            hasRef(items, 'idea', idea.id) ? { ...idea, status: 'archived' as const } : idea,
          ),
          tasks: archive(state.tasks, items, 'task'),
          projects: archive(state.projects, items, 'project'),
          goals: archive(state.goals, items, 'goal'),
        })),
      changeItemsArea: (items, area) =>
        set((state) => ({
          ideas: updateArea(state.ideas, items, 'idea', area),
          tasks: updateArea(state.tasks, items, 'task', area),
          projects: updateArea(state.projects, items, 'project', area),
          goals: updateArea(state.goals, items, 'goal', area),
        })),
      restoreDemoData: () => set(structuredClone(demoData)),
    }),
    {
      name: 'faro-os-data',
      version: 6,
      storage: createJSONStorage(() => safeLocalStorage),
      migrate: (persistedState, version) => {
        const data = persistedState as FaroData
        if (version < 4) {
          const migrated = {
            ...emptyData(),
            ...data,
            ideas: data.ideas ?? [],
            projects: (data.projects ?? []).map((project) => ({
              ...project,
              priority: project.priority ?? 'medium',
            })),
            studySessions: (data.studySessions ?? []).map((session) => ({
              ...session,
              skill: session.skill ?? session.topic,
            })),
            journalEntries: (data.journalEntries ?? []).map((entry) => ({
              ...entry,
              mood: typeof entry.mood === 'number' ? entry.mood : undefined,
              tags: entry.tags ?? [],
            })),
            tasks: (data.tasks ?? []).map((task) => {
              const legacyStatus = task.status as string
              return {
                ...task,
                status: task.status === 'inbox' || task.status === 'paused' ? 'todo' : version >= 2 ? task.status
                  : legacyStatus === 'done' ? 'done'
                    : legacyStatus === 'in_progress' ? 'doing'
                      : legacyStatus === 'next' ? 'todo' : 'inbox',
              }
            }),
          }
          return {
            ...migrated,
            healthLogs: (migrated.healthLogs ?? []).filter((log) => !/^health-[1-4]$/.test(log.id)),
          } as FaroStore
        }
        const current = persistedState as FaroStore
        return {
          ...current,
          tasks: (current.tasks ?? []).map((task) => ({ ...task, status: task.status === 'inbox' || task.status === 'paused' ? 'todo' : task.status })),
          healthLogs: (current.healthLogs ?? []).filter((log) => !/^health-[1-4]$/.test(log.id)),
        }
      },
      merge: (persistedState, currentState) => {
        const parsed = faroDataSchema.safeParse(persistedState)
        return parsed.success ? { ...currentState, ...parsed.data } : currentState
      },
      partialize: ({ ideas, goals, projects, tasks, studySessions, transactions, healthLogs, treatmentLogs, journalEntries }) => ({
        ideas,
        goals,
        projects,
        tasks,
        studySessions,
        transactions,
        healthLogs,
        treatmentLogs,
        journalEntries,
      }),
    },
  ),
)
