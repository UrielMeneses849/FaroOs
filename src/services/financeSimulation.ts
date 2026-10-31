import { format } from 'date-fns'
import type { FinanceData, FinanceTransaction } from '../features/finance/financeTypes'
import { debtRemainingCents, scheduledDebtPayments } from './debtSchedule'

export interface FinanceSimulationItem {
  id: string
  kind: 'expense' | 'income' | 'debt_payment'
  description: string
  date: string
  amountCents: number
  accountId: string
  categoryId?: string
  debtId?: string
  settles?: boolean
}

export interface FinanceSimulationState {
  version: 1
  enabled: boolean
  items: FinanceSimulationItem[]
}

export const createFinanceSimulationState = (): FinanceSimulationState => ({ version: 1, enabled: false, items: [] })

export const financeSimulationStorageKey = (userId: string) => `faro:finance-simulation:v1:${encodeURIComponent(userId)}`

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

export function validateFinanceSimulationItem(value: unknown): FinanceSimulationItem {
  if (!object(value) || !nonempty(value.id) || !nonempty(value.description) || !nonempty(value.accountId)
    || !['expense', 'income', 'debt_payment'].includes(String(value.kind)) || !validDate(value.date)
    || !Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0
    || (value.categoryId !== undefined && !nonempty(value.categoryId))
    || (value.debtId !== undefined && !nonempty(value.debtId))
    || (value.settles !== undefined && typeof value.settles !== 'boolean')
    || (value.kind === 'debt_payment' && !nonempty(value.debtId))
    || (value.kind !== 'debt_payment' && (value.debtId !== undefined || value.settles !== undefined))) {
    throw new Error('La simulación contiene un movimiento inválido. Revisa su fecha, importe, cuenta y deuda.')
  }
  return {
    id: value.id,
    kind: value.kind as FinanceSimulationItem['kind'],
    description: value.description.trim(),
    date: value.date,
    amountCents: value.amountCents as number,
    accountId: value.accountId,
    ...(value.categoryId === undefined ? {} : { categoryId: value.categoryId as string }),
    ...(value.debtId === undefined ? {} : { debtId: value.debtId as string }),
    ...(value.settles === undefined ? {} : { settles: value.settles as boolean }),
  }
}

/** Reject the whole saved document instead of silently dropping unreadable items. */
export function parseFinanceSimulationState(raw: string): FinanceSimulationState {
  const value: unknown = JSON.parse(raw)
  if (!object(value) || value.version !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.items)) {
    throw new Error('El formato de la simulación guardada no es compatible.')
  }
  const items = value.items.map(validateFinanceSimulationItem)
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('La simulación guardada tiene identificadores duplicados.')
  return { version: 1, enabled: value.enabled, items }
}

const isDebtOutflow = (transaction: FinanceTransaction) => transaction.type === 'expense' || transaction.type === 'debt_payment'
const isPlanned = (transaction: FinanceTransaction) => transaction.status === 'planned' || transaction.status === 'pending'

/**
 * A read-only overlay for forecasts. Hypothetical movements are always planned,
 * so they never alter balances, reservations consumed, or completed-payment logs.
 * Stored dates already in the past remain in the scenario, but do not turn into
 * invented arrears when the app is opened on a later day.
 */
