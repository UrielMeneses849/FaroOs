import { z } from 'zod'

export const voiceToolNames = [
  'getDailySummary', 'listTodayTasks', 'createTask', 'updateTaskStatus',
  'createExpense', 'createIncome', 'updateFinanceTransactionStatus',
  'searchFinanceTransactions', 'getFinanceSummary',
] as const

export const voiceToolNameSchema = z.enum(voiceToolNames)
export type VoiceToolName = z.infer<typeof voiceToolNameSchema>

export const voiceActionSchema = z.object({
  requestId: z.string().uuid(),
  source: z.enum(['text', 'voice']),
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2000),
  })).max(6).default([]),
})
export type VoiceConversationTurn = z.infer<typeof voiceActionSchema>['history'][number]

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
  }).optional(),
})
export type VoiceResponse = z.infer<typeof voiceResponseSchema>
