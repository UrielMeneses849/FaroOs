import { supabase } from '../lib/supabase/client'
import type { Sprint, SprintData, SprintOutcome, SprintReview, SprintTask } from '../features/sprints/sprintTypes'

// This adapter keeps the domain model in camelCase while Supabase rows use snake_case.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any
const sprintFrom = (row: Record<string, unknown>): Sprint => ({ id: String(row.id), userId: String(row.user_id), name: String(row.name), startDate: String(row.start_date), endDate: String(row.end_date), status: row.status as Sprint['status'], mainOutcome: String(row.main_outcome), capacityMinutes: row.capacity_minutes == null ? undefined : Number(row.capacity_minutes), notes: row.notes ? String(row.notes) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
const outcomeFrom = (row: Record<string, unknown>): SprintOutcome => ({ id: String(row.id), userId: String(row.user_id), sprintId: String(row.sprint_id), title: String(row.title), type: row.type as SprintOutcome['type'], status: row.status as SprintOutcome['status'], sortOrder: Number(row.sort_order), createdAt: String(row.created_at), updatedAt: String(row.updated_at) })
const taskFrom = (row: Record<string, unknown>): SprintTask => ({ id: String(row.id), userId: String(row.user_id), sprintId: String(row.sprint_id), taskId: String(row.task_id), commitmentType: row.commitment_type as SprintTask['commitmentType'], addedAt: String(row.added_at), completedInSprint: Boolean(row.completed_in_sprint), removedAt: row.removed_at ? String(row.removed_at) : undefined, createdAt: String(row.created_at) })
const reviewFrom = (row: Record<string, unknown>): SprintReview => ({ id: String(row.id), userId: String(row.user_id), sprintId: String(row.sprint_id), summary: row.summary ? String(row.summary) : undefined, wins: row.wins ? String(row.wins) : undefined, blockers: row.blockers ? String(row.blockers) : undefined, lessons: row.lessons ? String(row.lessons) : undefined, carryOverNotes: row.carry_over_notes ? String(row.carry_over_notes) : undefined, createdAt: String(row.created_at), updatedAt: String(row.updated_at) })

export const sprintRepository = {
  async load(userId: string): Promise<SprintData> {
    const [sprints, outcomes, sprintTasks, reviews] = await Promise.all([
      db.from('sprints').select('*').eq('user_id', userId).order('start_date', { ascending: false }),
      db.from('sprint_outcomes').select('*').eq('user_id', userId).order('sort_order'),
      db.from('sprint_tasks').select('*').eq('user_id', userId),
      db.from('sprint_reviews').select('*').eq('user_id', userId),
    ])
    for (const result of [sprints, outcomes, sprintTasks, reviews]) if (result.error) throw result.error
    return { sprints: sprints.data.map(sprintFrom), outcomes: outcomes.data.map(outcomeFrom), sprintTasks: sprintTasks.data.map(taskFrom), reviews: reviews.data.map(reviewFrom) }
  },
  async saveSprint(item: Omit<Sprint, 'userId' | 'createdAt' | 'updatedAt'>, userId: string) {
    const { error } = await db.from('sprints').upsert({ id: item.id, user_id: userId, name: item.name, start_date: item.startDate, end_date: item.endDate, status: item.status, main_outcome: item.mainOutcome, capacity_minutes: item.capacityMinutes ?? null, notes: item.notes ?? null })
    if (error) throw error
  },
  async saveOutcome(item: Omit<SprintOutcome, 'userId' | 'createdAt' | 'updatedAt'>, userId: string) {
    const { error } = await db.from('sprint_outcomes').upsert({ id: item.id, user_id: userId, sprint_id: item.sprintId, title: item.title, type: item.type, status: item.status, sort_order: item.sortOrder })
    if (error) throw error
  },
  async addTask(sprintId: string, taskId: string, commitmentType: SprintTask['commitmentType'], userId: string) {
    const { error } = await db.from('sprint_tasks').upsert({ user_id: userId, sprint_id: sprintId, task_id: taskId, commitment_type: commitmentType }, { onConflict: 'user_id,sprint_id,task_id' })
    if (error) throw error
  },
  async updateSprintTask(id: string, values: Record<string, unknown>, userId: string) {
    const { error } = await db.from('sprint_tasks').update(values).eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
  async saveReview(item: Omit<SprintReview, 'userId' | 'createdAt' | 'updatedAt'>, userId: string) {
    const { error } = await db.from('sprint_reviews').upsert({ id: item.id, user_id: userId, sprint_id: item.sprintId, summary: item.summary, wins: item.wins, blockers: item.blockers, lessons: item.lessons, carry_over_notes: item.carryOverNotes }, { onConflict: 'user_id,sprint_id' })
    if (error) throw error
  },
}
