import { z } from 'zod'

const uuid = z.string().uuid()
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const financeTransactionSchema = z.object({
  accountId: uuid,
  destinationAccountId: uuid.optional(),
  categoryId: uuid.optional(),
  type: z.enum(['income', 'expense', 'transfer', 'saving', 'debt_payment', 'refund']),
  amountCents: z.number().int().positive(),
  transactionDate: dateOnly,
  description: z.string().trim().min(1).max(160),
  status: z.enum(['planned', 'pending', 'completed', 'cancelled']),
  notes: z.string().trim().max(1000).optional(),
  budgetId: uuid.optional(),
}).superRefine((value, context) => {
  if (value.type === 'transfer') {
    if (!value.destinationAccountId) context.addIssue({ code: 'custom', path: ['destinationAccountId'], message: 'Selecciona una cuenta destino.' })
    if (value.destinationAccountId === value.accountId) context.addIssue({ code: 'custom', path: ['destinationAccountId'], message: 'La cuenta destino debe ser diferente.' })
  } else if (!value.categoryId) {
    context.addIssue({ code: 'custom', path: ['categoryId'], message: 'Selecciona una categoría.' })
  }
})

export const financeAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['cash', 'checking', 'savings', 'credit', 'investment', 'loan']),
  initialBalanceCents: z.number().int(),
  creditLimitCents: z.number().int().nonnegative().optional(),
  closingDay: z.number().int().min(1).max(31).optional(),
  paymentDay: z.number().int().min(1).max(31).optional(),
})

export const financeBudgetSchema = z.object({
  categoryId: uuid,
  month: dateOnly,
  plannedAmountCents: z.number().int().nonnegative(),
})

export const financeGoalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  targetAmountCents: z.number().int().positive().default(1),
  targetDate: dateOnly.optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  linkedAccountId: uuid.optional(),
})
