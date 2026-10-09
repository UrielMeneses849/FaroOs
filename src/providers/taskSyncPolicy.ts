import type { Task } from '../types'

const COMPLETED_TASK_UPLOAD_GRACE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * A completed task that disappeared remotely after the cleaner grace period is
 * a deletion, not an offline create. Re-uploading it would resurrect the row
 * and the database trigger would incorrectly make it look completed today.
 */
export const shouldUploadMissingLocalTask = (task: Task, now = Date.now()) => {
  if (task.status !== 'done') return true
  const lastLocalChange = new Date(task.updatedAt).getTime()
  return Number.isFinite(lastLocalChange)
    && lastLocalChange > now - COMPLETED_TASK_UPLOAD_GRACE_MS
}
