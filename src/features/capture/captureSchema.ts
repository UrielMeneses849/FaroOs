import { z } from 'zod'

export const captureSchema = z.object({
  title: z.string().trim().min(1, 'Escribe un título').max(140, 'Usa máximo 140 caracteres'),
  kind: z.enum(['idea', 'task', 'project', 'goal']),
  area: z.enum(['personal', 'health', 'finance', 'learning', 'nexvora', 'portfolio', 'travel', 'relationships']),
  description: z.string().trim().max(1200, 'Usa máximo 1,200 caracteres').optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  date: z.string().optional(),
  projectId: z.string().optional(),
  goalId: z.string().optional(),
})

export type CaptureValues = z.infer<typeof captureSchema>
