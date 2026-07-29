import { faroDataSchema } from '../lib/backup'
import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { FaroData } from '../types'

type GoalInsert = Database['public']['Tables']['goals']['Insert']
type IdeaInsert = Database['public']['Tables']['ideas']['Insert']
type ProjectInsert = Database['public']['Tables']['projects']['Insert']
type TaskInsert = Database['public']['Tables']['tasks']['Insert']
type StudyInsert = Database['public']['Tables']['study_sessions']['Insert']
type HealthInsert = Database['public']['Tables']['health_logs']['Insert']
type TreatmentInsert = Database['public']['Tables']['treatment_logs']['Insert']
type JournalInsert = Database['public']['Tables']['journal_entries']['Insert']
type TransactionInsert = Database['public']['Tables']['transactions']['Insert']

export const LOCAL_MIGRATION_VERSION = 3

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface LocalMigrationReport {
  version: number
  migratedAt: string
  migrated: {
    ideas: number
    goals: number
    projects: number
    tasks: number
    studySessions: number
    healthLogs: number
    treatmentLogs: number
    journalEntries: number
    transactions: number
  }
  pendingSchema: {
    ideas: number
    transactions: number
  }
}

const migrationKey = (userId: string) =>
  `faro-os-supabase-migration:v${LOCAL_MIGRATION_VERSION}:${userId}`

