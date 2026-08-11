import { z } from 'zod'

export const voiceToolNames = [
  'getDailySummary', 'listTodayTasks', 'createTask', 'updateTaskStatus',
  'createExpense', 'createIncome', 'updateFinanceTransactionStatus',
  'updateFinanceTransaction', 'deleteFinanceTransaction', 'getSpentToday',
  'completePlannedTransaction', 'updateRecurringAmount',
  'searchFinanceTransactions', 'getFinanceSummary', 'listRecurringExpenses',
  'createRecurringExpense', 'registerRecurringPayment',
  'listCalendarItems', 'getNextCommitment', 'findCalendarEvent', 'findAvailableSlots',
  'createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'createScheduledTask',
] as const

export const voiceToolNameSchema = z.enum(voiceToolNames)
export type VoiceToolName = z.infer<typeof voiceToolNameSchema>

export const pendingActionSchema = z.object({
  requestId: z.string().uuid(),
  toolName: voiceToolNameSchema,
  arguments: z.record(z.string(), z.unknown()),
  summary: z.string(),
  possibleDuplicate: z.object({
    id: z.string().uuid(),
    description: z.string(),
    amount: z.number(),
    date: z.string(),
  }).optional(),
})
export type PendingVoiceAction = z.infer<typeof pendingActionSchema>

export const voiceEntityReferenceSchema = z.object({
  id: z.string(),
  type: z.enum(['finance_transaction', 'finance_recurring', 'calendar_event', 'calendar_task', 'google_event', 'calendar_slot']),
  title: z.string(),
  subtitle: z.string().optional(),
})
export type VoiceEntityReference = z.infer<typeof voiceEntityReferenceSchema>

export const voiceSessionContextSchema = z.object({
  sessionId: z.string().uuid(),
  lastSkill: z.enum(['finance', 'calendar']).optional(),
  lastResults: z.array(voiceEntityReferenceSchema).max(10).default([]),
  pendingClarification: z.object({
    intent: z.string(),
    missingFields: z.array(z.string()).max(5),
    entities: z.record(z.string(), z.unknown()).default({}),
  }).optional(),
  pendingAction: pendingActionSchema.optional(),
})
export type VoiceSessionContext = z.infer<typeof voiceSessionContextSchema>

export const voiceTraceSchema = z.object({
  startedAt: z.number(),
  marks: z.record(z.string(), z.number()).default({}),
})
export type VoiceTrace = z.infer<typeof voiceTraceSchema>

export type VoicePipeline = 'legacy' | 'optimized'
export type FaroTtsModel = 'current' | 'flash'

export const voiceCalendarSnapshotItemSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(['task', 'event']),
  title: z.string().trim().min(1).max(300),
  start: z.string().min(1).max(100),
  end: z.string().min(1).max(100).optional(),
  allDay: z.boolean().default(false),
  workspaceId: z.string().max(200).optional(),
})

export const voiceActionSchema = z.object({
  requestId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  source: z.enum(['text', 'voice']),
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2000),
  })).max(6).default([]),
  surface: z.enum(['dashboard', 'today', 'finances', 'lab']).default('lab'),
  pipeline: z.enum(['legacy', 'optimized']).default('optimized'),
  sessionContext: voiceSessionContextSchema.optional(),
  trace: voiceTraceSchema.optional(),
  localContext: z.object({
    now: z.string().datetime(),
    timezone: z.string().min(1).max(100),
    calendarItems: z.array(voiceCalendarSnapshotItemSchema).max(250).default([]),
  }).optional(),
})
export type VoiceConversationTurn = z.infer<typeof voiceActionSchema>['history'][number]

export const voiceResponseSchema = z.object({
  status: z.enum(['completed', 'needs_clarification', 'pending_confirmation', 'error']),
  message: z.string(),
  questions: z.array(z.string()).max(3).default([]),
  pendingAction: pendingActionSchema.optional(),
  result: z.unknown().optional(),
  qa: z.object({
    intent: z.string().optional(),
    entities: z.record(z.string(), z.unknown()).default({}),
    toolName: voiceToolNameSchema.optional(),
    toolArguments: z.record(z.string(), z.unknown()).optional(),
    timings: z.record(z.string(), z.number()).optional(),
    traceId: z.string().uuid().optional(),
    pipeline: z.enum(['legacy', 'optimized']).optional(),
    skill: z.enum(['finance', 'calendar']).optional(),
    route: z.string().optional(),
  }).optional(),
})
export type VoiceResponse = z.infer<typeof voiceResponseSchema>
