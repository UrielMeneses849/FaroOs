import { describe, expect, it } from 'vitest'
import { demoData } from '../data/mockData'
import { localDataNeedsMigration, remapLocalData } from './localDataMigrationService'

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('migración de localStorage', () => {
  it('detecta datos demo que aún usan identificadores locales', () => {
    expect(localDataNeedsMigration(demoData)).toBe(true)
  })

  it('genera UUIDs deterministas y conserva relaciones completas', async () => {
    const first = await remapLocalData(structuredClone(demoData), 'user-1')
    const second = await remapLocalData(structuredClone(demoData), 'user-1')

    expect(first).toEqual(second)
    expect(first.goals.every((goal) => uuidPattern.test(goal.id))).toBe(true)
    expect(first.projects.every((project) => uuidPattern.test(project.id))).toBe(true)
    expect(first.tasks.every((task) => uuidPattern.test(task.id))).toBe(true)

    const originalProject = demoData.projects.find((project) => project.goalId)
    const migratedProject = first.projects.find(
      (project) => project.title === originalProject?.title,
    )
    const migratedGoal = first.goals.find(
      (goal) =>
        goal.title
        === demoData.goals.find((item) => item.id === originalProject?.goalId)?.title,
    )
    expect(migratedProject?.goalId).toBe(migratedGoal?.id)
    expect(migratedGoal?.projectIds).toContain(migratedProject?.id)

    const originalTask = demoData.tasks.find((task) => task.projectId)
    const migratedTask = first.tasks.find((task) => task.title === originalTask?.title)
    const relatedProject = first.projects.find(
      (project) =>
        project.title
        === demoData.projects.find((item) => item.id === originalTask?.projectId)?.title,
    )
    expect(migratedTask?.projectId).toBe(relatedProject?.id)
  })

  it('considera completa una colección ya remapeada', async () => {
    const migrated = await remapLocalData(structuredClone(demoData), 'user-1')
    expect(localDataNeedsMigration(migrated)).toBe(false)
  })
})
