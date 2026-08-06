import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { matchFinanceCandidates, type FinanceCandidate } from '../_shared/financeMatch.ts'
import { buildFaroSystemPrompt, type FaroSurface } from '../_shared/faroSystemPrompt.ts'

const MUTATIONS = new Set(['createTask', 'updateTaskStatus', 'createExpense', 'createIncome', 'updateFinanceTransactionStatus', 'completePlannedTransaction', 'updateRecurringAmount', 'createRecurringExpense', 'registerRecurringPayment'])
const statuses = ['inbox', 'todo', 'doing', 'paused', 'blocked', 'done']
const financeStatuses = ['planned', 'pending', 'completed', 'cancelled']
const toolSchemas = [
  tool('getDailySummary', 'Resumen de hoy.', {}),
  tool('listTodayTasks', 'Lista tareas vencidas o de hoy.', { workspaceId: optionalString() }),
  tool('createTask', 'Crea una tarea.', {
    title: string('Título'), workspaceId: string('UUID del workspace'),
    dueDate: optionalString(), priority: enumValue(['low', 'medium', 'high', 'critical']),
    estimatedMinutes: optionalNumber(), projectId: optionalString(), goalId: optionalString(),
  }, ['title', 'workspaceId', 'priority']),
  tool('updateTaskStatus', 'Actualiza el estado de una tarea.', {
    taskId: string('UUID de tarea'), status: enumValue(statuses),
  }, ['taskId', 'status']),
  tool('createExpense', 'Registra un gasto.', financeCreateProperties('expense'), ['amount', 'description', 'date', 'accountId', 'categoryId']),
  tool('createIncome', 'Registra un ingreso.', financeCreateProperties('income'), ['amount', 'description', 'date', 'accountId', 'categoryId']),
  tool('updateFinanceTransactionStatus', 'Actualiza el estado de un movimiento.', {
    transactionId: string('UUID del movimiento'), status: enumValue(financeStatuses),
  }, ['transactionId', 'status']),
  tool('completePlannedTransaction', 'Completa un eventual existente usando el importe real del pago o cobro.', { transactionId: string('UUID del eventual'), actualAmount: optionalNumber() }),
  tool('updateRecurringAmount', 'Cambia el importe base de una recurrencia para periodos futuros.', { recurringId: string('UUID del recurrente'), amount: { type: 'number', exclusiveMinimum: 0 } }),
  tool('searchFinanceTransactions', 'Busca movimientos financieros.', {
    query: optionalString(), startDate: optionalString(), endDate: optionalString(),
    type: { type: ['string', 'null'], enum: ['income', 'expense', 'transfer', 'saving', 'debt_payment', 'refund', null] },
    status: { type: ['string', 'null'], enum: [...financeStatuses, null] },
  }),
  tool('getFinanceSummary', 'Resumen financiero por periodo.', { startDate: optionalString(), endDate: optionalString() }),
  tool('listRecurringExpenses', 'Lista gastos recurrentes y el estado de su ocurrencia actual.', { query: optionalString(), activeOnly: { type: ['boolean', 'null'] } }),
  tool('createRecurringExpense', 'Crea una programación de gasto recurrente y su primera ocurrencia.', {
    description: string(), amount: { type: 'number', exclusiveMinimum: 0 }, accountId: string(), categoryId: string(),
    frequency: enumValue(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']), startDate: string('YYYY-MM-DD'),
    firstExpectedDate: string('YYYY-MM-DD'), dayOfMonth: optionalNumber(), endDate: optionalString(),
  }),
  tool('registerRecurringPayment', 'Registra como pagada la ocurrencia indicada y crea su movimiento financiero.', {
    recurringId: string('UUID del recurrente'), period: string('Primer día del mes, YYYY-MM-01'), expectedDate: string('YYYY-MM-DD'), actualAmount: optionalNumber(),
  }),
]
const productToolNames = new Set(['createExpense', 'createIncome', 'updateFinanceTransactionStatus', 'completePlannedTransaction', 'updateRecurringAmount', 'searchFinanceTransactions', 'getFinanceSummary', 'listRecurringExpenses', 'createRecurringExpense', 'registerRecurringPayment'])

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const auth = request.headers.get('Authorization') ?? ''
    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const db = createClient(url, anon, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await db.auth.getUser()
    if (!user) return json({ status: 'error', message: 'Tu sesión expiró.', questions: [] }, 401)
    const body = await request.json()
    if (body.type === 'health') {
      const openaiKey = Deno.env.get('OPENAI_API_KEY')
      const model = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5-mini'
      if (!openaiKey) return json({ status: 'error', message: 'OPENAI_API_KEY no está configurada en Supabase.', questions: [], result: { configured: false, valid: false, model } })
      const check = await fetch(`https://api.openai.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${openaiKey}` } })
      if (!check.ok) return json({ status: 'error', message: `OpenAI rechazó la conexión (${check.status}). Revisa la clave, el proyecto y el modelo.`, questions: [], result: { configured: true, valid: false, model } })
      return json({ status: 'completed', message: `Conexión verificada. FARO puede usar ${model}.`, questions: [], result: { configured: true, valid: true, model } })
    }
    if (body.type === 'confirm' || body.type === 'cancel') {
      const action = body.action
      if (!action?.requestId || !action?.toolName || !MUTATIONS.has(action.toolName)) return json({ status: 'error', message: 'La acción no es válida.', questions: [] }, 400)
      if (body.type === 'cancel') {
        await updateLog(db, user.id, action.requestId, { status: 'completed', confirmation_status: 'cancelled', completed_at: new Date().toISOString(), result: { cancelled: true } })
        return json({ status: 'completed', message: 'Acción cancelada. No se modificó ningún dato.', questions: [], result: { cancelled: true } })
      }
      const { data: lock, error: lockError } = await db.from('voice_action_logs')
        .update({ confirmation_status: 'confirmed' })
        .eq('user_id', user.id).eq('request_id', action.requestId)
        .eq('confirmation_status', 'pending').select('id').maybeSingle()
      if (lockError) throw lockError
      if (!lock) return json({ status: 'error', message: 'Esta acción ya fue resuelta; no se ejecutó de nuevo.', questions: [] }, 409)
      const result = await executeTool(db, user.id, action.toolName, action.arguments)
      await updateLog(db, user.id, action.requestId, { status: 'completed', completed_at: new Date().toISOString(), result })
      return json({ status: 'completed', message: successMessage(action.toolName), questions: [], result, qa: { intent: action.toolName, entities: action.arguments, toolName: action.toolName, toolArguments: action.arguments } })
    }

    const requestStartedAt = performance.now()
    const requestId = String(body.requestId ?? crypto.randomUUID())
    const message = String(body.message ?? '').trim()
    const surface: FaroSurface = ['dashboard', 'today', 'finances', 'lab'].includes(body.surface) ? body.surface : 'lab'
    if (!message) return json({ status: 'error', message: 'Escribe o di una solicitud.', questions: [] }, 400)
    const contextStartedAt = performance.now()
    const context = await loadContext(db, user.id)
    const contextMs = performance.now() - contextStartedAt
    const completionText = [...normalizeHistory(body.history).filter((turn) => turn.role === 'user').map((turn) => turn.content), message].join(' ')
    const matchingStartedAt = performance.now()
    const existing = resolveExistingFinancial(completionText, context)
    const matchingMs = performance.now() - matchingStartedAt
    if (existing?.kind === 'clarify') {
      diagnostic({ surface, contextMs, matchingMs, totalMs: performance.now() - requestStartedAt, route: 'deterministic_clarification' })
      await insertLog(db, user.id, requestId, body.source, message, { status: 'needs_clarification', questions: [existing.message], result: { answer: existing.message } })
      return json({ status: 'needs_clarification', message: existing.message, questions: [existing.message], qa: { intent: 'matchExistingFinance', entities: { matches: existing.ids } } })
    }
    if (existing?.kind === 'action') {
      diagnostic({ surface, contextMs, matchingMs, totalMs: performance.now() - requestStartedAt, route: 'deterministic_action' })
      const pendingAction = { requestId, toolName: existing.toolName, arguments: existing.arguments, summary: existing.summary }
      await insertLog(db, user.id, requestId, body.source, message, { status: 'pending_confirmation', parsed_intent: existing.toolName, entities: existing.arguments, tool_name: existing.toolName, tool_arguments: existing.arguments, confirmation_required: true, confirmation_status: 'pending' })
      return json({ status: 'pending_confirmation', message: existing.prompt, questions: [], pendingAction, qa: { intent: existing.toolName, entities: existing.arguments, toolName: existing.toolName, toolArguments: existing.arguments } })
    }
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) return json({ status: 'error', message: 'FARO Voice aún no tiene configurada la clave de OpenAI en Supabase.', questions: [] }, 503)
    const availableToolSchemas = surface === 'lab' ? toolSchemas : toolSchemas.filter((candidate) => productToolNames.has(candidate.name))
    const aiStartedAt = performance.now()
    const ai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5-mini',
        instructions: buildFaroSystemPrompt({ surface, financialContext: contextForSurface(context, surface), availableTools: availableToolSchemas.map((candidate) => candidate.name), today: localToday() }),
        input: [
          ...normalizeHistory(body.history),
          { role: 'user', content: message },
        ],
        tools: availableToolSchemas,
        tool_choice: financialToolChoice(message, context) ?? 'auto',
      }),
    })
    const aiMs = performance.now() - aiStartedAt
    diagnostic({ surface, contextMs, matchingMs, aiMs, totalMs: performance.now() - requestStartedAt, route: 'openai' })
    if (!ai.ok) throw new Error(`OpenAI respondió ${ai.status}: ${await ai.text()}`)
    const response = await ai.json()
    const call = response.output?.find((item: { type: string }) => item.type === 'function_call')
    if (!call) {
      const answer = response.output_text || response.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text).filter(Boolean).join(' ') || 'Necesito un poco más de información.'
      const questions = extractQuestions(answer).slice(0, 3)
      await insertLog(db, user.id, requestId, body.source, message, { status: questions.length ? 'needs_clarification' : 'completed', questions, result: { answer } })
      return json({ status: questions.length ? 'needs_clarification' : 'completed', message: answer, questions, qa: { intent: 'conversation', entities: {} } })
    }
    const args = JSON.parse(call.arguments || '{}')
    if (MUTATIONS.has(call.name)) {
      if (call.name === 'registerRecurringPayment') {
        const recurring = context.recurring.find((item: { id: string }) => item.id === args.recurringId)
        const occurrence = context.recurringOccurrences.find((item: { recurring_transaction_id: string; period: string }) =>
          item.recurring_transaction_id === args.recurringId && item.period === args.period)
        const recurringName = recurring?.description ?? 'Este gasto recurrente'
        if (occurrence?.status === 'paid' || occurrence?.transaction_id) {
          const result = { alreadyPaid: true, recurringId: args.recurringId, period: args.period, transactionId: occurrence.transaction_id }
          await insertLog(db, user.id, requestId, body.source, message, { status: 'completed', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, result, completed_at: new Date().toISOString() })
          return json({ status: 'completed', message: `${recurringName} ya está pagado este periodo.`, questions: [], result, qa: { intent: call.name, entities: args, toolName: call.name, toolArguments: args } })
        }
        if (!occurrence) {
          const answer = `No encontré un pago pendiente de ${recurringName} para este periodo.`
          await insertLog(db, user.id, requestId, body.source, message, { status: 'needs_clarification', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, questions: [], result: { answer } })
          return json({ status: 'needs_clarification', message: answer, questions: [], qa: { intent: call.name, entities: args, toolName: call.name, toolArguments: args } })
        }
      }
      const possibleDuplicate = call.name === 'createExpense' || call.name === 'createIncome'
        ? await findPotentialDuplicate(db, user.id, call.name, args)
        : undefined
      const summary = confirmationSummary(call.name, args, context)
      const pendingAction = { requestId, toolName: call.name, arguments: args, summary, ...(possibleDuplicate ? { possibleDuplicate } : {}) }
      await insertLog(db, user.id, requestId, body.source, message, { status: 'pending_confirmation', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, confirmation_required: true, confirmation_status: 'pending' })
      return json({ status: 'pending_confirmation', message: confirmationPrompt(call.name, args, context, Boolean(possibleDuplicate)), questions: [], pendingAction, qa: { intent: call.name, entities: args, toolName: call.name, toolArguments: args } })
    }
    const result = await executeTool(db, user.id, call.name, args)
    await insertLog(db, user.id, requestId, body.source, message, { status: 'completed', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, result, completed_at: new Date().toISOString() })
    return json({ status: 'completed', message: readResultMessage(call.name, result), questions: [], result, qa: { intent: call.name, entities: args, toolName: call.name, toolArguments: args } })
  } catch (error) {
    return json({ status: 'error', message: error instanceof Error ? error.message : 'FARO no pudo procesar la solicitud.', questions: [] }, 500)
  }
})

