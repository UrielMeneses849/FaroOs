import { describe, expect, it } from 'vitest'
import { calculateProjectProgress } from '../lib/taskMetrics'
import { useFaroStore } from './useFaroStore'

describe('flujo crítico de release', () => {
  it('captura, convierte, vincula, ejecuta y recupera progreso', async () => {
    const state = useFaroStore.getState()
    const goal = state.goals[0]
    const timestamp = new Date().toISOString()
    state.createIdea({ id: 'release-idea', title: 'Proyecto de release', area: 'personal', status: 'inbox', goalId: goal.id, createdAt: timestamp, updatedAt: timestamp })
    useFaroStore.getState().convertIdea('release-idea', 'project')
    const project = useFaroStore.getState().projects.find((item) => item.id === 'release-idea')
    expect(project?.goalId).toBe(goal.id)
    useFaroStore.getState().createTask({ id: 'release-task', title: 'Completar release', area: 'personal', status: 'todo', priority: 'high', projectId: project!.id, goalId: goal.id, dueDate: timestamp.slice(0, 10), createdAt: timestamp, updatedAt: timestamp })
    expect(calculateProjectProgress(useFaroStore.getState().tasks, project!.id)).toBe(0)
    useFaroStore.getState().updateTask('release-task', { status: 'done' })
    expect(calculateProjectProgress(useFaroStore.getState().tasks, project!.id)).toBe(100)
    const saved = localStorage.getItem('faro-os-data')
    expect(saved).toContain('release-task')
    await useFaroStore.persist.rehydrate()
    expect(useFaroStore.getState().tasks.find((item) => item.id === 'release-task')?.status).toBe('done')
  })
})
