import { endOfWeek, format, isWithinInterval, startOfMonth, startOfWeek, subDays, subMonths, subWeeks } from 'date-fns'
import type { FaroData, LifeArea } from '../types'
import { calculateGoalProgress } from './taskMetrics'

const inRange = (value: string, start: Date, end: Date) => {
  const date = new Date(value)
  return isWithinInterval(date, { start, end })
}

export function calculateDashboardMetrics(data: FaroData, reference = new Date()) {
  const weekStart = startOfWeek(reference, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(reference, { weekStartsOn: 1 })
  const monthStart = startOfMonth(reference)
  const sevenDaysAgo = subDays(reference, 6)
  const weeklyStudyMinutes = data.studySessions.filter((item) => inRange(item.occurredAt, weekStart, weekEnd)).reduce((sum, item) => sum + item.durationMinutes, 0)
  const monthTransactions = data.transactions.filter((item) => inRange(item.occurredAt, monthStart, reference))
  const income = monthTransactions.filter((item) => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0)
  const expenses = monthTransactions.filter((item) => item.kind === 'expense').reduce((sum, item) => sum + item.amount, 0)
  const recentHealth = data.healthLogs.filter((item) => inRange(item.occurredAt, sevenDaysAgo, reference))
  const moods = recentHealth.flatMap((item) => item.mood == null ? [] : [item.mood])
  const activeGoals = data.goals.filter((goal) => goal.status === 'active' && !goal.archivedAt)
  return {
    completedTasksWeek: data.tasks.filter((task) => task.status === 'done' && inRange(task.updatedAt, weekStart, weekEnd)).length,
    weeklyStudyMinutes,
    monthlyBalance: income - expenses,
    averageMood7Days: moods.length ? moods.reduce((sum, value) => sum + value, 0) / moods.length : 0,
    activeGoalsProgress: activeGoals.length ? Math.round(activeGoals.reduce((sum, goal) => sum + calculateGoalProgress(data.tasks, data.projects, goal.id), 0) / activeGoals.length) : 0,
    trainingDays: new Set(recentHealth.filter((item) => (item.trainingMinutes ?? 0) > 0).map((item) => format(new Date(item.occurredAt), 'yyyy-MM-dd'))).size,
    meditationMinutes: recentHealth.reduce((sum, item) => sum + (item.meditationMinutes ?? 0), 0),
  }
}

export function generateWeeklyInsights(data: FaroData, reference = new Date()): string[] {
  const weekStart = startOfWeek(reference, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(reference, { weekStartsOn: 1 })
  const previousStart = startOfWeek(subWeeks(reference, 1), { weekStartsOn: 1 })
  const previousEnd = endOfWeek(subWeeks(reference, 1), { weekStartsOn: 1 })
  const currentHealth = data.healthLogs.filter((item) => inRange(item.occurredAt, weekStart, weekEnd))
  const trained = currentHealth.filter((item) => (item.trainingMinutes ?? 0) > 0 && item.mood != null)
  const rested = currentHealth.filter((item) => item.sleepHours != null && item.mood != null)
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
  const insights: string[] = []
  if (trained.length) {
    const trainingMood = average(trained.map((item) => item.mood!))
    const restMood = average(currentHealth.filter((item) => !(item.trainingMinutes ?? 0) && item.mood != null).map((item) => item.mood!))
    if (trainingMood >= restMood) insights.push('Tu mejor ánimo coincidió con los días de entrenamiento.')
  }
  if (rested.length >= 2) {
    const bestMood = [...rested].sort((a, b) => (b.mood ?? 0) - (a.mood ?? 0))[0]
    if ((bestMood.sleepHours ?? 0) >= 7) insights.push('Tus días de mejor ánimo también tuvieron al menos siete horas de sueño.')
  }
  const study = (start: Date, end: Date) => data.studySessions.filter((item) => inRange(item.occurredAt, start, end)).reduce((sum, item) => sum + item.durationMinutes, 0)
  const currentStudy = study(weekStart, weekEnd)
  const previousStudy = study(previousStart, previousEnd)
  if (currentStudy > previousStudy && currentStudy >= 60) insights.push(`Esta semana estudiaste ${Math.round(currentStudy / 60 * 10) / 10} horas, más que la semana anterior.`)
  const areaCounts = data.tasks.filter((task) => task.status !== 'done' && !task.archivedAt).reduce<Partial<Record<LifeArea, number>>>((counts, task) => ({ ...counts, [task.area]: (counts[task.area] ?? 0) + 1 }), {})
  const topArea = Object.entries(areaCounts).sort(([, a], [, b]) => b - a)[0]
  if (topArea) insights.push(`${areaLabel(topArea[0] as LifeArea)} concentra la mayor parte de tus tareas abiertas.`)
  const currentMonth = startOfMonth(reference)
  const previousMonth = startOfMonth(subMonths(reference, 1))
  const spending = (start: Date, end: Date) => data.transactions.filter((item) => item.kind === 'expense' && inRange(item.occurredAt, start, end)).reduce((sum, item) => sum + item.amount, 0)
  const currentSpend = spending(currentMonth, reference)
  const previousSpend = spending(previousMonth, subDays(currentMonth, 1))
  if (previousSpend > 0) insights.push(currentSpend > previousSpend ? 'Tu gasto del mes supera al mes anterior.' : 'Tu gasto del mes se mantiene por debajo del mes anterior.')
  return insights.slice(0, 3)
}

export function weeklySeries(data: FaroData, reference = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = subDays(reference, 6 - index)
    const key = format(date, 'yyyy-MM-dd')
    const health = data.healthLogs.find((item) => format(new Date(item.occurredAt), 'yyyy-MM-dd') === key)
    return {
      date: format(date, 'EEE'),
      study: data.studySessions.filter((item) => format(new Date(item.occurredAt), 'yyyy-MM-dd') === key).reduce((sum, item) => sum + item.durationMinutes, 0),
      mood: health?.mood,
      sleep: health?.sleepHours,
      weight: health?.weightKg,
    }
  })
}

function areaLabel(area: LifeArea) {
  return ({ personal: 'Personal', health: 'Salud', finance: 'Finanzas', learning: 'Aprendizaje', nexvora: 'Nexvora', portfolio: 'Portafolio', travel: 'Viajes', relationships: 'Relaciones' })[area]
}