export function applyFinanceSimulation(real: FinanceData, state: FinanceSimulationState, reference = new Date()): FinanceData {
  if (!state.enabled || !state.items.length) return real
  const today = format(reference, 'yyyy-MM-dd')
  const accountIds = new Set(real.accounts.filter(account => account.isActive).map(account => account.id))
  const debtIds = new Set(real.debtPlan?.debts.filter(debt => debt.status === 'active').map(debt => debt.id))
  const items = state.items.filter(item => item.date >= today && accountIds.has(item.accountId)
    && (item.kind !== 'debt_payment' || (item.debtId && debtIds.has(item.debtId))))
  if (!items.length) return real

  const simulatedDebtIds = new Set(items.flatMap(item => item.debtId ? [item.debtId] : []))
  const payoffs = new Map<string, FinanceSimulationItem>()
  for (const item of items) {
    if (item.debtId && item.settles && (!payoffs.has(item.debtId) || item.date < payoffs.get(item.debtId)!.date)) {
      payoffs.set(item.debtId, item)
    }
  }
  const replacesPlanned = (transaction: FinanceTransaction) => Boolean(transaction.debtId && isDebtOutflow(transaction) && isPlanned(transaction)
    && ((payoffs.has(transaction.debtId) && transaction.transactionDate >= payoffs.get(transaction.debtId)!.date)
      || items.some(item => item.debtId === transaction.debtId && item.date === transaction.transactionDate)))
  const timestamp = `${today}T12:00:00.000Z`
  const hypothetical: FinanceTransaction[] = items
    // A payoff is terminal: retain later ideas in storage without charging them.
    .filter(item => !item.debtId || !payoffs.has(item.debtId)
      || item.date < payoffs.get(item.debtId)!.date || item.id === payoffs.get(item.debtId)!.id)
    .map(item => ({
      id: `simulation:${item.id}`,
      accountId: item.accountId,
      categoryId: item.categoryId,
      type: item.kind,
      amountCents: item.amountCents,
      transactionDate: item.date,
      description: `${item.description} · simulación`,
      status: 'planned',
      ...(item.debtId ? { debtId: item.debtId, debtPrincipalCents: item.amountCents, debtSettlement: item.settles ?? false } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
  const transactions = [...real.transactions.filter(transaction => !replacesPlanned(transaction)), ...hypothetical]
  const recurring = real.recurring.map(item => {
    const payoff = item.debtId && payoffs.get(item.debtId)?.date
    if (!payoff) return item
    // Keep the linked calendar active through the payoff day. Otherwise the
    // fallback debt schedule would generate installments before that day.
    return { ...item, endDate: item.endDate && item.endDate < payoff ? item.endDate : payoff }
  })
  const recurringOccurrences = real.recurringOccurrences.map(item => ({ ...item }))
  const transactionOverrides = new Map<string, FinanceTransaction | null>()
  for (const debt of real.debtPlan?.debts ?? []) {
    if (!simulatedDebtIds.has(debt.id)) continue
    let remaining = debtRemainingCents(debt, real)
    const recurringIds = new Set(real.recurring.filter(item => item.debtId === debt.id).map(item => item.id))
    const explicit = transactions.filter(transaction => transaction.debtId === debt.id && isDebtOutflow(transaction) && isPlanned(transaction))
    const occurrences = recurringOccurrences.filter(occurrence => recurringIds.has(occurrence.recurringTransactionId)
      && occurrence.expectedDate >= today && occurrence.status !== 'paid' && occurrence.status !== 'skipped')
    const through = [...explicit.map(item => item.transactionDate), ...occurrences.map(item => item.expectedDate), today].sort().at(-1)!
    const estimates = scheduledDebtPayments({ ...real, transactions, recurring, recurringOccurrences }, through, reference)
      .filter(payment => payment.debt.id === debt.id)
    const events = [
      ...explicit.map(transaction => ({ date: transaction.transactionDate, transaction })),
      ...occurrences.map(occurrence => ({ date: occurrence.expectedDate, occurrence })),
      ...estimates.map(estimate => ({ date: estimate.date, estimate })),
    ].sort((left, right) => left.date.localeCompare(right.date) || ('transaction' in left ? -1 : 1))
    for (const event of events) {
      if ('transaction' in event) {
        const transaction = event.transaction
        if (!remaining) {
          transactionOverrides.set(transaction.id, null)
          continue
        }
        const principal = transaction.debtPrincipalCents ?? transaction.amountCents
        if (!transaction.debtSettlement && principal > remaining) {
          // Retain an explicitly separated financing charge. Only principal is
          // capped; otherwise a final scheduled installment could overpay debt.
          const charge = Math.max(0, transaction.amountCents - principal)
          transactionOverrides.set(transaction.id, { ...transaction, amountCents: remaining + charge, debtPrincipalCents: remaining })
        }
        remaining = transaction.debtSettlement ? 0 : Math.max(0, remaining - (transaction.debtPrincipalCents ?? transaction.amountCents))
        continue
      }
      if ('estimate' in event) {
        remaining = Math.max(0, remaining - event.estimate.amountCents)
        continue
      }
      const occurrence = event.occurrence
      const materialized = occurrence.transactionId && transactions.some(transaction => transaction.id === occurrence.transactionId
        && transaction.status !== 'cancelled' && transactionOverrides.get(transaction.id) !== null)
      const replaced = explicit.some(transaction => transaction.transactionDate === occurrence.expectedDate)
      if (materialized || replaced || remaining === 0) {
        if (!materialized) occurrence.status = 'skipped'
        continue
      }
      occurrence.amountCents = Math.min(remaining, occurrence.amountCents ?? 0)
      remaining -= occurrence.amountCents
    }
  }
  return {
    ...real,
    transactions: transactions.flatMap(transaction => {
      const override = transactionOverrides.get(transaction.id)
      return override === null ? [] : [override ?? transaction]
    }),
    recurring,
    recurringOccurrences,
  }
}
