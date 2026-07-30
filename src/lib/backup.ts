import { z } from 'zod'
import type { FaroData } from '../types'

const base = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
}
const area = z.enum(['personal', 'health', 'finance', 'learning', 'nexvora', 'portfolio', 'travel', 'relationships'])
const priority = z.enum(['low', 'medium', 'high', 'critical'])

export const faroDataSchema: z.ZodType<FaroData> = z.object({
  ideas: z.array(z.object({ ...base, title: z.string(), description: z.string().optional(), area, status: z.enum(['inbox', 'archived', 'converted']), date: z.string().optional(), projectId: z.string().optional(), goalId: z.string().optional() })),
  goals: z.array(z.object({ ...base, title: z.string(), description: z.string().optional(), area, status: z.enum(['active', 'paused', 'completed']), targetDate: z.string().optional(), projectIds: z.array(z.string()), workspaceId: z.string().optional() })),
  projects: z.array(z.object({ ...base, title: z.string(), description: z.string().optional(), area, status: z.enum(['idea', 'planned', 'active', 'paused', 'completed']), goalId: z.string().optional(), priority, startDate: z.string().optional(), endDate: z.string().optional(), workspaceId: z.string().optional() })),
  tasks: z.array(z.object({ ...base, title: z.string(), description: z.string().optional(), notes: z.string().optional(), area, status: z.enum(['inbox', 'todo', 'doing', 'paused', 'blocked', 'done']), priority, projectId: z.string().optional(), goalId: z.string().optional(), dueDate: z.string().optional(), dueAt: z.string().optional(), estimatedMinutes: z.number().nonnegative().optional(), sortOrder: z.number().optional(), workspaceId: z.string().optional(), stakeholder: z.string().optional(), waitingFor: z.string().optional(), blockerReason: z.string().optional(), pausedUntil: z.string().optional() })),
  studySessions: z.array(z.object({ ...base, topic: z.string(), skill: z.string(), area: z.literal('learning'), durationMinutes: z.number().positive(), occurredAt: z.string(), notes: z.string().optional() })),
  transactions: z.array(z.object({ ...base, description: z.string(), area: z.literal('finance'), amount: z.number().nonnegative(), kind: z.enum(['income', 'expense', 'saving']), occurredAt: z.string(), category: z.string() })),
  healthLogs: z.array(z.object({ ...base, area: z.literal('health'), occurredAt: z.string(), energy: z.number().min(1).max(10), foodQuality: z.enum(['good', 'okay', 'bad']).optional(), mood: z.number().min(1).max(10).optional(), anxiety: z.number().min(1).max(10).optional(), sleepHours: z.number().nonnegative().max(24).optional(), movementMinutes: z.number().nonnegative().optional(), trainingMinutes: z.number().nonnegative().optional(), meditationMinutes: z.number().nonnegative().optional(), weightKg: z.number().positive().optional(), waterLiters: z.number().nonnegative().optional(), notes: z.string().optional() })),
  treatmentLogs: z.array(z.object({ ...base, area: z.literal('health'), treatment: z.literal('isotretinoin'), occurredAt: z.string(), medicationTaken: z.boolean(), dosage: z.string().optional(), dryness: z.number().min(1).max(10).optional(), skinCondition: z.string().optional(), sideEffects: z.string().optional(), notes: z.string().optional() })),
  journalEntries: z.array(z.object({ ...base, area, title: z.string(), content: z.string(), occurredAt: z.string(), mood: z.number().min(1).max(10).optional(), gratitude: z.string().optional(), lesson: z.string().optional(), tags: z.array(z.string()) })),
})

const backupSchema = z.object({
  product: z.literal('FARO OS'),
  schemaVersion: z.literal(4),
  exportedAt: z.string(),
  data: faroDataSchema,
})

export type FaroBackup = z.infer<typeof backupSchema>

export function createBackup(data: FaroData): FaroBackup {
  return { product: 'FARO OS', schemaVersion: 4, exportedAt: new Date().toISOString(), data: faroDataSchema.parse(data) }
}

export function parseBackup(input: string): FaroBackup {
  let json: unknown
  try {
    json = JSON.parse(input)
  } catch {
    throw new Error('El archivo no contiene JSON válido.')
  }
  const parsed = backupSchema.safeParse(json)
  if (!parsed.success) throw new Error('El respaldo no tiene un formato compatible con FARO OS v0.1.')
  return parsed.data
}

export function emptyData(): FaroData {
  return { ideas: [], goals: [], projects: [], tasks: [], studySessions: [], transactions: [], healthLogs: [], treatmentLogs: [], journalEntries: [] }
}