async function stableUuid(userId: string, localId: string): Promise<string> {
  if (uuidPattern.test(localId)) return localId
  const source = new TextEncoder().encode(`faro-os:${userId}:${localId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  const bytes = digest.slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

export function localDataNeedsMigration(data: FaroData): boolean {
  const entities = [
    ...data.ideas,
    ...data.goals,
    ...data.projects,
    ...data.tasks,
    ...data.studySessions,
    ...data.transactions,
    ...data.healthLogs,
    ...data.treatmentLogs,
    ...data.journalEntries,
  ]
  return entities.some((entity) => !uuidPattern.test(entity.id))
}

export async function remapLocalData(data: FaroData, userId: string): Promise<FaroData> {
  const ids = new Set<string>()
  const register = (id?: string) => {
    if (id) ids.add(id)
  }

  data.ideas.forEach((item) => {
    register(item.id)
    register(item.projectId)
    register(item.goalId)
  })
  data.goals.forEach((item) => {
    register(item.id)
    item.projectIds.forEach(register)
  })
  data.projects.forEach((item) => {
    register(item.id)
    register(item.goalId)
  })
  data.tasks.forEach((item) => {
    register(item.id)
    register(item.projectId)
    register(item.goalId)
  })
  ;[
    ...data.studySessions,
    ...data.transactions,
    ...data.healthLogs,
    ...data.treatmentLogs,
    ...data.journalEntries,
  ].forEach((item) => register(item.id))

  const pairs = await Promise.all(
    [...ids].map(async (id) => [id, await stableUuid(userId, id)] as const),
  )
  const idMap = new Map(pairs)
  const mapId = (id?: string) => id ? idMap.get(id) ?? id : undefined

  return faroDataSchema.parse({
    ideas: data.ideas.map((item) => ({
      ...item,
      id: mapId(item.id),
      projectId: mapId(item.projectId),
      goalId: mapId(item.goalId),
    })),
    goals: data.goals.map((item) => ({
      ...item,
      id: mapId(item.id),
      projectIds: item.projectIds.map((id) => mapId(id)),
    })),
    projects: data.projects.map((item) => ({
      ...item,
      id: mapId(item.id),
      goalId: mapId(item.goalId),
    })),
    tasks: data.tasks.map((item) => ({
      ...item,
      id: mapId(item.id),
      projectId: mapId(item.projectId),
      goalId: mapId(item.goalId),
    })),
    studySessions: data.studySessions.map((item) => ({ ...item, id: mapId(item.id) })),
    transactions: data.transactions.map((item) => ({ ...item, id: mapId(item.id) })),
    healthLogs: data.healthLogs.map((item) => ({ ...item, id: mapId(item.id) })),
    treatmentLogs: data.treatmentLogs.map((item) => ({ ...item, id: mapId(item.id) })),
    journalEntries: data.journalEntries.map((item) => ({ ...item, id: mapId(item.id) })),
  })
}

function parseDose(value?: string): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

export const localDataMigrationService = {
  getReport(userId: string): LocalMigrationReport | null {
    const value = localStorage.getItem(migrationKey(userId))
    if (!value) return null
    try {
      return JSON.parse(value) as LocalMigrationReport
    } catch {
      localStorage.removeItem(migrationKey(userId))
      return null
    }
  },

  async migrate(data: FaroData, userId: string) {
    const remapped = await remapLocalData(faroDataSchema.parse(data), userId)
    const workspaceSeeds = [
      ['Personal', 'personal', '#2457ff'],
      ['BBVA', 'employment', '#1973e8'],
      ['BIMSA', 'client', '#35c78a'],
      ['Nexvora', 'business', '#6d8aff'],
      ['Portfolio', 'personal', '#a970ff'],
    ] as const
    const workspaces = await Promise.all(workspaceSeeds.map(async ([name, type, color], index) => ({
      id: await stableUuid(userId, `workspace:${name.toLowerCase()}`),
      user_id: userId, name, type, color, is_active: true, sort_order: index,
    })))
    const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace.id]))
    const inferWorkspace = (title: string, area: string) => {
      const normalized = title.toLowerCase()
      if (normalized.includes('bbva')) return workspaceByName.get('BBVA')
      if (normalized.includes('bimsa')) return workspaceByName.get('BIMSA')
      if (area === 'nexvora') return workspaceByName.get('Nexvora')
      if (area === 'portfolio') return workspaceByName.get('Portfolio')
      return workspaceByName.get('Personal')
    }
    const goalWorkspaceById = new Map(remapped.goals.map((goal) => [
      goal.id,
      goal.workspaceId ?? inferWorkspace(goal.title, goal.area),
    ]))
    const projectWorkspaceById = new Map(remapped.projects.map((project) => [
      project.id,
      (project.goalId ? goalWorkspaceById.get(project.goalId) : undefined)
        ?? project.workspaceId
        ?? inferWorkspace(project.title, project.area),
    ]))

    const goals: GoalInsert[] = remapped.goals.map((goal) => ({
      id: goal.id,
      user_id: userId,
      title: goal.title,
      description: goal.description ?? null,
      area: goal.area,
      status: goal.status,
      target_date: goal.targetDate ?? null,
      completed_at: goal.status === 'completed' ? goal.updatedAt : null,
      archived_at: goal.archivedAt ?? null,
      created_at: goal.createdAt,
      updated_at: goal.updatedAt,
      workspace_id: goalWorkspaceById.get(goal.id) ?? null,
    }))
    const ideas: IdeaInsert[] = remapped.ideas.map((idea) => ({
      id: idea.id,
      user_id: userId,
      title: idea.title,
      description: idea.description ?? null,
      area: idea.area,
      status: idea.status,
      idea_date: idea.date ?? null,
      project_id: idea.projectId ?? null,
      goal_id: idea.goalId ?? null,
      archived_at: idea.archivedAt ?? null,
      created_at: idea.createdAt,
      updated_at: idea.updatedAt,
      workspace_id: inferWorkspace(idea.title, idea.area) ?? null,
    }))
    const projects: ProjectInsert[] = remapped.projects.map((project) => ({
      id: project.id,
      user_id: userId,
      title: project.title,
      description: project.description ?? null,
      area: project.area,
      status: project.status,
      priority: project.priority,
      goal_id: project.goalId ?? null,
      start_date: project.startDate ?? null,
      target_date: project.endDate ?? null,
      completed_at: project.status === 'completed' ? project.updatedAt : null,
      archived_at: project.archivedAt ?? null,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      workspace_id: projectWorkspaceById.get(project.id) ?? null,
    }))
    const tasks: TaskInsert[] = remapped.tasks.map((task) => ({
      id: task.id,
      user_id: userId,
      title: task.title,
      description: task.description ?? null,
      notes: task.notes ?? null,
      area: task.area,
      status: task.status,
      priority: task.priority,
      project_id: task.projectId ?? null,
      goal_id: task.goalId ?? null,
      due_at: task.dueAt ?? task.dueDate ?? null,
      estimated_minutes: task.estimatedMinutes ?? null,
      completed_at: task.status === 'done' ? task.updatedAt : null,
      archived_at: task.archivedAt ?? null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      workspace_id: (task.projectId ? projectWorkspaceById.get(task.projectId) : undefined)
        ?? (task.goalId ? goalWorkspaceById.get(task.goalId) : undefined)
        ?? task.workspaceId
        ?? inferWorkspace(task.title, task.area)
        ?? null,
      stakeholder: task.stakeholder ?? null,
      waiting_for: task.waitingFor ?? null,
      blocker_reason: task.blockerReason ?? null,
      paused_until: task.pausedUntil ?? null,
    }))
    const study: StudyInsert[] = remapped.studySessions.map((session) => ({
      id: session.id,
      user_id: userId,
      topic: session.topic,
      skill: session.skill,
      minutes: session.durationMinutes,
      occurred_at: session.occurredAt,
      notes: session.notes ?? null,
      archived_at: session.archivedAt ?? null,
      created_at: session.createdAt,
      workspace_id: null,
    }))
    const health: HealthInsert[] = remapped.healthLogs.map((log) => ({
      id: log.id,
      user_id: userId,
      log_date: log.occurredAt.slice(0, 10),
      energy: log.energy,
      mood: log.mood ?? null,
      anxiety: log.anxiety ?? null,
      sleep_hours: log.sleepHours ?? null,
      meditation_minutes: log.meditationMinutes ?? null,
      movement_minutes: log.movementMinutes ?? null,
      training_minutes: log.trainingMinutes ?? null,
      weight_kg: log.weightKg ?? null,
      water_liters: log.waterLiters ?? null,
      workout_completed: (log.trainingMinutes ?? 0) > 0,
      archived_at: log.archivedAt ?? null,
      notes: log.notes ?? null,
      created_at: log.createdAt,
      updated_at: log.updatedAt,
    }))
    const treatment: TreatmentInsert[] = remapped.treatmentLogs.map((log) => ({
      id: log.id,
      user_id: userId,
      log_date: log.occurredAt.slice(0, 10),
      medication_taken: log.medicationTaken,
      dose_mg: parseDose(log.dosage),
      dosage_text: log.dosage ?? null,
      dryness_level: log.dryness ?? null,
      skin_status: null,
      skin_condition: log.skinCondition ?? null,
      side_effects: log.sideEffects
        ? log.sideEffects.split(',').map((value) => value.trim()).filter(Boolean)
        : [],
      notes: log.notes ?? null,
      archived_at: log.archivedAt ?? null,
      created_at: log.createdAt,
      updated_at: log.updatedAt,
    }))
    const journal: JournalInsert[] = remapped.journalEntries.map((entry) => ({
      id: entry.id,
      user_id: userId,
      entry_date: entry.occurredAt.slice(0, 10),
      title: entry.title,
      content: entry.content,
      mood: entry.mood ?? null,
      gratitude: entry.gratitude ?? null,
      lesson: entry.lesson ?? null,
      tags: entry.tags,
      area: entry.area,
      archived_at: entry.archivedAt ?? null,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
    }))
    const transactions: TransactionInsert[] = remapped.transactions.map((transaction) => ({
      id: transaction.id,
      user_id: userId,
      description: transaction.description,
      amount: transaction.amount,
      kind: transaction.kind,
      category: transaction.category,
      occurred_at: transaction.occurredAt.slice(0, 10),
      archived_at: transaction.archivedAt ?? null,
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
    }))

    {
      const { error } = await supabase.from('workspaces').upsert(workspaces, {
        onConflict: 'user_id,name',
      })
      if (error) throw error
    }
    if (goals.length) {
      const { error } = await supabase
        .from('goals')
        .upsert(goals, { onConflict: 'id' })
      if (error) throw error
    }
    if (projects.length) {
      const { error } = await supabase
        .from('projects')
        .upsert(projects, { onConflict: 'id' })
      if (error) throw error
    }
    if (ideas.length) {
      const { error } = await supabase
        .from('ideas')
        .upsert(ideas, { onConflict: 'id' })
      if (error) throw error
    }
    if (tasks.length) {
      const { error } = await supabase
        .from('tasks')
        .upsert(tasks, { onConflict: 'id' })
      if (error) throw error
    }
    if (study.length) {
      const { error } = await supabase
        .from('study_sessions')
        .upsert(study, { onConflict: 'id' })
      if (error) throw error
    }
    if (health.length) {
      const { error } = await supabase
        .from('health_logs')
        .upsert(health, { onConflict: 'id' })
      if (error) throw error
    }
    if (treatment.length) {
      const { error } = await supabase
        .from('treatment_logs')
        .upsert(treatment, { onConflict: 'id' })
      if (error) throw error
    }
    if (journal.length) {
      const { error } = await supabase
        .from('journal_entries')
        .upsert(journal, { onConflict: 'id' })
      if (error) throw error
    }
    if (transactions.length) {
      const { error } = await supabase
        .from('transactions')
        .upsert(transactions, { onConflict: 'id' })
      if (error) throw error
    }

    const report: LocalMigrationReport = {
      version: LOCAL_MIGRATION_VERSION,
      migratedAt: new Date().toISOString(),
      migrated: {
        ideas: ideas.length,
        goals: goals.length,
        projects: projects.length,
        tasks: tasks.length,
        studySessions: study.length,
        healthLogs: health.length,
        treatmentLogs: treatment.length,
        journalEntries: journal.length,
        transactions: transactions.length,
      },
      pendingSchema: {
        ideas: 0,
        transactions: 0,
      },
    }
    localStorage.setItem(migrationKey(userId), JSON.stringify(report))
    return { data: remapped, report }
  },
}
