import { addDays, differenceInCalendarDays, format, parseISO, subDays } from 'date-fns'
import type { HealthLog } from '../types'

export type WeightProgressStatus = 'insufficient' | 'ahead' | 'on_track' | 'attention' | 'off_track' | 'achieved'

export interface WeightProgress {
  currentKg?: number
  targetKg: number
  remainingKg?: number
  daysRemaining: number
  requiredMonthlyKg?: number
  requiredWeeklyKg?: number
  recentWeeklyKg?: number
  estimatedCompletionDate?: string
  measurements: number
  status: WeightProgressStatus
}

const round = (value: number) => Math.round(value * 10) / 10

export function weightGoalProgress(logs: HealthLog[], targetKg: number, targetDate: Date, referenceDate = new Date()): WeightProgress {
  const latestByDay = new Map<string, HealthLog & { weightKg: number }>()
  logs.filter((log): log is HealthLog & { weightKg: number } => Number.isFinite(log.weightKg)).forEach((log) => {
    const day = log.occurredAt.slice(0, 10)
    const existing = latestByDay.get(day)
    if (!existing || log.updatedAt.localeCompare(existing.updatedAt) >= 0) latestByDay.set(day, log)
  })
  const all = [...latestByDay.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  const current = all.at(-1)
  const currentDate = current ? parseISO(current.occurredAt.slice(0, 10)) : referenceDate
  const recentStart = subDays(referenceDate, 29)
  const recent = all.filter((log) => parseISO(log.occurredAt.slice(0, 10)) >= recentStart)
  const daysRemaining = Math.max(0, differenceInCalendarDays(targetDate, referenceDate))
  const remainingSigned = current ? targetKg - current.weightKg : undefined
  const remainingKg = remainingSigned == null ? undefined : Math.abs(remainingSigned)
  const base: WeightProgress = { currentKg: current?.weightKg, targetKg, remainingKg: remainingKg == null ? undefined : round(remainingKg), daysRemaining, measurements: recent.length, status: 'insufficient' }
  if (!current) return base
  const direction = Math.sign(targetKg - current.weightKg)
  if (direction === 0 || (targetKg < current.weightKg && current.weightKg <= targetKg) || (targetKg > current.weightKg && current.weightKg >= targetKg)) return { ...base, remainingKg: 0, status: 'achieved', estimatedCompletionDate: format(currentDate, 'yyyy-MM-dd') }
  const requiredDaily = daysRemaining ? remainingKg! / daysRemaining : Number.POSITIVE_INFINITY
  base.requiredWeeklyKg = round(requiredDaily * 7)
  base.requiredMonthlyKg = round(requiredDaily * 30.4375)
  if (recent.length < 3) return base

  const points = recent.map((log) => ({ day: parseISO(log.occurredAt.slice(0, 10)).getTime() / 86_400_000, weight: log.weightKg }))
  const meanDay = points.reduce((sum, point) => sum + point.day, 0) / points.length
  const meanWeight = points.reduce((sum, point) => sum + point.weight, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.day - meanDay) ** 2, 0)
  const slope = denominator ? points.reduce((sum, point) => sum + (point.day - meanDay) * (point.weight - meanWeight), 0) / denominator : 0
  const paceTowardTarget = slope * direction
  base.recentWeeklyKg = round(slope * 7)
  if (paceTowardTarget > 0) base.estimatedCompletionDate = format(addDays(currentDate, Math.ceil(remainingKg! / paceTowardTarget)), 'yyyy-MM-dd')
  const ratio = requiredDaily > 0 ? paceTowardTarget / requiredDaily : 0
  base.status = ratio >= 1.15 ? 'ahead' : ratio >= .85 ? 'on_track' : ratio >= .5 ? 'attention' : 'off_track'
  return base
}

// Alias temporal para consumidores externos previos; conserva la API sin mantener la extrapolación antigua.
export const forecastWeight = weightGoalProgress
