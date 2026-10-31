import { format, isValid, parseISO } from 'date-fns'
import { z } from 'zod'
import type { FinanceData } from '../features/finance/financeTypes'
import type { FinanceDecisionEvent, FinanceDecisionReport } from './financeDecisionTools'
import { debtPlanBalanceCents } from './debtPlanBalance'
import { FINANCE_LIQUIDITY_PROJECTION_VERSION } from './financeLiquidityProjection'
import { accountBalance } from './financeService'

export interface FinanceForecastJournalEntry {
  version: 1
  projectionVersion: number
  id: string
  week: string
  capturedAt: string
  referenceDate: string
  horizonEnd: string
  availableTodayCents: number
  bufferCents: number
  days: { date: string; balanceCents: number }[]
  events: FinanceDecisionEvent[]
  assumptions: string[]
}
export interface FinanceForecastJournalState {
  status: 'ready' | 'unavailable' | 'invalid'
  entries: FinanceForecastJournalEntry[]
  message?: string
}
type JournalStorage = Pick<Storage, 'getItem' | 'setItem'>
export const FINANCE_FORECAST_JOURNAL_LIMIT = 26
const journalKey = (userId: string) => `faro.finance.forecast-journal.v1:${encodeURIComponent(userId)}`
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => isValid(parseISO(value)) && format(parseISO(value), 'yyyy-MM-dd') === value)
const integer = z.number().refine(Number.isSafeInteger)
const eventSchema = z.object({
  id: z.string(), date: dateKey, originalDate: dateKey.optional(), label: z.string(), amountCents: integer,
  kind: z.enum(['income', 'expense']), source: z.enum(['movement', 'recurring', 'budget', 'simulation', 'debt']),
  evidence: z.enum(['actual', 'commitment', 'estimate']), originLabel: z.string(),
  isOverdue: z.boolean().optional(), budgetId: z.string().optional(), periodStart: dateKey.optional(), periodEnd: dateKey.optional(),
})
const entrySchema = z.object({
  version: z.literal(1), projectionVersion: integer, id: z.string(), week: z.string().regex(/^\d{4}-W\d{2}$/),
  capturedAt: z.string().refine(value => isValid(parseISO(value))), referenceDate: dateKey, horizonEnd: dateKey,
  availableTodayCents: integer, bufferCents: integer.nonnegative(),
  days: z.array(z.object({ date: dateKey, balanceCents: integer })).min(1).max(366),
  events: z.array(eventSchema).max(10000), assumptions: z.array(z.string()).max(30),
}).refine(entry => entry.referenceDate <= entry.horizonEnd
  && entry.days[0]?.date === entry.referenceDate && entry.days.at(-1)?.date === entry.horizonEnd
  && entry.days.every((day, index) => !index || day.date > entry.days[index - 1].date))
const stateSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(FINANCE_FORECAST_JOURNAL_LIMIT) })
const resolveStorage = (storage?: JournalStorage) => storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)

export function financeForecastWeek(date = new Date()) {
  if (!isValid(date)) throw new Error('Fecha de fotografía inválida.')
  return format(date, "RRRR-'W'II")
}
export function hasFinanceForecastSnapshotForWeek(entries: FinanceForecastJournalEntry[], date = new Date()) {
  return entries.some(entry => entry.week === financeForecastWeek(date) && entry.projectionVersion === FINANCE_LIQUIDITY_PROJECTION_VERSION)
}
export function loadFinanceForecastJournal(userId: string, storage?: JournalStorage): FinanceForecastJournalState {
  if (!userId.trim()) return { status: 'unavailable', entries: [], message: 'Falta el usuario para abrir sus fotografías.' }
  try {
    const target = resolveStorage(storage)
    if (!target) return { status: 'unavailable', entries: [], message: 'El historial semanal no está disponible en este dispositivo.' }
    const raw = target.getItem(journalKey(userId))
    if (!raw) return { status: 'ready', entries: [] }
    const result = stateSchema.safeParse(JSON.parse(raw))
    if (!result.success) return { status: 'invalid', entries: [], message: 'No se pudo leer el historial semanal; sus datos guardados se conservaron.' }
    const identities = result.data.entries.map(entry => `${entry.week}:${entry.projectionVersion}`)
    if (new Set(identities).size !== identities.length) return { status: 'invalid', entries: [], message: 'El historial contiene semanas repetidas; sus datos guardados se conservaron.' }
    return { status: 'ready', entries: result.data.entries.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)) }
  } catch {
    return { status: 'invalid', entries: [], message: 'No se pudo leer el historial semanal; sus datos guardados se conservaron.' }
  }
}

