import { createClient } from 'npm:@supabase/supabase-js@2'
import { matchFinanceCandidates, type FinanceCandidate } from '../financeMatch.ts'
import {
  normalizedIncludes,
  normalizeVoiceText,
  routeFinanceIntent,
  type FinanceFastIntent,
} from './financeFastPath.ts'
import type { ServerVoiceTrace } from './trace.ts'

type Db = ReturnType<typeof createClient>
type EntityReference = { id: string; type: 'finance_transaction' | 'finance_recurring'; title: string; subtitle?: string }
type SessionContext = {
  lastResults?: EntityReference[]
  pendingClarification?: { intent?: string; entities?: Record<string, unknown> }
}

export type FastFinanceResolution =
  | { kind: 'read'; intent: FinanceFastIntent; message: string; result: unknown; references?: EntityReference[] }
  | { kind: 'clarify'; intent: FinanceFastIntent; message: string; references?: EntityReference[]; missingFields?: string[]; entities?: Record<string, unknown> }
  | { kind: 'action'; intent: FinanceFastIntent; toolName: string; arguments: Record<string, unknown>; summary: string; prompt: string; possibleDuplicate?: { id: string; description: string; amount: number; date: string } }

type Named = { id: string; name: string; type?: string }
type Transaction = { id: string; description: string; type: string; amount: number | string; status: string; account_id: string; category_id: string; transaction_date: string }

const money = (value: number) => value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const asReferences = (items: Transaction[]): EntityReference[] => items.slice(0, 10).map((item) => ({
  id: item.id,
  type: 'finance_transaction',
  title: item.description,
  subtitle: `${item.transaction_date} · ${money(Number(item.amount))}`,
}))

