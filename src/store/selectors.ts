import type { FaroStore } from './storeTypes'
import { calculateGoalProgress } from '../lib/taskMetrics'

export const selectActiveGoals = (state: FaroStore) =>
  state.goals.filter((goal) => goal.status === 'active')

export const selectOpenTasks = (state: FaroStore) =>
  state.tasks.filter((task) => task.status !== 'done')

export const selectTodayTasks = (date: string) => (state: FaroStore) =>
  state.tasks.filter((task) => task.dueDate === date && task.status !== 'done')

export const selectOverallProgress = (state: FaroStore) =>
  state.goals.length
    ? Math.round(state.goals.reduce((sum, goal) => sum + calculateGoalProgress(state.tasks, state.projects, goal.id), 0) / state.goals.length)
    : 0
