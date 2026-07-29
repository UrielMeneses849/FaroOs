import type { Project, Task } from '../types'

export function calculateProjectProgress(tasks: Task[], projectId: string): number {
  const projectTasks = tasks.filter((task) => task.projectId === projectId && !task.archivedAt)
  if (projectTasks.length === 0) return 0
  return Math.round((projectTasks.filter((task) => task.status === 'done').length / projectTasks.length) * 100)
}

export function calculateGoalProgress(projects: Project[], goalId: string): number
export function calculateGoalProgress(_tasks: Task[], projects: Project[], goalId: string): number
export function calculateGoalProgress(
  first: Task[] | Project[],
  second: Project[] | string,
  third?: string,
): number {
  const projects = typeof second === 'string' ? first as Project[] : second
  const goalId = typeof second === 'string' ? second : third
  const related = projects.filter((project) =>
    project.goalId === goalId && !project.archivedAt,
  )
  if (!related.length) return 0
  return Math.max(0, Math.min(100,
    Math.round(related.filter((project) => project.status === 'completed').length / related.length * 100),
  ))
}

export function prioritizeTasks(tasks: Task[], today: string): Task[] {
  const priorityWeight = { critical: 4, high: 3, medium: 2, low: 1 }
  const score = (task: Task) => {
    const overdue = Boolean(task.dueDate && task.dueDate < today)
    const dueToday = task.dueDate === today
    const critical = task.priority === 'critical'
    return [critical ? 1 : 0, overdue ? 1 : 0, dueToday ? 1 : 0, priorityWeight[task.priority], -new Date(task.createdAt).getTime()]
  }
  return [...tasks].sort((a, b) => {
    const left = score(a)
    const right = score(b)
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index]
    }
    return a.id.localeCompare(b.id)
  })
}

export function calculateTotalMinutes(tasks: Task[]): number {
  return tasks.reduce((total, task) => total + (task.estimatedMinutes ?? 0), 0)
}