function nameMatch(message: string, items: Named[]) {
  const exact = items.filter((item) => normalizedIncludes(message, item.name))
  if (exact.length === 1) return exact[0]
  const normalized = normalizeVoiceText(message)
  const tokens = normalized.split(' ')
  const scored = items.map((item) => {
    const words = normalizeVoiceText(item.name).split(' ').filter((word) => word.length > 2)
    return { item, score: words.filter((word) => tokens.includes(word)).length }
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score)
  return scored[0] && (!scored[1] || scored[0].score > scored[1].score) ? scored[0].item : undefined
}

function transactionDescription(message: string, category?: Named, kind: 'expense' | 'income' = 'expense') {
  const normalized = normalizeVoiceText(message)
  const after = normalized.match(/(?:en|de|por)\s+([a-z][a-z0-9 ]{1,50}?)(?:\s+(?:desde|en la cuenta|con|hoy|ayer)|$)/)?.[1]?.trim()
  if (after && !/^\d/.test(after)) return after.replace(/\bpesos?\b/g, '').trim().slice(0, 80)
  return category?.name ?? (kind === 'expense' ? 'Gasto por voz' : 'Ingreso por voz')
}

function updateFields(message: string, categories: Named[], amounts: number[]) {
  const normalized = normalizeVoiceText(message)
  const category = nameMatch(message, categories)
  const fields: Record<string, unknown> = {}
  if (category) fields.categoryId = category.id
  if (amounts.length >= 2) fields.amount = amounts.at(-1)
  const date = /\bhoy\b/.test(normalized) ? localToday() : undefined
  if (date) fields.date = date
  return { fields, category }
}

async function baseContext(db: Db, userId: string, kind: 'expense' | 'income') {
  const [accounts, categories] = await Promise.all([
    db.from('finance_accounts').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_categories').select('id,name,type').eq('user_id', userId).eq('is_active', true).eq('type', kind),
  ])
  if (accounts.error) throw accounts.error
  if (categories.error) throw categories.error
  return { accounts: (accounts.data ?? []) as Named[], categories: (categories.data ?? []) as Named[] }
}

async function createResolution(db: Db, userId: string, message: string, intent: 'create_expense' | 'create_income', amounts: number[], trace: ServerVoiceTrace): Promise<FastFinanceResolution> {
  const kind = intent === 'create_expense' ? 'expense' : 'income'
  const { accounts, categories } = await baseContext(db, userId, kind)
  const amount = amounts[0]
  const { account, category } = trace.measureSync('matching', () => ({
    account: nameMatch(message, accounts) ?? (accounts.length === 1 ? accounts[0] : undefined),
    category: nameMatch(message, categories)
      ?? categories.find((item) => kind === 'income' && /otros ingresos|ingresos/i.test(item.name))
      ?? (categories.length === 1 ? categories[0] : undefined),
  }))
  const entities = { originalMessage: message, amount, accountId: account?.id, categoryId: category?.id, kind }
  if (!amount) return { kind: 'clarify', intent, message: '¿Cuál es el monto?', missingFields: ['amount'], entities }
  if (!account) return { kind: 'clarify', intent, message: `¿En qué cuenta registro el ${kind === 'expense' ? 'gasto' : 'ingreso'}?`, missingFields: ['accountId'], entities }
  if (!category) return { kind: 'clarify', intent, message: `¿En qué categoría registro el ${kind === 'expense' ? 'gasto' : 'ingreso'}?`, missingFields: ['categoryId'], entities }
  const date = /\bayer\b/.test(normalizeVoiceText(message))
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() - 86_400_000))
    : localToday()
  const args = {
    transactionId: crypto.randomUUID(), amount, description: transactionDescription(message, category, kind), date,
    accountId: account.id, categoryId: category.id, status: 'completed', notes: null,
  }
  const { data: duplicates, error } = await db.from('finance_transactions')
    .select('id,description,amount,transaction_date').eq('user_id', userId).eq('type', kind)
    .eq('account_id', account.id).eq('transaction_date', date).eq('amount', amount).neq('status', 'cancelled').limit(1)
  if (error) throw error
  const duplicate = duplicates?.[0]
  const possibleDuplicate = duplicate ? { id: duplicate.id, description: duplicate.description, amount: Number(duplicate.amount), date: duplicate.transaction_date } : undefined
  const label = kind === 'expense' ? 'gasto' : 'ingreso'
  return {
    kind: 'action', intent, toolName: kind === 'expense' ? 'createExpense' : 'createIncome', arguments: args,
    summary: `${kind === 'expense' ? 'Gasto' : 'Ingreso'} de ${money(amount)} en ${account.name}, categoría ${category.name}, fecha ${date}.`,
    prompt: possibleDuplicate ? 'Ya existe un movimiento igual. ¿Quieres registrarlo otra vez?' : `¿Registro ${money(amount)} como ${label} en ${category.name}?`,
    possibleDuplicate,
  }
}

async function candidateTransactions(db: Db, userId: string, message: string, date?: string, amount?: number) {
  let query = db.from('finance_transactions')
    .select('id,description,type,amount,status,account_id,category_id,transaction_date')
    .eq('user_id', userId).neq('status', 'cancelled')
  if (date) query = query.eq('transaction_date', date)
  if (amount) query = query.eq('amount', amount)
  if (/\bgasto\b/.test(normalizeVoiceText(message))) query = query.in('type', ['expense', 'debt_payment'])
  if (/\bingreso\b/.test(normalizeVoiceText(message))) query = query.in('type', ['income', 'refund'])
  const { data, error } = await query.order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(20)
  if (error) throw error
  return (data ?? []) as Transaction[]
}

function chooseFromContext(context: SessionContext | undefined, ordinal: number | undefined) {
  const refs = context?.lastResults ?? []
  const index = ordinal ? ordinal - 1 : 0
  return refs[index]?.type === 'finance_transaction' ? refs[index] : undefined
}

