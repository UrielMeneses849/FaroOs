import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'

const MUTATIONS = new Set(['createTask', 'updateTaskStatus', 'createExpense', 'createIncome', 'updateFinanceTransactionStatus'])
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
  tool('searchFinanceTransactions', 'Busca movimientos financieros.', {
    query: optionalString(), startDate: optionalString(), endDate: optionalString(),
    type: { type: ['string', 'null'], enum: ['income', 'expense', 'transfer', 'saving', 'debt_payment', 'refund', null] },
    status: { type: ['string', 'null'], enum: [...financeStatuses, null] },
  }),
  tool('getFinanceSummary', 'Resumen financiero por periodo.', { startDate: optionalString(), endDate: optionalString() }),
]

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

    const requestId = String(body.requestId ?? crypto.randomUUID())
    const message = String(body.message ?? '').trim()
    if (!message) return json({ status: 'error', message: 'Escribe o di una solicitud.', questions: [] }, 400)
    const context = await loadContext(db, user.id)
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) return json({ status: 'error', message: 'FARO Voice aún no tiene configurada la clave de OpenAI en Supabase.', questions: [] }, 503)
    const ai = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5-mini',
        instructions: systemPrompt(context),
        input: message,
        tools: toolSchemas,
        tool_choice: 'auto',
      }),
    })
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
      const summary = confirmationSummary(call.name, args, context)
      const pendingAction = { requestId, toolName: call.name, arguments: args, summary }
      await insertLog(db, user.id, requestId, body.source, message, { status: 'pending_confirmation', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, confirmation_required: true, confirmation_status: 'pending' })
      return json({ status: 'pending_confirmation', message: 'Revisa los datos antes de guardar.', questions: [], pendingAction, qa: { intent: call.name, entities: args, toolName: call.name, toolArguments: args } })
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
  return { amount: { type: 'number', exclusiveMinimum: 0, description: 'Importe en MXN, no centavos' }, description: string(), date: string('YYYY-MM-DD'), accountId: string(), categoryId: string(), status: { type: 'string', enum: financeStatuses, default: kind === 'expense' ? 'completed' : 'completed' }, notes: optionalString() }
}
function systemPrompt(context: unknown) {
  return `Eres FARO, asistente operativo en español de México. Usa herramientas para leer o actuar. Nunca inventes UUIDs. Usa únicamente IDs del contexto. Si faltan datos obligatorios, pregunta como máximo 3 cosas y no llames herramientas. Para "hoy" usa ${new Date().toISOString().slice(0, 10)}. Toda escritura será confirmada por la interfaz. Contexto real: ${JSON.stringify(context)}`
}
async function loadContext(db: ReturnType<typeof createClient>, userId: string) {
  const [workspaces, accounts, categories] = await Promise.all([
    db.from('workspaces').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_accounts').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_categories').select('id,name,type').eq('user_id', userId).eq('is_active', true),
  ])
  return { workspaces: workspaces.data ?? [], accounts: accounts.data ?? [], categories: categories.data ?? [] }
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
function confirmationSummary(name: string, args: Record<string, unknown>, context: { workspaces?: Array<{ id: string; name: string }>; accounts?: Array<{ id: string; name: string }>; categories?: Array<{ id: string; name: string }> }) {
  const label = (items: Array<{ id: string; name: string }> | undefined, id: unknown) => items?.find((item) => item.id === id)?.name ?? String(id ?? 'sin definir')
  if (name === 'createTask') return `Crear “${args.title}” en ${label(context.workspaces, args.workspaceId)}${args.dueDate ? ` para ${args.dueDate}` : ''}.`
  if (name === 'createExpense' || name === 'createIncome') return `${name === 'createExpense' ? 'Gasto' : 'Ingreso'} de $${Number(args.amount).toLocaleString('es-MX')} en ${label(context.accounts, args.accountId)}, categoría ${label(context.categories, args.categoryId)}, fecha ${args.date}.`
  return `${name}: ${JSON.stringify(args)}`
}
function successMessage(name: string) { return name === 'createTask' ? 'Tarea creada correctamente.' : name === 'createExpense' ? 'Gasto registrado correctamente.' : name === 'createIncome' ? 'Ingreso registrado correctamente.' : 'Cambio guardado correctamente.' }
function readResultMessage(name: string, result: unknown) { return name === 'getDailySummary' ? 'Aquí tienes tu resumen de hoy.' : name === 'getFinanceSummary' ? 'Aquí tienes tu resumen financiero.' : `Encontré ${Array.isArray(result) ? result.length : 1} resultado(s).` }
function extractQuestions(text: string) { return text.split(/\n+/).map((x) => x.trim()).filter((x) => x.endsWith('?')) }
async function insertLog(db: ReturnType<typeof createClient>, userId: string, requestId: string, source: string, transcript: string, values: Record<string, unknown>) {
  const { error } = await db.from('voice_action_logs').insert({ user_id: userId, request_id: requestId, source, transcript, ...values })
  if (error) throw error
}
async function updateLog(db: ReturnType<typeof createClient>, userId: string, requestId: string, values: Record<string, unknown>) {
  const { error } = await db.from('voice_action_logs').update(values).eq('user_id', userId).eq('request_id', requestId)
  if (error) throw error
}