/** The first real projection in each ISO week is immutable. Simulated reports must never be passed here. */
export function captureFinanceForecastJournal(userId: string, report: FinanceDecisionReport, capturedDate = new Date(), storage?: JournalStorage): FinanceForecastJournalState & { captured: boolean } {
  const state = loadFinanceForecastJournal(userId, storage)
  if (state.status !== 'ready' || hasFinanceForecastSnapshotForWeek(state.entries, capturedDate)) return { ...state, captured: false }
  const week = financeForecastWeek(capturedDate)
  const snapshot: FinanceForecastJournalEntry = {
    version: 1, projectionVersion: FINANCE_LIQUIDITY_PROJECTION_VERSION, id: `${week}:v${FINANCE_LIQUIDITY_PROJECTION_VERSION}`, week,
    capturedAt: capturedDate.toISOString(), referenceDate: report.referenceDate, horizonEnd: report.horizonEnd,
    availableTodayCents: report.availableTodayCents, bufferCents: report.bufferCents,
    days: report.scenarios.base.days.map(day => ({ date: day.date, balanceCents: day.balanceCents })),
    events: report.scenarios.base.events.map(event => ({ ...event })), assumptions: [...report.scenarios.base.assumptions],
  }
  // Reject an accidentally supplied simulation even if a caller forgets its mode guard.
  if (snapshot.events.some(event => event.source === 'simulation' || event.originLabel === 'Simulación guardada')) return { ...state, captured: false, message: 'Las simulaciones no se guardan como pronóstico real.' }
  const entries = [snapshot, ...state.entries].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, FINANCE_FORECAST_JOURNAL_LIMIT)
  const parsed = stateSchema.safeParse({ version: 1, entries })
  if (!parsed.success) return { ...state, captured: false, message: 'La fotografía no es válida; el historial anterior se conservó.' }
  try {
    const target = resolveStorage(storage)
    if (!target) return { ...state, status: 'unavailable', captured: false, message: 'No se pudo guardar la fotografía semanal en este dispositivo.' }
    target.setItem(journalKey(userId), JSON.stringify(parsed.data))
    return { status: 'ready', entries: parsed.data.entries, captured: true }
  } catch {
    return { ...state, status: 'unavailable', captured: false, message: 'No se pudo guardar la fotografía semanal; el historial anterior se conservó.' }
  }
}

export interface FinanceForecastEventChange {
  id: string
  type: 'added' | 'removed' | 'changed' | 'realized'
  label: string
  before?: FinanceDecisionEvent
  after?: FinanceDecisionEvent
}
function reconstructedOperationalBalance(data: FinanceData, date: string) {
  const transactions = data.transactions.filter(item => item.status === 'completed' && item.transactionDate <= date)
  const datedData = { ...data, transactions, debtPlan: data.debtPlan ? { ...data.debtPlan, entries: data.debtPlan.entries.filter(entry => entry.entryDate <= date) } : undefined }
  return data.accounts.filter(account => account.isActive).reduce((sum, account) => {
    const savings = transactions.filter(item => item.accountId === account.id && item.type === 'saving').reduce((total, item) => total + item.amountCents, 0)
    return sum + accountBalance(account, transactions) - savings - debtPlanBalanceCents(datedData, account.id)
  }, 0)
}

/** Changes between forecasts are separate from reconstructed closed-day ledger comparisons. */
export function compareFinanceForecastSnapshot(snapshot: FinanceForecastJournalEntry, report: FinanceDecisionReport, realData?: FinanceData) {
  const overlapEnd = snapshot.horizonEnd < report.horizonEnd ? snapshot.horizonEnd : report.horizonEnd
  const inOverlap = (event: FinanceDecisionEvent) => event.date >= report.referenceDate && event.date <= overlapEnd
  const oldEvents = new Map(snapshot.events.filter(event => event.evidence !== 'actual').map(event => [event.id, event]))
  const currentEvents = new Map(report.scenarios.base.events.map(event => [event.id, event]))
  const changes: FinanceForecastEventChange[] = []
  if (snapshot.projectionVersion === FINANCE_LIQUIDITY_PROJECTION_VERSION) {
    for (const [id, before] of oldEvents) {
      const after = currentEvents.get(id)
      if (!inOverlap(before) && (!after || !inOverlap(after))) continue
      if (!after) changes.push({ id, label: before.label, type: 'removed', before })
      else if (after.evidence === 'actual') changes.push({ id, label: after.label, type: 'realized', before, after })
      else if (after.date !== before.date || after.amountCents !== before.amountCents || after.label !== before.label) changes.push({ id, label: after.label, type: 'changed', before, after })
    }
    for (const [id, after] of currentEvents) if (!oldEvents.has(id) && after.evidence !== 'actual' && inOverlap(after)) changes.push({ id, label: after.label, type: 'added', after })
  }
  const oldDays = new Map(snapshot.days.map(day => [day.date, day.balanceCents]))
  const balanceComparisons = snapshot.projectionVersion === FINANCE_LIQUIDITY_PROJECTION_VERSION
    ? report.scenarios.base.days.filter(day => oldDays.has(day.date)).map(day => ({ date: day.date, previousCents: oldDays.get(day.date)!, currentCents: day.balanceCents, differenceCents: day.balanceCents - oldDays.get(day.date)! })) : []
  const realizedComparisons = realData && snapshot.projectionVersion === FINANCE_LIQUIDITY_PROJECTION_VERSION
    ? snapshot.days.filter(day => day.date < report.referenceDate).map(day => {
      const reconstructedCents = reconstructedOperationalBalance(realData, day.date)
      return { date: day.date, projectedCents: day.balanceCents, reconstructedCents, differenceCents: reconstructedCents - day.balanceCents }
    }) : []
  return {
    changes, balanceComparisons, realizedComparisons,
    unverifiedPastEvents: snapshot.events.filter(event => event.evidence !== 'actual' && event.date < report.referenceDate).length,
    explanation: snapshot.projectionVersion !== FINANCE_LIQUIDITY_PROJECTION_VERSION
      ? 'Esta fotografía usa otra fórmula; no se atribuyen cambios ni errores entre versiones.'
      : 'Los cambios futuros comparan dos planes. Los días cerrados se reconstruyen con las cuentas activas y registros actuales, descontando ahorro y Plan por fecha; las reservas de presupuesto, correcciones históricas o cambios de cuentas pueden explicar diferencias. Una desaparición no demuestra un pago; no se asignan causas ni una precisión certificada.',
  }
}