async function resolveTarget(db: Db, userId: string, message: string, date: string | undefined, amount: number | undefined, ordinal: number | undefined, context?: SessionContext) {
  const contextual = chooseFromContext(context, ordinal)
  if (contextual && /\b(ese|eso|lo|el primero|el segundo|el tercero|eliminalo|cambialo)\b/.test(normalizeVoiceText(message))) {
    const { data, error } = await db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date').eq('user_id', userId).eq('id', contextual.id).maybeSingle()
    if (error) throw error
    if (data) return { match: data as Transaction, options: [] as Transaction[] }
  }
  const options = await candidateTransactions(db, userId, message, date, amount)
  if (options.length === 1) return { match: options[0], options }
  const normalized = normalizeVoiceText(message)
  const meaningful = normalized.split(' ').filter((word) => word.length > 3 && !['elimina', 'eliminar', 'cambia', 'cambiar', 'gasto', 'ingreso', 'ayer', 'pesos'].includes(word))
  const narrowed = meaningful.length ? options.filter((item) => meaningful.some((word) => normalizeVoiceText(item.description).includes(word))) : options
  if (narrowed.length === 1) return { match: narrowed[0], options: narrowed }
  if (ordinal && narrowed[ordinal - 1]) return { match: narrowed[ordinal - 1], options: narrowed }
  return { match: undefined, options: narrowed.slice(0, 5) }
}

async function mutationResolution(db: Db, userId: string, message: string, intent: 'delete_transaction' | 'update_transaction', date: string | undefined, amounts: number[], ordinal: number | undefined, context: SessionContext | undefined, trace: ServerVoiceTrace): Promise<FastFinanceResolution> {
  const target = await trace.measure('matching', () => resolveTarget(db, userId, message, date, amounts[0], ordinal, context))
  if (!target.match) {
    const references = asReferences(target.options)
    const options = references.map((item, index) => `${index + 1}. ${item.title} · ${item.subtitle}`).join('\n')
    const messageText = target.options.length ? `Encontré varias coincidencias:\n${options}\n¿Cuál corresponde?` : 'No encontré un movimiento que coincida. ¿Puedes indicar monto, fecha o descripción?'
    return { kind: 'clarify', intent, message: messageText, references, entities: { originalMessage: message } }
  }
  if (intent === 'delete_transaction') return {
    kind: 'action', intent, toolName: 'deleteFinanceTransaction', arguments: { transactionId: target.match.id },
    summary: `Eliminar ${target.match.description} por ${money(Number(target.match.amount))} del ${target.match.transaction_date}.`,
    prompt: `¿Elimino “${target.match.description}” por ${money(Number(target.match.amount))}?`,
  }
  const { data: categories, error } = await db.from('finance_categories').select('id,name,type').eq('user_id', userId).eq('is_active', true)
  if (error) throw error
  const { fields, category } = updateFields(message, (categories ?? []) as Named[], amounts)
  if (!Object.keys(fields).length) return { kind: 'clarify', intent, message: '¿Qué dato quieres cambiar: monto, categoría o fecha?', references: asReferences([target.match]), entities: { transactionId: target.match.id } }
  return {
    kind: 'action', intent, toolName: 'updateFinanceTransaction', arguments: { transactionId: target.match.id, ...fields },
    summary: `Actualizar ${target.match.description}${category ? ` a la categoría ${category.name}` : ''}${fields.amount ? ` por ${money(Number(fields.amount))}` : ''}.`,
    prompt: `¿Confirmas el cambio de “${target.match.description}”?`,
  }
}