function tool(name: string, description: string, properties: Record<string, unknown>, _required: string[] = []) {
  // OpenAI strict mode requires every declared property in `required`.
  // Optional values remain optional semantically by accepting null.
  return { type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } }
}
function string(description?: string) { return { type: 'string', ...(description ? { description } : {}) } }
function optionalString() { return { type: ['string', 'null'] } }
function optionalNumber() { return { type: ['number', 'null'] } }
function enumValue(values: string[]) { return { type: 'string', enum: values } }
function financeCreateProperties(kind: string) {
  return { amount: { type: 'number', exclusiveMinimum: 0, description: 'Importe en MXN. Acepta enteros y decimales, por ejemplo 86.64.' }, description: string(), date: string('YYYY-MM-DD'), accountId: string(), categoryId: string(), status: { type: 'string', enum: financeStatuses, default: kind === 'expense' ? 'completed' : 'completed' }, notes: optionalString() }
}
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function diagnostic(values: Record<string, string | number>) {
  if (Deno.env.get('FARO_DIAGNOSTICS') !== 'true') return
  console.info({ scope: 'faro-voice', ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value) : value])) })
}
function contextForSurface(context: FinanceContext, surface: FaroSurface) {
  const limit = surface === 'finances' || surface === 'lab' ? 75 : surface === 'today' ? 30 : 20
  return {
    accounts: context.accounts.slice(0, 20),
    categories: context.categories.slice(0, 40),
    recurring: context.recurring.slice(0, limit),
    recurringOccurrences: context.recurringOccurrences.slice(0, limit),
    plannedTransactions: context.plannedTransactions.slice(0, limit),
    recentTransactions: context.recentTransactions.slice(0, surface === 'today' ? 10 : limit),
    budgets: (surface === 'finances' || surface === 'dashboard' ? context.budgets : []).slice(0, 20),
    currentPeriod: context.currentPeriod,
  }
}
function normalizeHistory(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(-6).flatMap((turn) => {
    if (!turn || typeof turn !== 'object') return []
    const role = (turn as { role?: unknown }).role
    const content = (turn as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return []
    return [{ role, content: content.trim().slice(0, 2000) }]
  })
}
async function loadContext(db: ReturnType<typeof createClient>, userId: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const period = `${today.slice(0, 7)}-01`
  const [workspaces, accounts, categories, recurring, recurringOccurrences, plannedTransactions, recentTransactions, budgets] = await Promise.all([
    db.from('workspaces').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_accounts').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_categories').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_recurring_transactions').select('id,description,type,amount,frequency,next_occurrence,day_of_month,is_active,account_id,category_id').eq('user_id', userId),
    db.from('finance_recurring_occurrences').select('id,recurring_transaction_id,period,expected_date,amount,status,transaction_id').eq('user_id', userId).eq('period', period),
    db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date').eq('user_id', userId).in('status', ['planned', 'pending']),
    db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date').eq('user_id', userId).order('transaction_date', { ascending: false }).limit(20),
    db.from('finance_budgets').select('id,name,category_id,planned_amount,period_start,period_end').eq('user_id', userId).lte('period_start', today).gte('period_end', today).limit(20),
  ])
  return { workspaces: workspaces.data ?? [], accounts: accounts.data ?? [], categories: categories.data ?? [], recurring: recurring.data ?? [], recurringOccurrences: recurringOccurrences.data ?? [], plannedTransactions: plannedTransactions.data ?? [], recentTransactions: recentTransactions.data ?? [], budgets: budgets.data ?? [], currentPeriod: period }
}
type FinanceContext = Awaited<ReturnType<typeof loadContext>>
function resolveExistingFinancial(message: string, context: FinanceContext) {
  const normalized = foldText(message)
  const permanent = /\b(a partir de ahora|desde ahora|proximo mes|siguientes periodos)\b/.test(normalized)
  const completed = /\b(pague|acabo de pagar|acabo de poner|acaban de pagarme|gaste|compre|liquide|me cobraron|me cayo|recibi|cobre|me depositaron|marca como cobrado|cobra)\b/.test(normalized)
  if ((!completed && !permanent) || /\b(pagare|voy a pagar|tengo que pagar|me van a cobrar|me pagaran|voy a cobrar)\b/.test(normalized)) return null
  const accounts = new Map(context.accounts.map((x) => [x.id, x.name])); const categories = new Map(context.categories.map((x) => [x.id, x.name])); const candidates: FinanceCandidate[] = []
  for (const item of context.recurring) { const occurrence = context.recurringOccurrences.find((x) => x.recurring_transaction_id === item.id); if (!item.is_active || (!permanent && (occurrence?.status === 'paid' || occurrence?.transaction_id))) continue; candidates.push({ id: item.id, description: item.description, kind: 'recurring', type: item.type === 'income' ? 'income' : 'expense', amount: Number(permanent ? item.amount : occurrence?.amount ?? item.amount), status: occurrence?.status ?? 'pending', accountName: accounts.get(item.account_id), categoryName: categories.get(item.category_id), period: context.currentPeriod, expectedDate: occurrence?.expected_date ?? item.next_occurrence }) }
  for (const item of context.plannedTransactions) candidates.push({ id: item.id, description: item.description, kind: 'transaction', type: item.type === 'income' ? 'income' : 'expense', amount: Number(item.amount), status: item.status, accountName: accounts.get(item.account_id), categoryName: categories.get(item.category_id) })
  const income = /\b(sueldo|quincena|me cayo|recibi|cobre|depositaron|pagaron)\b/.test(normalized); const matches = matchFinanceCandidates(message, candidates.filter((x) => x.type === (income ? 'income' : 'expense')))
  if (!matches.length) return null
  if (matches.length > 1 && matches[0].score - matches[1].score < .25) { const options = matches.slice(0, 3).map((x, i) => `${i + 1}. ${x.candidate.description}, $${x.candidate.amount.toLocaleString('es-MX')}`).join('\n'); return { kind: 'clarify' as const, message: `Encontré varias coincidencias:\n${options}\n¿Cuál corresponde?`, ids: matches.slice(0, 3).map((x) => x.candidate.id) } }
  const found = matches[0].candidate; const amounts = [...normalized.replace(/,/g, '').matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => Number(match[0])); const actualAmount = amounts.at(-1); const real = Number.isFinite(actualAmount) ? actualAmount! : found.amount; const verb = found.type === 'income' ? 'cobro' : 'pago'
  if (permanent && found.kind === 'recurring' && Number.isFinite(actualAmount)) return { kind: 'action' as const, toolName: 'updateRecurringAmount', arguments: { recurringId: found.id, amount: real }, summary: `Cambiar ${found.description} a $${real.toLocaleString('es-MX')} para periodos futuros.`, prompt: `¿Cambio el importe base de “${found.description}” a $${real.toLocaleString('es-MX')} para los siguientes periodos?` }
  const toolName = found.kind === 'recurring' ? 'registerRecurringPayment' : 'completePlannedTransaction'; const args = found.kind === 'recurring' ? { recurringId: found.id, period: found.period, expectedDate: found.expectedDate, actualAmount: real } : { transactionId: found.id, actualAmount: real }
  const variation = real !== found.amount ? `, planeado por $${found.amount.toLocaleString('es-MX')}. Registraré $${real.toLocaleString('es-MX')} solo para este periodo` : ` por $${real.toLocaleString('es-MX')}`
  return { kind: 'action' as const, toolName, arguments: args, summary: `Registrar el ${verb} de ${found.description} por $${real.toLocaleString('es-MX')}.`, prompt: `Encontré “${found.description}”${variation}. ¿Confirmas?` }
}
function financialToolChoice(message: string, context: { accounts?: Array<{ name: string }>; recurring?: Array<{ id: string; description: string; type: string }> }) {
  const normalized = foldText(message)
  const namedRecurring = (context.recurring ?? []).find((item) => {
    if (item.type === 'income') return false
    const description = foldText(item.description)
    const meaningfulWords = description.split(/\s+/).filter((word) => word.length >= 4)
    return normalized.includes(description) || meaningfulWords.some((word) => new RegExp(`\\b${escapeRegex(word)}\\b`).test(normalized))
  })
  if (namedRecurring && /\b(registra|registre|marca|marque)\b/.test(normalized) && /\b(pago|pagado|pague)\b/.test(normalized)) {
    return { type: 'function', name: 'registerRecurringPayment' }
  }
  const hasAmount = /(?:\$\s*)?\d[\d,.]*/.test(normalized)
  const hasKnownAccount = (context.accounts ?? []).length === 1 || (context.accounts ?? []).some((account) => {
    const name = foldText(account.name)
    const firstWord = name.split(/\s+/)[0]
    return normalized.includes(name) || (firstWord.length >= 2 && new RegExp(`\\b${escapeRegex(firstWord)}\\b`, 'i').test(normalized))
  })
  if (hasAmount && hasKnownAccount && /\b(recurrente|semanal|quincenal|mensual|trimestral|anual|cada semana|cada quincena|cada mes|cada ano)\b/.test(normalized)) {
    return { type: 'function', name: 'createRecurringExpense' }
  }
  if (!hasAmount || !hasKnownAccount) return null
  if (/\b(pague|gaste|compre|liquide)\b/.test(normalized)) return { type: 'function', name: 'createExpense' }
  if (/\b(me pagaron|cobre|recibi)\b/.test(normalized)) return { type: 'function', name: 'createIncome' }
  return null
}
function foldText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX') }
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
async function findPotentialDuplicate(db: ReturnType<typeof createClient>, userId: string, toolName: string, args: Record<string, unknown>) {
  if (!args.accountId || !args.date || !Number.isFinite(Number(args.amount))) return undefined
  const type = toolName === 'createExpense' ? 'expense' : 'income'
  const { data, error } = await db.from('finance_transactions')
    .select('id,description,amount,transaction_date')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('account_id', String(args.accountId))
    .eq('transaction_date', String(args.date))
    .eq('amount', Number(args.amount))
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const match = data?.[0]
  return match ? { id: match.id, description: match.description, amount: Number(match.amount), date: match.transaction_date } : undefined
}
async function executeTool(db: ReturnType<typeof createClient>, userId: string, name: string, args: Record<string, unknown>) {
  const today = new Date().toISOString().slice(0, 10)
  if (name === 'listTodayTasks' || name === 'getDailySummary') {
    let query = db.from('tasks').select('id,title,status,priority,due_at,estimated_minutes,workspace_id').eq('user_id', userId).is('archived_at', null).lte('due_at', `${today}T23:59:59.999`)
    if (args.workspaceId) query = query.eq('workspace_id', String(args.workspaceId))
    const { data, error } = await query.order('due_at')
    if (error) throw error
    if (name === 'listTodayTasks') return data
    return { date: today, total: data.length, completed: data.filter((x) => x.status === 'done').length, estimatedMinutes: data.reduce((sum, x) => sum + (x.estimated_minutes ?? 0), 0), tasks: data.slice(0, 5) }
  }
  if (name === 'createTask') {
    if (!args.title || !args.workspaceId) throw new Error('Faltan título o workspace.')
    const { data, error } = await db.from('tasks').insert({ user_id: userId, title: String(args.title), workspace_id: String(args.workspaceId), area: 'personal', status: 'todo', priority: String(args.priority ?? 'medium'), due_at: args.dueDate ? String(args.dueDate) : null, estimated_minutes: args.estimatedMinutes ? Number(args.estimatedMinutes) : null, project_id: args.projectId || null, goal_id: args.goalId || null }).select().single()
    if (error) throw error; return data
  }
  if (name === 'updateTaskStatus') {
    if (!statuses.includes(String(args.status))) throw new Error('Estado de tarea inválido.')
    const { data, error } = await db.from('tasks').update({ status: args.status, completed_at: args.status === 'done' ? new Date().toISOString() : null }).eq('id', args.taskId).eq('user_id', userId).select().single()
    if (error) throw error; return data
  }
  if (name === 'createExpense' || name === 'createIncome') {
    const type = name === 'createExpense' ? 'expense' : 'income'
    const { data, error } = await db.from('finance_transactions').insert({ user_id: userId, account_id: args.accountId, category_id: args.categoryId, type, amount: Number(args.amount), transaction_date: args.date, description: args.description, status: args.status ?? 'completed', notes: args.notes ?? null }).select().single()
    if (error) throw error; return data
  }
  if (name === 'listRecurringExpenses') {
    let query = db.from('finance_recurring_transactions').select('id,description,amount,frequency,next_occurrence,is_active,account_id,category_id').eq('user_id', userId).neq('type', 'income')
    if (args.activeOnly) query = query.eq('is_active', true)
    if (args.query) query = query.ilike('description', `%${String(args.query).replace(/[%_]/g, '')}%`)
    const { data, error } = await query.order('next_occurrence')
    if (error) throw error
    const localToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const period = `${localToday.slice(0, 7)}-01`
    const recurringIds = (data ?? []).map((item) => item.id)
    if (!recurringIds.length) return []
    const { data: occurrences, error: occurrencesError } = await db.from('finance_recurring_occurrences')
      .select('id,recurring_transaction_id,period,expected_date,amount,status,transaction_id')
      .eq('user_id', userId).eq('period', period).in('recurring_transaction_id', recurringIds)
    if (occurrencesError) throw occurrencesError
    return (data ?? []).map((item) => ({
      ...item,
      currentOccurrence: occurrences?.find((occurrence) => occurrence.recurring_transaction_id === item.id) ?? null,
    }))
  }
  if (name === 'createRecurringExpense') {
    const recurringId = crypto.randomUUID()
    const expectedDate = String(args.firstExpectedDate)
    const period = `${expectedDate.slice(0, 7)}-01`
    const { data: recurring, error } = await db.from('finance_recurring_transactions').insert({
      id: recurringId, user_id: userId, account_id: args.accountId, category_id: args.categoryId, type: 'expense',
      amount: Number(args.amount), description: String(args.description), frequency: args.frequency,
      start_date: args.startDate, next_occurrence: expectedDate, end_date: args.endDate || null,
      day_of_month: args.dayOfMonth || null, is_active: true,
    }).select().single()
    if (error) throw error
    const { data: occurrence, error: occurrenceError } = await db.from('finance_recurring_occurrences').insert({
      user_id: userId, recurring_transaction_id: recurringId, period, expected_date: expectedDate,
      amount: Number(args.amount), status: 'pending',
    }).select().single()
    if (occurrenceError) {
      await db.from('finance_recurring_transactions').delete().eq('id', recurringId).eq('user_id', userId)
      throw occurrenceError
    }
    return { recurring, occurrence }
  }
  if (name === 'registerRecurringPayment') {
    if (Number.isFinite(Number(args.actualAmount))) {
      const { error: amountError } = await db.from('finance_recurring_occurrences').update({ amount: Number(args.actualAmount) }).eq('user_id', userId).eq('recurring_transaction_id', args.recurringId).eq('period', args.period).eq('status', 'pending')
      if (amountError) throw amountError
    }
    const { data, error } = await db.rpc('register_finance_recurring_occurrence', {
      target_recurring_id: args.recurringId,
      target_period: args.period,
      target_expected_date: args.expectedDate,
    })
    if (error) throw error
    return { transactionId: data, recurringId: args.recurringId, period: args.period }
  }
  if (name === 'completePlannedTransaction') {
    const updates: Record<string, unknown> = { status: 'completed' }
    if (Number.isFinite(Number(args.actualAmount))) updates.amount = Number(args.actualAmount)
    const { data, error } = await db.from('finance_transactions').update(updates).eq('id', args.transactionId).eq('user_id', userId).in('status', ['planned', 'pending']).select().single()
    if (error) throw error
    return data
  }
  if (name === 'updateRecurringAmount') {
    const { data, error } = await db.from('finance_recurring_transactions').update({ amount: Number(args.amount) }).eq('id', args.recurringId).eq('user_id', userId).select().single()
    if (error) throw error
    return data
  }
  if (name === 'updateFinanceTransactionStatus') {
    if (!financeStatuses.includes(String(args.status))) throw new Error('Estado financiero inválido.')
    const { data, error } = await db.from('finance_transactions').update({ status: args.status }).eq('id', args.transactionId).eq('user_id', userId).select().single()
    if (error) throw error; return data
  }
  if (name === 'searchFinanceTransactions' || name === 'getFinanceSummary') {
    let query = db.from('finance_transactions').select('id,type,amount,transaction_date,description,status,account_id,category_id').eq('user_id', userId)
    if (args.startDate) query = query.gte('transaction_date', args.startDate)
    if (args.endDate) query = query.lte('transaction_date', args.endDate)
    if (args.type) query = query.eq('type', args.type)
    if (args.status) query = query.eq('status', args.status)
    if (args.query) query = query.ilike('description', `%${String(args.query).replace(/[%_]/g, '')}%`)
    const { data, error } = await query.order('transaction_date', { ascending: false }).limit(name === 'searchFinanceTransactions' ? 50 : 500)
    if (error) throw error
    if (name === 'searchFinanceTransactions') return data
    const completed = data.filter((x) => x.status === 'completed')
    const income = completed.filter((x) => ['income', 'refund'].includes(x.type)).reduce((sum, x) => sum + Number(x.amount), 0)
    const expense = completed.filter((x) => ['expense', 'debt_payment'].includes(x.type)).reduce((sum, x) => sum + Number(x.amount), 0)
    return { income, expense, balance: income - expense, count: completed.length }
  }
  throw new Error(`Herramienta no permitida: ${name}`)
}
function confirmationSummary(name: string, args: Record<string, unknown>, context: { workspaces?: Array<{ id: string; name: string }>; accounts?: Array<{ id: string; name: string }>; categories?: Array<{ id: string; name: string }>; recurring?: Array<{ id: string; description: string }> }) {
  const label = (items: Array<{ id: string; name: string }> | undefined, id: unknown) => items?.find((item) => item.id === id)?.name ?? String(id ?? 'sin definir')
  if (name === 'createTask') return `Crear “${args.title}” en ${label(context.workspaces, args.workspaceId)}${args.dueDate ? ` para ${args.dueDate}` : ''}.`
  if (name === 'createExpense' || name === 'createIncome') return `${name === 'createExpense' ? 'Gasto' : 'Ingreso'} de $${Number(args.amount).toLocaleString('es-MX')} en ${label(context.accounts, args.accountId)}, categoría ${label(context.categories, args.categoryId)}, fecha ${args.date}.`
  if (name === 'createRecurringExpense') return `Crear ${args.description} por $${Number(args.amount).toLocaleString('es-MX')} con frecuencia ${args.frequency}, primer pago ${args.firstExpectedDate}.`
  if (name === 'registerRecurringPayment') return `Registrar el pago de ${label(context.recurring?.map((item) => ({ id: item.id, name: item.description })), args.recurringId)}.`
  return `${name}: ${JSON.stringify(args)}`
}
function confirmationPrompt(name: string, args: Record<string, unknown>, context: { categories?: Array<{ id: string; name: string }>; recurring?: Array<{ id: string; description: string }> }, duplicate: boolean) {
  if (duplicate) return 'Ya existe un movimiento igual. ¿Quieres registrarlo otra vez?'
  if (name === 'createExpense' || name === 'createIncome') {
    const amount = Number(args.amount).toLocaleString('es-MX', { maximumFractionDigits: 2 })
    const category = context.categories?.find((item) => item.id === args.categoryId)?.name ?? 'Sin categoría'
    const kind = name === 'createExpense' ? 'gasto' : 'ingreso'
    const classification = category.toLocaleLowerCase('es-MX') === 'personal' ? `${kind} personal` : `${kind} en ${category}`
    return `¿Registro $${amount} como ${classification}?`
  }
  if (name === 'createRecurringExpense') return `¿Creo ${String(args.description)} como gasto recurrente?`
  if (name === 'registerRecurringPayment') {
    const recurring = context.recurring?.find((item) => item.id === args.recurringId)?.description ?? 'este recurrente'
    return `¿Registro el pago de ${recurring}?`
  }
  return '¿Confirmas este cambio?'
}
function successMessage(name: string) { return name === 'createTask' ? 'Tarea creada correctamente.' : name === 'createExpense' ? 'Gasto registrado correctamente.' : name === 'createIncome' ? 'Ingreso registrado correctamente.' : name === 'createRecurringExpense' ? 'Gasto recurrente creado.' : name === 'registerRecurringPayment' ? 'Pago recurrente registrado.' : 'Cambio guardado correctamente.' }
function readResultMessage(name: string, result: unknown) { return name === 'getDailySummary' ? 'Aquí tienes tu resumen de hoy.' : name === 'getFinanceSummary' ? 'Aquí tienes tu resumen financiero.' : name === 'listRecurringExpenses' ? `Encontré ${Array.isArray(result) ? result.length : 0} gasto(s) recurrente(s).` : `Encontré ${Array.isArray(result) ? result.length : 1} resultado(s).` }
function extractQuestions(text: string) { return text.split(/\n+/).map((x) => x.trim()).filter((x) => x.endsWith('?')) }
async function insertLog(db: ReturnType<typeof createClient>, userId: string, requestId: string, source: string, transcript: string, values: Record<string, unknown>) {
  const { error } = await db.from('voice_action_logs').insert({ user_id: userId, request_id: requestId, source, transcript, ...values })
  if (error) throw error
}
async function updateLog(db: ReturnType<typeof createClient>, userId: string, requestId: string, values: Record<string, unknown>) {
  const { error } = await db.from('voice_action_logs').update(values).eq('user_id', userId).eq('request_id', requestId)
  if (error) throw error
}
