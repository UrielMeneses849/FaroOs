export type SmartCleanerTask = {
  id: string
  status: string
  completedAt?: string | null
}

export type SmartCleanerMetrics = {
  scanned: number
  eligible: number
  cleaned: number
  skippedMissingCompletedAt: number
  errors: number
}

export const smartCleanerCutoff = (now: Date) => new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)

export function isTaskEligibleForSmartCleaning(task: SmartCleanerTask, now: Date) {
  if (task.status !== 'done' || !task.completedAt) return false
  const completedAt = new Date(task.completedAt)
  return Number.isFinite(completedAt.getTime()) && completedAt.getTime() <= smartCleanerCutoff(now).getTime()
}

/** Pure mirror of the DB predicate used by the scheduled cleaner. */
export function evaluateSmartCleaner(tasks: SmartCleanerTask[], now = new Date()) {
  const metrics: SmartCleanerMetrics = { scanned: 0, eligible: 0, cleaned: 0, skippedMissingCompletedAt: 0, errors: 0 }
  const cleanedIds: string[] = []
  for (const task of tasks) {
    if (task.status !== 'done') continue
    metrics.scanned += 1
    if (!task.completedAt) {
      metrics.skippedMissingCompletedAt += 1
      continue
    }
    if (!isTaskEligibleForSmartCleaning(task, now)) continue
    metrics.eligible += 1
    metrics.cleaned += 1
    cleanedIds.push(task.id)
  }
  return { cleanedIds, metrics }
}