async function recurringResolution(db: Db, userId: string, message: string, trace: ServerVoiceTrace): Promise<FastFinanceResolution | null> {
  const today = localToday()
  const period = `${today.slice(0, 7)}-01`
  const [recurring, occurrences, accounts, categories] = await Promise.all([
    db.from('finance_recurring_transactions').select('id,description,type,amount,next_occurrence,is_active,account_id,category_id').eq('user_id', userId).eq('is_active', true),
    db.from('finance_recurring_occurrences').select('recurring_transaction_id,period,expected_date,amount,status,transaction_id').eq('user_id', userId).eq('period', period),
    db.from('finance_accounts').select('id,name').eq('user_id', userId),
    db.from('finance_categories').select('id,name').eq('user_id', userId),
  ])
  for (const response of [recurring, occurrences, accounts, categories]) if (response.error) throw response.error
  const accountNames = new Map((accounts.data ?? []).map((item) => [item.id, item.name]))
  const categoryNames = new Map((categories.data ?? []).map((item) => [item.id, item.name]))
  const candidates: FinanceCandidate[] = (recurring.data ?? []).flatMap((item) => {
    const occurrence = (occurrences.data ?? []).find((candidate) => candidate.recurring_transaction_id === item.id)
    if (occurrence?.status === 'paid' || occurrence?.transaction_id) return []
    return [{ id: item.id, description: item.description, kind: 'recurring' as const, type: item.type === 'income' ? 'income' as const : 'expense' as const, amount: Number(occurrence?.amount ?? item.amount), status: occurrence?.status ?? 'pending', accountName: accountNames.get(item.account_id), categoryName: categoryNames.get(item.category_id), period, expectedDate: occurrence?.expected_date ?? item.next_occurrence }]
  })
  const matches = trace.measureSync('matching', () => {
    const exact = candidates.filter((candidate) => normalizedIncludes(message, candidate.description))
    return exact.length ? exact.map((candidate) => ({ candidate, score: 1 })) : matchFinanceCandidates(message, candidates)
  })
  if (!matches.length) return null
  if (matches[1] && matches[0].score - matches[1].score < .25) {
    const refs: EntityReference[] = matches.slice(0, 3).map((match) => ({ id: match.candidate.id, type: 'finance_recurring', title: match.candidate.description, subtitle: money(match.candidate.amount) }))
    return { kind: 'clarify', intent: 'register_recurring', message: `Encontré varias recurrencias:\n${refs.map((item, index) => `${index + 1}. ${item.title} · ${item.subtitle}`).join('\n')}\n¿Cuál corresponde?`, references: refs }
  }
  const found = matches[0].candidate
  return {
    kind: 'action', intent: 'register_recurring', toolName: 'registerRecurringPayment',
    arguments: { recurringId: found.id, period: found.period, expectedDate: found.expectedDate, actualAmount: found.amount },
    summary: `Registrar el pago de ${found.description} por ${money(found.amount)}.`, prompt: `¿Registro el pago de “${found.description}” por ${money(found.amount)}?`,
  }
}

export async function resolveFastFinance(db: Db, userId: string, rawMessage: string, context: SessionContext | undefined, trace: ServerVoiceTrace): Promise<FastFinanceResolution | null> {
  const prior = context?.pendingClarification
  const message = prior?.entities?.originalMessage ? `${String(prior.entities.originalMessage)} ${rawMessage}` : rawMessage
  const route = trace.measureSync('routing', () => routeFinanceIntent(message))
  const intent = (route.intent === 'unknown' && typeof prior?.intent === 'string' ? prior.intent : route.intent) as FinanceFastIntent
  if (intent === 'unknown') return null

  return trace.measure('context', async () => {
    if (intent === 'create_expense' || intent === 'create_income') return createResolution(db, userId, message, intent, route.entities.amounts, trace)
    if (intent === 'spent_today') {
      const date = route.entities.date ?? localToday()
      const { data, error } = await db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date')
        .eq('user_id', userId).eq('transaction_date', date).eq('status', 'completed').in('type', ['expense', 'debt_payment'])
      if (error) throw error
      const transactions = (data ?? []) as Transaction[]
      const total = transactions.reduce((sum, item) => sum + Number(item.amount), 0)
      return { kind: 'read', intent, message: `Hoy has gastado ${money(total)} en ${transactions.length} movimiento${transactions.length === 1 ? '' : 's'}.`, result: { date, total, count: transactions.length, transactions }, references: asReferences(transactions) }
    }
    if (intent === 'delete_transaction' || intent === 'update_transaction') return mutationResolution(db, userId, message, intent, route.entities.date, route.entities.amounts, route.entities.ordinal, context, trace)
    if (intent === 'register_recurring') return recurringResolution(db, userId, message, trace)
    if (intent === 'search_transactions') {
      const transactions = await candidateTransactions(db, userId, message, route.entities.date, route.entities.amounts[0])
      const refs = asReferences(transactions)
      const description = refs.length ? refs.slice(0, 5).map((item, index) => `${index + 1}. ${item.title} · ${item.subtitle}`).join('\n') : 'No encontré movimientos.'
      return { kind: 'read', intent, message: description, result: transactions, references: refs }
    }
    return null
  })
}
