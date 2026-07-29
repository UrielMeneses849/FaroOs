import { describe, expect, it } from 'vitest'
import { demoData } from '../data/mockData'
import { calculateGoalProgress, calculateProjectProgress, calculateTotalMinutes, prioritizeTasks } from './taskMetrics'

describe('métricas conectadas', () => {
  it('calcula progreso de proyecto y evita división por cero', () => {
    expect(calculateProjectProgress([], 'empty')).toBe(0)
    const tasks = demoData.tasks.filter((task) => task.projectId === 'project-faro')
    expect(calculateProjectProgress(tasks, 'project-faro')).toBe(0)
    expect(calculateProjectProgress(tasks.map((task) => ({ ...task, status: 'done' })), 'project-faro')).toBe(100)
  })

  it('calcula el progreso del objetivo desde proyectos completados', () => {
    expect(calculateGoalProgress(demoData.projects, 'goal-faro')).toBe(0)
    const projects = demoData.projects.map((project) =>
      project.goalId === 'goal-faro' ? { ...project, status: 'completed' as const } : project)
    expect(calculateGoalProgress(projects, 'goal-faro')).toBe(100)
    expect(calculateGoalProgress([], 'goal-empty')).toBe(0)
  })

  it('calcula el tiempo estimado total', () => {
    expect(calculateTotalMinutes([{ ...demoData.tasks[0], estimatedMinutes: 40 }, { ...demoData.tasks[1], estimatedMinutes: 20 }])).toBe(60)
  })

  it('prioriza críticas, vencidas, hoy, prioridad y antigüedad', () => {
    const ordered = prioritizeTasks([
      { ...demoData.tasks[0], id: 'later', priority: 'low', dueDate: '2026-07-23' },
      { ...demoData.tasks[1], id: 'critical', priority: 'high', dueDate: '2026-07-22' },
      { ...demoData.tasks[2], id: 'future', priority: 'high', dueDate: '2026-07-24' },
    ], '2026-07-23')
    expect(ordered.map((task) => task.id)).toEqual(['critical', 'later', 'future'])
  })
})
