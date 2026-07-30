import { differenceInCalendarDays, endOfYear, parseISO } from 'date-fns'
import type { HealthLog } from '../types'

export interface WeightForecast {
  currentKg?: number
  projectedKg?: number
  weeklyChangeKg?: number
  status: 'positive' | 'regular' | 'negative' | 'insufficient'
  remainingKg?: number
}

export function forecastWeight(logs: HealthLog[], targetKg: number, targetDate = endOfYear(new Date())): WeightForecast {
  const points = logs
    .filter((log): log is HealthLog & { weightKg: number } => typeof log.weightKg === 'number')
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((log) => ({ day: parseISO(log.occurredAt.slice(0, 10)).getTime() / 86_400_000, weight: log.weightKg }))
  const currentKg = points.at(-1)?.weight
  if (points.length < 3 || currentKg == null) return { currentKg, status: 'insufficient', remainingKg: currentKg == null ? undefined : targetKg - currentKg }

  const meanDay = points.reduce((sum, point) => sum + point.day, 0) / points.length
  const meanWeight = points.reduce((sum, point) => sum + point.weight, 0) / points.length
  const denominator = points.reduce((sum, point) => sum + (point.day - meanDay) ** 2, 0)
  const dailySlope = denominator
    ? points.reduce((sum, point) => sum + (point.day - meanDay) * (point.weight - meanWeight), 0) / denominator
    : 0
  const remainingDays = Math.max(0, differenceInCalendarDays(targetDate, new Date(points.at(-1)!.day * 86_400_000)))
  const projectedKg = currentKg + dailySlope * remainingDays
  const currentDistance = Math.abs(currentKg - targetKg)
  const projectedDistance = Math.abs(projectedKg - targetKg)
  const improvement = currentDistance - projectedDistance
  const status = improvement > Math.max(.3, currentDistance * .12)
    ? 'positive'
    : improvement >= -Math.max(.2, currentDistance * .06) ? 'regular' : 'negative'
  return {
    currentKg,
    projectedKg: Math.round(projectedKg * 10) / 10,
    weeklyChangeKg: Math.round(dailySlope * 70) / 10,
    status,
    remainingKg: Math.round((targetKg - currentKg) * 10) / 10,
  }
}
