import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { matchFinanceCandidates, type FinanceCandidate } from '../_shared/financeMatch.ts'
import { buildFaroSystemPrompt, type FaroSurface } from '../_shared/faroSystemPrompt.ts'
import { resolveFastFinance, type FastFinanceResolution } from '../_shared/voice/financialSkill.ts'
import { resolveFastCalendar, type CalendarResolution } from '../_shared/voice/calendarSkill.ts'
import { ServerVoiceTrace } from '../_shared/voice/trace.ts'
import { formatTimeForSpeech } from '../_shared/voice/timeForSpeech.ts'
import { assertFaroCalendarMutation } from '../_shared/voice/calendarAuthorization.ts'
import { addCalendarDays, calendarLocalDate, extractCalendarTimeRange, resolveExplicitCalendarDate, zonedCalendarIso } from '../_shared/voice/calendarDateTime.ts'
import { routeCalendarIntent } from '../_shared/voice/calendarFastPath.ts'

const MUTATIONS = new Set([
  'createExpense', 'createIncome', 'updateFinanceTransactionStatus', 'updateFinanceTransaction',
  'deleteFinanceTransaction', 'completePlannedTransaction', 'updateRecurringAmount',
  'createRecurringExpense', 'registerRecurringPayment',
  'createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'createScheduledTask',
])
const CALENDAR_MUTATIONS = new Set(['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent', 'createScheduledTask'])
const financeStatuses = ['planned', 'pending', 'completed', 'cancelled']
const toolSchemas = [
  tool('createExpense', 'Registra un gasto.', financeCreateProperties(), ['amount', 'description', 'date', 'accountId', 'categoryId']),
  tool('createIncome', 'Registra un ingreso.', financeCreateProperties(), ['amount', 'description', 'date', 'accountId', 'categoryId']),
  tool('updateFinanceTransactionStatus', 'Actualiza el estado de un movimiento.', { transactionId: string(), status: enumValue(financeStatuses) }),
  tool('updateFinanceTransaction', 'Actualiza campos de un movimiento existente.', {
    transactionId: string(), amount: optionalNumber(), categoryId: optionalString(), accountId: optionalString(),
    date: optionalString(), description: optionalString(), status: { type: ['string', 'null'], enum: [...financeStatuses, null] },
  }),
  tool('deleteFinanceTransaction', 'Elimina un movimiento usando la misma regla segura de Finanzas.', { transactionId: string() }),
  tool('getSpentToday', 'Calcula gastos completados del día.', { date: optionalString() }),
  tool('completePlannedTransaction', 'Completa un eventual existente.', { transactionId: string(), actualAmount: optionalNumber() }),
  tool('updateRecurringAmount', 'Cambia el importe base de una recurrencia futura.', { recurringId: string(), amount: { type: 'number', exclusiveMinimum: 0 } }),
  tool('searchFinanceTransactions', 'Busca movimientos financieros.', {
    query: optionalString(), startDate: optionalString(), endDate: optionalString(),
    type: { type: ['string', 'null'], enum: ['income', 'expense', 'transfer', 'saving', 'debt_payment', 'refund', null] },
    status: { type: ['string', 'null'], enum: [...financeStatuses, null] },
  }),
  tool('getFinanceSummary', 'Resumen financiero por periodo.', { startDate: optionalString(), endDate: optionalString() }),
  tool('listRecurringExpenses', 'Lista gastos recurrentes.', { query: optionalString(), activeOnly: { type: ['boolean', 'null'] } }),
  tool('createRecurringExpense', 'Crea una programación de gasto recurrente.', {
    recurringId: optionalString(), description: string(), amount: { type: 'number', exclusiveMinimum: 0 }, accountId: string(), categoryId: string(),
    frequency: enumValue(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']), startDate: string(), firstExpectedDate: string(), dayOfMonth: optionalNumber(), endDate: optionalString(),
  }),
  tool('registerRecurringPayment', 'Registra una ocurrencia recurrente.', { recurringId: string(), period: string(), expectedDate: string(), actualAmount: optionalNumber() }),
  tool('listCalendarItems', 'Lista agenda en un rango.', { start: string(), end: string(), timezone: string() }),
  tool('getNextCommitment', 'Obtiene el siguiente compromiso.', { after: string(), timezone: string() }),
  tool('findCalendarEvent', 'Busca un elemento de calendario.', { query: string(), start: string(), end: string() }),
  tool('findAvailableSlots', 'Encuentra bloques libres.', { start: string(), end: string(), durationMinutes: { type:'number' }, timezone: string() }),
  tool('createCalendarEvent', 'Crea un evento interno de FARO.', { eventId:string(), title:string(), start:string(), end:string(), provider:enumValue(['faro']), timezone:string() }),
  tool('updateCalendarEvent', 'Mueve o renombra un evento o tarea internos de FARO.', { targetId:string(), targetKind:enumValue(['event','task']), provider:enumValue(['faro']), start:string(), end:string(), title:optionalString() }),
  tool('deleteCalendarEvent', 'Elimina un evento o tarea internos de FARO.', { targetId:string(), targetKind:enumValue(['event','task']), provider:enumValue(['faro']) }),
  tool('createScheduledTask', 'Crea una tarea FARO programada.', { taskId:string(), title:string(), start:string(), end:string(), durationMinutes:{type:'number'}, workspaceId:optionalString() }),
]

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const trace = new ServerVoiceTrace()
  try {
    const auth = request.headers.get('Authorization') ?? ''
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: { user } } = await trace.measure('auth', () => db.auth.getUser())
    if (!user) return json({ status: 'error', message: 'Tu sesión expiró.', questions: [] }, 401)
    const body = await request.json()
    Object.assign(trace.timings, numericRecord(asRecord(body.trace).marks))
    if (body.type === 'health') return health()
    if (body.type === 'telemetry') return telemetry(db, user.id, body)
    if (body.type === 'revise') return reviseAction(db, user.id, body)
    if (body.type === 'confirm') return confirmAction(db, user.id, body, trace)
    if (body.type === 'cancel') return cancelAction(db, user.id, body)

    const requestId = validUuid(body.requestId) ? String(body.requestId) : crypto.randomUUID()
    const sessionId = validUuid(body.sessionId) ? String(body.sessionId) : null
    const message = String(body.message ?? '').trim()
    const source = body.source === 'voice' ? 'voice' : 'text'
    const surface: FaroSurface = ['dashboard', 'today', 'finances', 'lab'].includes(body.surface) ? body.surface : 'lab'
    const pipeline = body.pipeline === 'legacy' ? 'legacy' : 'optimized'
    const localContext = normalizedLocalContext(body.localContext)
    if (!message) return json({ status: 'error', message: 'Escribe o di una solicitud.', questions: [] }, 400)

    const replay = await findReplay(db, user.id, requestId)
    if (replay) return json(replay)

    if (pipeline === 'optimized') {
      const calendar = await resolveFastCalendar(db, user.id, message, body.sessionContext, localContext, trace)
      if (calendar) return fastResponse(db, user.id, { requestId, sessionId, source, message, surface, pipeline, timezone: localContext.timezone, sessionContext: asRecord(body.sessionContext) }, calendar, trace, 'calendar')
      const fast = await resolveFastFinance(db, user.id, message, body.sessionContext, trace)
      if (fast) return fastResponse(db, user.id, { requestId, sessionId, source, message, surface, pipeline }, fast, trace, 'finance')
    }

    return llmPipeline(db, user.id, { requestId, sessionId, source, message, surface, pipeline, history: normalizeHistory(body.history), localContext }, trace)
  } catch (error) {
    console.error('faro-voice failed', { name: error instanceof Error ? error.name : 'UnknownError' })
    return json({ status: 'error', message: error instanceof Error ? error.message : 'FARO no pudo procesar la solicitud.', questions: [] }, 500)
  }
})

type Db = ReturnType<typeof createClient>
type RequestMeta = { requestId: string; sessionId: string | null; source: string; message: string; surface: FaroSurface; pipeline: 'legacy' | 'optimized'; timezone?: string; sessionContext?: Record<string, any> }

async function health() {
  const key = Deno.env.get('OPENAI_API_KEY')
  const model = Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5-mini'
  if (!key) return json({ status: 'error', message: 'OPENAI_API_KEY no está configurada en Supabase.', questions: [], result: { configured: false, valid: false, model } })
  const check = await fetch(`https://api.openai.com/v1/models/${model}`, { headers: { Authorization: `Bearer ${key}` } })
  return check.ok
    ? json({ status: 'completed', message: `Conexión verificada. FARO puede usar ${model}.`, questions: [], result: { configured: true, valid: true, model } })
    : json({ status: 'error', message: `OpenAI rechazó la conexión (${check.status}).`, questions: [], result: { configured: true, valid: false, model } })
}

async function telemetry(db: Db, userId: string, body: Record<string, unknown>) {
  if (!validUuid(body.requestId)) return json({ status: 'error', message: 'requestId inválido.', questions: [] }, 400)
  const { data, error } = await db.from('voice_action_logs').select('timings,provider_metadata').eq('user_id', userId).eq('request_id', body.requestId).maybeSingle()
  if (error) throw error
  if (!data) return json({ status: 'error', message: 'Traza no encontrada.', questions: [] }, 404)
  const timings = { ...asRecord(data.timings), ...numericRecord(body.timings) }
  const providerMetadata = { ...asRecord(data.provider_metadata), ...asRecord(body.providerMetadata) }
  await updateLog(db, userId, String(body.requestId), { timings, provider_metadata: providerMetadata })
  return json({ status: 'completed', message: 'Telemetría registrada.', questions: [], result: { timings } })
}

async function reviseAction(db: Db, userId: string, body: Record<string, unknown>) {
  if (!validUuid(body.requestId)) return json({ status: 'error', message: 'La revisión no es válida.', questions: [] }, 400)
  const { data, error } = await db.from('voice_action_logs').select('tool_name,tool_arguments,confirmation_status,execution_status').eq('user_id', userId).eq('request_id', body.requestId).maybeSingle()
  if (error) throw error
  if (!data || data.confirmation_status !== 'pending' || !['received', 'pending', 'failed'].includes(data.execution_status)) return json({ status: 'error', message: 'La acción ya no puede modificarse.', questions: [] }, 409)
  const args = asRecord(data.tool_arguments)
  if (['createCalendarEvent', 'createScheduledTask', 'updateCalendarEvent'].includes(String(data.tool_name))) {
    const title = String(body.title ?? '').trim()
    if (!title || title.length > 120) return json({ status: 'error', message: 'El nuevo título no es válido.', questions: [] }, 400)
    args.title = title
    const message = `Usaré el título “${title}”. ¿Confirmas?`
    const { error: updateError } = await db.from('voice_action_logs').update({ tool_arguments: args, entities: args, result: { answer: message } }).eq('user_id', userId).eq('request_id', body.requestId).eq('confirmation_status', 'pending')
    if (updateError) throw updateError
    return json({ status: 'pending_confirmation', message, questions: [], pendingAction: { requestId: body.requestId, toolName: data.tool_name, arguments: args, summary: `Título actualizado a “${title}”.` }, qa: { intent: 'revisePendingAction', entities: { title }, toolName: data.tool_name, toolArguments: args, route: 'server_revision' } })
  }
  if (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) return json({ status: 'error', message: 'El nuevo monto no es válido.', questions: [] }, 400)
  const amountKey = data.tool_name === 'registerRecurringPayment' || data.tool_name === 'completePlannedTransaction' ? 'actualAmount' : 'amount'
  if (!['createExpense', 'createIncome', 'registerRecurringPayment', 'completePlannedTransaction', 'updateRecurringAmount', 'updateFinanceTransaction'].includes(String(data.tool_name))) return json({ status: 'error', message: 'Esta acción no admite cambiar el monto.', questions: [] }, 400)
  args[amountKey] = Number(body.amount)
  const { error: updateError } = await db.from('voice_action_logs').update({ tool_arguments: args, entities: args, result: { answer: `Actualizaré el importe a ${money(Number(body.amount))}. ¿Confirmas?` } }).eq('user_id', userId).eq('request_id', body.requestId).eq('confirmation_status', 'pending')
  if (updateError) throw updateError
  const summary = `Importe actualizado a ${money(Number(body.amount))}.`
  return json({ status: 'pending_confirmation', message: `Actualizaré el importe a ${money(Number(body.amount))}. ¿Confirmas?`, questions: [], pendingAction: { requestId: body.requestId, toolName: data.tool_name, arguments: args, summary }, qa: { intent: 'revisePendingAction', entities: { [amountKey]: Number(body.amount) }, toolName: data.tool_name, toolArguments: args, route: 'server_revision' } })
}

async function confirmAction(db: Db, userId: string, body: Record<string, unknown>, trace: ServerVoiceTrace) {
  if (!validUuid(body.requestId)) return json({ status: 'error', message: 'La acción no es válida.', questions: [] }, 400)
  const { data, error } = await db.rpc('claim_voice_action', { target_request_id: body.requestId })
  if (error) throw error
  const claim = asRecord(data)
  if (claim.state === 'completed') {
    const name = String(claim.toolName ?? '')
    return json({ status: 'completed', message: successMessage(name, asRecord(claim.arguments)), questions: [], result: claim.result, qa: { intent: name, entities: asRecord(claim.arguments), toolName: name, toolArguments: asRecord(claim.arguments), route: 'idempotent_replay' } })
  }
  if (claim.state === 'executing') return json({ status: 'error', message: 'La acción ya se está ejecutando.', questions: [] }, 409)
  if (claim.state === 'cancelled') return json({ status: 'error', message: 'La acción fue cancelada.', questions: [] }, 409)
  const toolName = String(claim.toolName ?? '')
  const skill = CALENDAR_MUTATIONS.has(toolName) ? 'calendar' : 'finance'
  const args = asRecord(claim.arguments)
  if (claim.state !== 'claimed' || !MUTATIONS.has(toolName)) return json({ status: 'error', message: 'La acción no existe o no puede ejecutarse.', questions: [] }, 409)
  let result: unknown
  try {
    result = await trace.measure('execution', () => executeTool(db, userId, toolName, args))
  } catch (error) {
    await updateLog(db, userId, String(body.requestId), { status: 'pending_confirmation', execution_status: 'failed', error_message: error instanceof Error ? error.message : 'Ejecución fallida', timings: trace.finish() })
    const message = CALENDAR_MUTATIONS.has(toolName)
      ? 'No pude guardar el cambio en el calendario. No hice ningún cambio.'
      : error instanceof Error ? error.message : 'No pude guardar el cambio.'
    return json({ status: 'error', message, questions: [], qa: { intent: toolName, skill, route: 'confirmed_server_action_failed' } }, 500)
  }
  const timings = trace.finish()
  try {
    await updateLog(db, userId, String(body.requestId), { status: 'completed', confirmation_status: 'confirmed', execution_status: 'completed', completed_at: new Date().toISOString(), result, timings })
  } catch (error) {
    console.error('FARO Voice persisted the action but could not finalize its log.', { toolName, requestId: body.requestId, error: error instanceof Error ? error.name : 'UnknownError' })
  }
  return json({ status: 'completed', message: successMessage(toolName, args), questions: [], result, qa: { intent: toolName, entities: args, toolName, toolArguments: args, timings, traceId: body.requestId, skill, route: 'confirmed_server_action' } })
}

async function cancelAction(db: Db, userId: string, body: Record<string, unknown>) {
  if (!validUuid(body.requestId)) return json({ status: 'error', message: 'La acción no es válida.', questions: [] }, 400)
  const { data, error } = await db.from('voice_action_logs').select('status,confirmation_status,execution_status,result').eq('user_id', userId).eq('request_id', body.requestId).maybeSingle()
  if (error) throw error
  if (!data) return json({ status: 'error', message: 'La acción no existe.', questions: [] }, 404)
  if (data.execution_status === 'completed') return json({ status: 'completed', message: 'La acción ya había sido ejecutada.', questions: [], result: data.result })
  if (data.execution_status === 'executing') return json({ status: 'error', message: 'La acción ya se está ejecutando.', questions: [] }, 409)
  const { data: cancelled, error: cancelError } = await db.from('voice_action_logs').update({ status: 'completed', confirmation_status: 'cancelled', execution_status: 'cancelled', completed_at: new Date().toISOString(), result: { cancelled: true } })
    .eq('user_id', userId).eq('request_id', body.requestId).in('execution_status', ['received', 'pending', 'failed']).select('id').maybeSingle()
  if (cancelError) throw cancelError
  if (!cancelled) return json({ status: 'error', message: 'La acción cambió de estado; vuelve a revisar el resultado.', questions: [] }, 409)
  return json({ status: 'completed', message: 'Acción cancelada. No se modificó ningún dato.', questions: [], result: { cancelled: true } })
}

async function fastResponse(db: Db, userId: string, meta: RequestMeta, fast: FastFinanceResolution | CalendarResolution, trace: ServerVoiceTrace, skill: 'finance' | 'calendar') {
  const route = `fast_path:${skill}:${fast.intent}`
  if (fast.kind === 'read') {
    const timings = trace.finish()
    await insertLog(db, userId, meta, { skill, status: 'completed', parsed_intent: fast.intent, result: { answer: fast.message, data: fast.result, references: fast.references ?? [] }, completed_at: new Date().toISOString(), execution_status: 'completed', timings, route })
    return json({ status: 'completed', message: fast.message, questions: [], result: { data: fast.result, references: fast.references ?? [] }, qa: qa(meta, fast.intent, timings, route, skill) })
  }
  if (fast.kind === 'clarify') {
    if (skill === 'calendar') {
      const workspaceName = routeCalendarIntent(meta.message).entities.workspaceName
      if (workspaceName) fast.entities = { ...(fast.entities ?? {}), workspaceName }
    }
    const timings = trace.finish()
    await insertLog(db, userId, meta, { skill, status: 'needs_clarification', parsed_intent: fast.intent, questions: [fast.message], result: { answer: fast.message, references: fast.references ?? [], pendingClarification: { intent: fast.intent, missingFields: fast.missingFields ?? [], entities: fast.entities ?? {} } }, execution_status: 'completed', timings, route })
    return json({ status: 'needs_clarification', message: fast.message, questions: [fast.message], result: { references: fast.references ?? [], pendingClarification: { intent: fast.intent, missingFields: fast.missingFields ?? [], entities: fast.entities ?? {} } }, qa: qa(meta, fast.intent, timings, route, skill) })
  }
  const actionArguments = { ...fast.arguments }
  if (skill === 'calendar' && fast.toolName === 'createScheduledTask') {
    const routedWorkspace = routeCalendarIntent(meta.message).entities.workspaceName
    const pendingWorkspace = asRecord(asRecord(meta.sessionContext?.pendingClarification).entities).workspaceName
    const requestedWorkspace = routedWorkspace ?? (typeof pendingWorkspace === 'string' ? pendingWorkspace : undefined)
    if (requestedWorkspace) {
      const { data: workspaces, error } = await db.from('workspaces').select('id,name').eq('user_id', userId).eq('is_active', true)
      if (error) throw error
      const wanted = foldText(requestedWorkspace)
      const matches = (workspaces ?? []).filter((item) => { const name = foldText(item.name); return name === wanted || name.includes(wanted) || wanted.includes(name) })
      if (matches.length !== 1) {
        const message = matches.length ? `Encontré varios workspaces parecidos a “${requestedWorkspace}”. ¿Cuál quieres usar?` : `No encuentro un workspace activo llamado “${requestedWorkspace}”.`
        const timings = trace.finish()
        await insertLog(db, userId, meta, { skill, status: 'needs_clarification', questions: [message], result: { answer: message, pendingClarification: { intent: fast.intent, missingFields: ['workspace'], entities: { workspaceName: requestedWorkspace } } }, execution_status: 'completed', timings, route })
        return json({ status: 'needs_clarification', message, questions: [message], result: { pendingClarification: { intent: fast.intent, missingFields: ['workspace'], entities: { workspaceName: requestedWorkspace } } }, qa: qa(meta, fast.intent, timings, route, skill) })
      }
      actionArguments.workspaceId = matches[0].id
    }
  }
  const pendingAction = { requestId: meta.requestId, toolName: fast.toolName, arguments: actionArguments, summary: fast.summary, ...(fast.possibleDuplicate ? { possibleDuplicate: fast.possibleDuplicate } : {}) }
  const timings = trace.finish()
  await insertLog(db, userId, meta, { skill, status: 'pending_confirmation', parsed_intent: fast.intent, entities: actionArguments, tool_name: fast.toolName, tool_arguments: actionArguments, confirmation_required: true, confirmation_status: 'pending', execution_status: 'pending', result: { answer: fast.prompt }, timings, route })
  return json({ status: 'pending_confirmation', message: fast.prompt, questions: [], pendingAction, qa: { ...qa(meta, fast.intent, timings, route, skill), entities: actionArguments, toolName: fast.toolName, toolArguments: actionArguments } })
}

async function llmPipeline(db: Db, userId: string, meta: RequestMeta & { history: Array<{ role: 'user' | 'assistant'; content: string }>; localContext: ReturnType<typeof normalizedLocalContext> }, trace: ServerVoiceTrace) {
  const context = await trace.measure('context', () => loadContext(db, userId))
  const completionText = meta.message
  const existing = trace.measureSync('matching', () => resolveExistingFinancial(completionText, context))
  if (existing?.kind === 'clarify') {
    const timings = trace.finish(); const route = 'deterministic_recurring:clarification'
    await insertLog(db, userId, meta, { status: 'needs_clarification', questions: [existing.message], result: { answer: existing.message }, execution_status: 'completed', timings, route })
    return json({ status: 'needs_clarification', message: existing.message, questions: [existing.message], qa: qa(meta, 'matchExistingFinance', timings, route) })
  }
  if (existing?.kind === 'action') {
    const args = idempotentArguments(existing.toolName, existing.arguments)
    const pendingAction = { requestId: meta.requestId, toolName: existing.toolName, arguments: args, summary: existing.summary }
    const timings = trace.finish(); const route = 'deterministic_recurring:action'
    await insertLog(db, userId, meta, { status: 'pending_confirmation', parsed_intent: existing.toolName, entities: args, tool_name: existing.toolName, tool_arguments: args, confirmation_required: true, confirmation_status: 'pending', execution_status: 'pending', result: { answer: existing.prompt }, timings, route })
    return json({ status: 'pending_confirmation', message: existing.prompt, questions: [], pendingAction, qa: { ...qa(meta, existing.toolName, timings, route), entities: args, toolName: existing.toolName, toolArguments: args } })
  }

  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return json({ status: 'error', message: 'FARO Voice aún no tiene configurada la clave de OpenAI en Supabase.', questions: [] }, 503)
  const ai = await trace.measure('llm', async () => {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_TEXT_MODEL') ?? 'gpt-5-mini',
        instructions: buildFaroSystemPrompt({ surface: meta.surface, financialContext: contextForSurface(context, meta.surface), availableTools: toolSchemas.map((candidate) => candidate.name), today: calendarLocalDate(new Date(meta.localContext.now), meta.localContext.timezone), timezone: meta.localContext.timezone }),
        input: [...meta.history, { role: 'user', content: meta.message }], tools: toolSchemas, tool_choice: 'auto',
      }),
    })
    if (!response.ok) throw new Error(`OpenAI respondió ${response.status}: ${await response.text()}`)
    return response.json()
  })
  const call = ai.output?.find((item: { type: string }) => item.type === 'function_call')
  const route = `${meta.pipeline === 'legacy' ? 'legacy' : 'optimized'}:llm_fallback`
  if (!call) {
    const answer = ai.output_text || ai.output?.flatMap((item: { content?: Array<{ text?: string }> }) => item.content ?? []).map((item: { text?: string }) => item.text).filter(Boolean).join(' ') || 'Necesito un poco más de información.'
    const questions = extractQuestions(answer).slice(0, 3); const timings = trace.finish()
    await insertLog(db, userId, meta, { status: questions.length ? 'needs_clarification' : 'completed', questions, result: { answer }, completed_at: questions.length ? null : new Date().toISOString(), execution_status: 'completed', timings, route })
    return json({ status: questions.length ? 'needs_clarification' : 'completed', message: answer, questions, qa: qa(meta, 'conversation', timings, route) })
  }
  const args = normalizeCalendarFallbackArguments(call.name, idempotentArguments(call.name, JSON.parse(call.arguments || '{}')), meta.message, meta.localContext)
  if (MUTATIONS.has(call.name)) {
    const possibleDuplicate = call.name === 'createExpense' || call.name === 'createIncome' ? await findPotentialDuplicate(db, userId, call.name, args) : undefined
    const summary = confirmationSummary(call.name, args, context)
    const pendingAction = { requestId: meta.requestId, toolName: call.name, arguments: args, summary, ...(possibleDuplicate ? { possibleDuplicate } : {}) }
    const timings = trace.finish()
    await insertLog(db, userId, meta, { status: 'pending_confirmation', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, confirmation_required: true, confirmation_status: 'pending', execution_status: 'pending', result: { answer: confirmationPrompt(call.name, args, context, Boolean(possibleDuplicate)) }, timings, route })
    return json({ status: 'pending_confirmation', message: confirmationPrompt(call.name, args, context, Boolean(possibleDuplicate)), questions: [], pendingAction, qa: { ...qa(meta, call.name, timings, route), entities: args, toolName: call.name, toolArguments: args } })
  }
  const result = await trace.measure('execution', () => executeTool(db, userId, call.name, args)); const timings = trace.finish()
  const message = readResultMessage(call.name, result)
  await insertLog(db, userId, meta, { status: 'completed', parsed_intent: call.name, entities: args, tool_name: call.name, tool_arguments: args, result: { answer: message, data: result }, completed_at: new Date().toISOString(), execution_status: 'completed', timings, route })
  return json({ status: 'completed', message, questions: [], result, qa: { ...qa(meta, call.name, timings, route), entities: args, toolName: call.name, toolArguments: args } })
}

function qa(meta: RequestMeta, intent: string, timings: Record<string, number>, route: string, skill: 'finance' | 'calendar' = 'finance') {
  return { intent, entities: {}, timings, traceId: meta.requestId, pipeline: meta.pipeline, skill, route }
}

async function findReplay(db: Db, userId: string, requestId: string) {
  const { data, error } = await db.from('voice_action_logs').select('status,result,questions,tool_name,tool_arguments,confirmation_status,timings,route').eq('user_id', userId).eq('request_id', requestId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const result = asRecord(data.result)
  const message = typeof result.answer === 'string' ? result.answer : data.status === 'completed' ? 'Esta solicitud ya fue procesada.' : 'Esta solicitud ya está registrada.'
  if (data.status === 'pending_confirmation' && data.tool_name) return { status: 'pending_confirmation', message, questions: [], pendingAction: { requestId, toolName: data.tool_name, arguments: asRecord(data.tool_arguments), summary: confirmationSummary(data.tool_name, asRecord(data.tool_arguments), {}) }, qa: { timings: numericRecord(data.timings), route: 'request_replay' } }
  return { status: data.status, message, questions: Array.isArray(data.questions) ? data.questions : [], result }
}

async function executeTool(db: Db, userId: string, name: string, args: Record<string, unknown>) {
  if (name === 'createExpense' || name === 'createIncome') {
    const type = name === 'createExpense' ? 'expense' : 'income'
    const id = validUuid(args.transactionId) ? String(args.transactionId) : crypto.randomUUID()
    const { data, error } = await db.from('finance_transactions').upsert({ id, user_id: userId, account_id: args.accountId, category_id: args.categoryId, type, amount: Number(args.amount), transaction_date: args.date, description: args.description, status: args.status ?? 'completed', notes: args.notes ?? null }, { onConflict: 'id' }).select().single()
    if (error) throw error; return data
  }
  if (name === 'updateFinanceTransaction' || name === 'updateFinanceTransactionStatus') {
    const updates: Record<string, unknown> = {}
    if (args.amount != null) updates.amount = Number(args.amount)
    if (args.categoryId != null) updates.category_id = args.categoryId
    if (args.accountId != null) updates.account_id = args.accountId
    if (args.date != null) updates.transaction_date = args.date
    if (args.description != null) updates.description = args.description
    if (args.status != null) updates.status = args.status
    if (!Object.keys(updates).length) throw new Error('No hay cambios para aplicar.')
    const { data, error } = await db.from('finance_transactions').update(updates).eq('id', args.transactionId).eq('user_id', userId).select().single()
    if (error) throw error; return data
  }
  if (name === 'deleteFinanceTransaction') {
    const { data: existing, error: readError } = await db.from('finance_transactions').select('id').eq('id', args.transactionId).eq('user_id', userId).maybeSingle()
    if (readError) throw readError
    if (!existing) return { transactionId: args.transactionId, alreadyDeleted: true }
    const { error } = await db.rpc('delete_finance_transaction_safely', { target_transaction_id: args.transactionId })
    if (error) throw error
    return { transactionId: args.transactionId, deleted: true }
  }
  if (name === 'listRecurringExpenses') {
    let query = db.from('finance_recurring_transactions').select('id,description,amount,frequency,next_occurrence,is_active,account_id,category_id').eq('user_id', userId).neq('type', 'income')
    if (args.activeOnly) query = query.eq('is_active', true)
    if (args.query) query = query.ilike('description', `%${String(args.query).replace(/[%_]/g, '')}%`)
    const { data, error } = await query.order('next_occurrence'); if (error) throw error; return data
  }
  if (name === 'createRecurringExpense') {
    const recurringId = validUuid(args.recurringId) ? String(args.recurringId) : crypto.randomUUID()
    const expectedDate = String(args.firstExpectedDate); const period = `${expectedDate.slice(0, 7)}-01`
    const { data: recurring, error } = await db.from('finance_recurring_transactions').upsert({ id: recurringId, user_id: userId, account_id: args.accountId, category_id: args.categoryId, type: 'expense', amount: Number(args.amount), description: String(args.description), frequency: args.frequency, start_date: args.startDate, next_occurrence: expectedDate, end_date: args.endDate || null, day_of_month: args.dayOfMonth || null, is_active: true }, { onConflict: 'id' }).select().single()
    if (error) throw error
    const { data: occurrence, error: occurrenceError } = await db.from('finance_recurring_occurrences').upsert({ user_id: userId, recurring_transaction_id: recurringId, period, expected_date: expectedDate, amount: Number(args.amount), status: 'pending' }, { onConflict: 'recurring_transaction_id,period' }).select().single()
    if (occurrenceError) throw occurrenceError
    return { recurring, occurrence }
  }
  if (name === 'registerRecurringPayment') {
    if (Number.isFinite(Number(args.actualAmount))) {
      const { error } = await db.from('finance_recurring_occurrences').update({ amount: Number(args.actualAmount) }).eq('user_id', userId).eq('recurring_transaction_id', args.recurringId).eq('period', args.period).eq('status', 'pending')
      if (error) throw error
    }
    const { data, error } = await db.rpc('register_finance_recurring_occurrence', { target_recurring_id: args.recurringId, target_period: args.period, target_expected_date: args.expectedDate })
    if (error) throw error
    return { transactionId: data, recurringId: args.recurringId, period: args.period }
  }
  if (name === 'completePlannedTransaction') {
    const { data: existing, error: readError } = await db.from('finance_transactions').select('*').eq('id', args.transactionId).eq('user_id', userId).maybeSingle()
    if (readError) throw readError
    if (existing?.status === 'completed') return existing
    const updates: Record<string, unknown> = { status: 'completed' }; if (Number.isFinite(Number(args.actualAmount))) updates.amount = Number(args.actualAmount)
    const { data, error } = await db.from('finance_transactions').update(updates).eq('id', args.transactionId).eq('user_id', userId).in('status', ['planned', 'pending']).select().single()
    if (error) throw error; return data
  }
  if (name === 'updateRecurringAmount') {
    const { data, error } = await db.from('finance_recurring_transactions').update({ amount: Number(args.amount) }).eq('id', args.recurringId).eq('user_id', userId).select().single()
    if (error) throw error; return data
  }
  if (name === 'getSpentToday') {
    const date = String(args.date ?? localToday())
    const { data, error } = await db.from('finance_transactions').select('id,amount,description').eq('user_id', userId).eq('transaction_date', date).eq('status', 'completed').in('type', ['expense', 'debt_payment'])
    if (error) throw error
    return { date, total: (data ?? []).reduce((sum, item) => sum + Number(item.amount), 0), transactions: data ?? [] }
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
    const completed = data.filter((item) => item.status === 'completed')
    const income = completed.filter((item) => ['income', 'refund'].includes(item.type)).reduce((sum, item) => sum + Number(item.amount), 0)
    const expense = completed.filter((item) => ['expense', 'debt_payment'].includes(item.type)).reduce((sum, item) => sum + Number(item.amount), 0)
    return { income, expense, balance: income - expense, count: completed.length }
  }
  if (name === 'createCalendarEvent') {
    assertFaroCalendarMutation(args)
    const id = validUuid(args.eventId) ? String(args.eventId) : crypto.randomUUID()
    const { data, error } = await db.from('calendar_entries').upsert({
      id, user_id:userId, title:String(args.title), kind:'event', starts_at:String(args.start),
      ends_at:String(args.end), all_day:false,
    }, { onConflict:'id' }).select().single()
    if (error) throw error
    if (!data || data.id !== id || data.user_id !== userId
      || new Date(data.starts_at).getTime() !== new Date(String(args.start)).getTime()
      || new Date(data.ends_at).getTime() !== new Date(String(args.end)).getTime()) {
      await db.from('calendar_entries').delete().eq('id', id).eq('user_id', userId)
      throw new Error('No se pudo verificar la persistencia del evento.')
    }
    return { item:data, reference:{ id, type:'calendar_event', title:data.title, subtitle:data.starts_at } }
  }
  if (name === 'createScheduledTask') {
    const id = validUuid(args.taskId) ? String(args.taskId) : crypto.randomUUID()
    let workspaceId = validUuid(args.workspaceId) ? String(args.workspaceId) : undefined
    if (!workspaceId) {
      const { data: workspace, error: workspaceError } = await db.from('workspaces').select('id').eq('user_id',userId).eq('is_active',true).order('sort_order').limit(1).maybeSingle()
      if (workspaceError) throw workspaceError
      workspaceId = workspace?.id
    }
    if (!workspaceId) throw new Error('Crea o activa un workspace antes de programar una tarea.')
    const { data, error } = await db.from('tasks').upsert({
      id,user_id:userId,title:String(args.title),area:'personal',status:'todo',priority:'medium',
      due_at:String(args.start),estimated_minutes:Math.max(15,Number(args.durationMinutes)||30),workspace_id:workspaceId,
    },{onConflict:'id'}).select().single()
    if(error)throw error
    if(!data||data.id!==id||new Date(data.due_at).getTime()!==new Date(String(args.start)).getTime()){
      await db.from('tasks').delete().eq('id',id).eq('user_id',userId)
      throw new Error('No se pudo verificar la persistencia de la tarea.')
    }
    return { item:data, reference:{id,type:'calendar_task',title:data.title,subtitle:data.due_at} }
  }
  if (name === 'updateCalendarEvent') {
    assertFaroCalendarMutation(args)
    if (args.targetKind === 'task') {
      const minutes=Math.max(15,Math.round((new Date(String(args.end)).getTime()-new Date(String(args.start)).getTime())/60000))
      const updates:Record<string,unknown>={due_at:String(args.start),estimated_minutes:minutes,updated_at:new Date().toISOString()}
      if(typeof args.title==='string'&&args.title.trim())updates.title=args.title.trim()
      const {data,error}=await db.from('tasks').update(updates).eq('id',args.targetId).eq('user_id',userId).select().single()
      if(error)throw error
      return{item:data,reference:{id:data.id,type:'calendar_task',title:data.title,subtitle:data.due_at}}
    }
    const updates:Record<string,unknown>={starts_at:String(args.start),ends_at:String(args.end),updated_at:new Date().toISOString()}
    if(typeof args.title==='string'&&args.title.trim())updates.title=args.title.trim()
    const {data,error}=await db.from('calendar_entries').update(updates).eq('id',args.targetId).eq('user_id',userId).select().single()
    if(error)throw error
    return{item:data,reference:{id:data.id,type:'calendar_event',title:data.title,subtitle:data.starts_at}}
  }
  if (name === 'deleteCalendarEvent') {
    assertFaroCalendarMutation(args)
    const table=args.targetKind==='task'?'tasks':'calendar_entries'
    const {data:existing,error:readError}=await db.from(table).select('id,title').eq('id',args.targetId).eq('user_id',userId).maybeSingle()
    if(readError)throw readError
    if(!existing)return{targetId:args.targetId,alreadyDeleted:true}
    const{data:deleted,error}=await db.from(table).delete().eq('id',args.targetId).eq('user_id',userId).select('id').single()
    if(error)throw error
    if(!deleted||deleted.id!==args.targetId)throw new Error('No se pudo verificar la eliminación.')
    return{targetId:args.targetId,deleted:true}
  }
  throw new Error(`Herramienta no permitida: ${name}`)
}

async function loadContext(db: Db, userId: string) {
  const today = localToday(); const period = `${today.slice(0, 7)}-01`
  const [accounts, categories, recurring, recurringOccurrences, plannedTransactions, recentTransactions, budgets] = await Promise.all([
    db.from('finance_accounts').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_categories').select('id,name,type').eq('user_id', userId).eq('is_active', true),
    db.from('finance_recurring_transactions').select('id,description,type,amount,frequency,next_occurrence,day_of_month,is_active,account_id,category_id').eq('user_id', userId),
    db.from('finance_recurring_occurrences').select('id,recurring_transaction_id,period,expected_date,amount,status,transaction_id').eq('user_id', userId).eq('period', period),
    db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date').eq('user_id', userId).in('status', ['planned', 'pending']),
    db.from('finance_transactions').select('id,description,type,amount,status,account_id,category_id,transaction_date').eq('user_id', userId).order('transaction_date', { ascending: false }).limit(20),
    db.from('finance_budgets').select('id,name,category_id,planned_amount,period_start,period_end').eq('user_id', userId).lte('period_start', today).gte('period_end', today).limit(20),
  ])
  for (const response of [accounts, categories, recurring, recurringOccurrences, plannedTransactions, recentTransactions, budgets]) if (response.error) throw response.error
  return { accounts: accounts.data ?? [], categories: categories.data ?? [], recurring: recurring.data ?? [], recurringOccurrences: recurringOccurrences.data ?? [], plannedTransactions: plannedTransactions.data ?? [], recentTransactions: recentTransactions.data ?? [], budgets: budgets.data ?? [], currentPeriod: period }
}
type FinanceContext = Awaited<ReturnType<typeof loadContext>>

function resolveExistingFinancial(message: string, context: FinanceContext) {
  const normalized = foldText(message)
  const permanent = /\b(a partir de ahora|desde ahora|proximo mes|siguientes periodos)\b/.test(normalized)
  const completed = /\b(pague|acabo de pagar|acabo de poner|acaban de pagarme|gaste|compre|liquide|me cobraron|me cayo|recibi|cobre|me depositaron|marca como cobrado|cobra)\b/.test(normalized)
  if ((!completed && !permanent) || /\b(pagare|voy a pagar|tengo que pagar|me van a cobrar|me pagaran|voy a cobrar)\b/.test(normalized)) return null
  const accounts = new Map(context.accounts.map((item) => [item.id, item.name])); const categories = new Map(context.categories.map((item) => [item.id, item.name])); const candidates: FinanceCandidate[] = []
  for (const item of context.recurring) { const occurrence = context.recurringOccurrences.find((candidate) => candidate.recurring_transaction_id === item.id); if (!item.is_active || (!permanent && (occurrence?.status === 'paid' || occurrence?.transaction_id))) continue; candidates.push({ id: item.id, description: item.description, kind: 'recurring', type: item.type === 'income' ? 'income' : 'expense', amount: Number(permanent ? item.amount : occurrence?.amount ?? item.amount), status: occurrence?.status ?? 'pending', accountName: accounts.get(item.account_id), categoryName: categories.get(item.category_id), period: context.currentPeriod, expectedDate: occurrence?.expected_date ?? item.next_occurrence }) }
  for (const item of context.plannedTransactions) candidates.push({ id: item.id, description: item.description, kind: 'transaction', type: item.type === 'income' ? 'income' : 'expense', amount: Number(item.amount), status: item.status, accountName: accounts.get(item.account_id), categoryName: categories.get(item.category_id) })
  const income = /\b(sueldo|quincena|me cayo|recibi|cobre|depositaron|pagaron)\b/.test(normalized)
  const matches = matchFinanceCandidates(message, candidates.filter((item) => item.type === (income ? 'income' : 'expense')))
  if (!matches.length) return null
  if (matches[1] && matches[0].score - matches[1].score < .25) return { kind: 'clarify' as const, message: `Encontré varias coincidencias:\n${matches.slice(0, 3).map((match, index) => `${index + 1}. ${match.candidate.description}, ${money(match.candidate.amount)}`).join('\n')}\n¿Cuál corresponde?` }
  const found = matches[0].candidate; const amounts = [...normalized.replace(/,/g, '').matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => Number(match[0])); const actualAmount = amounts.at(-1); const real = Number.isFinite(actualAmount) ? actualAmount! : found.amount
  if (permanent && found.kind === 'recurring' && Number.isFinite(actualAmount)) return { kind: 'action' as const, toolName: 'updateRecurringAmount', arguments: { recurringId: found.id, amount: real }, summary: `Cambiar ${found.description} a ${money(real)} para periodos futuros.`, prompt: `¿Cambio el importe base de “${found.description}” a ${money(real)}?` }
  const toolName = found.kind === 'recurring' ? 'registerRecurringPayment' : 'completePlannedTransaction'
  const args = found.kind === 'recurring' ? { recurringId: found.id, period: found.period, expectedDate: found.expectedDate, actualAmount: real } : { transactionId: found.id, actualAmount: real }
  return { kind: 'action' as const, toolName, arguments: args, summary: `Registrar ${found.description} por ${money(real)}.`, prompt: `Encontré “${found.description}” por ${money(real)}. ¿Confirmas?` }
}

function tool(name: string, description: string, properties: Record<string, unknown>, _required: string[] = []) { return { type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } } }
function string(description?: string) { return { type: 'string', ...(description ? { description } : {}) } }
function optionalString() { return { type: ['string', 'null'] } }
function optionalNumber() { return { type: ['number', 'null'] } }
function enumValue(values: string[]) { return { type: 'string', enum: values } }
function financeCreateProperties() { return { transactionId: optionalString(), amount: { type: 'number', exclusiveMinimum: 0 }, description: string(), date: string(), accountId: string(), categoryId: string(), status: enumValue(financeStatuses), notes: optionalString() } }
function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function normalizedLocalContext(value: unknown) {
  const raw = asRecord(value)
  let timezone = typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : 'America/Mexico_City'
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { timezone = 'America/Mexico_City' }
  const parsedNow = typeof raw.now === 'string' ? new Date(raw.now) : new Date()
  return {
    now: Number.isFinite(parsedNow.getTime()) ? parsedNow.toISOString() : new Date().toISOString(),
    timezone,
    calendarItems: Array.isArray(raw.calendarItems) ? raw.calendarItems : [],
  }
}

function normalizeCalendarFallbackArguments(name: string, raw: Record<string, unknown>, message: string, local: ReturnType<typeof normalizedLocalContext>) {
  if (!CALENDAR_MUTATIONS.has(name)) return raw
  const args = { ...raw }
  if (name === 'createCalendarEvent' || name === 'updateCalendarEvent' || name === 'deleteCalendarEvent') args.provider = 'faro'
  if (name === 'createCalendarEvent') args.timezone = local.timezone
  const today = calendarLocalDate(new Date(local.now), local.timezone)
  const date = resolveExplicitCalendarDate(message, today)
  const range = extractCalendarTimeRange(message)
  const routedTime = routeCalendarIntent(message).entities.time
  if (date && (range || routedTime) && (name === 'createCalendarEvent' || name === 'createScheduledTask')) {
    const startTime = range?.start ?? routedTime!
    args.start = zonedCalendarIso(date, startTime, local.timezone)
    if (range) {
      let end = zonedCalendarIso(date, range.end, local.timezone)
      if (new Date(end) <= new Date(String(args.start))) end = zonedCalendarIso(addCalendarDays(date, 1), range.end, local.timezone)
      args.end = end
      if (name === 'createScheduledTask') args.durationMinutes = Math.round((new Date(end).getTime() - new Date(String(args.start)).getTime()) / 60000)
    } else {
      const existingStart = new Date(String(raw.start ?? ''))
      const existingEnd = new Date(String(raw.end ?? ''))
      const inferredMinutes = Number(args.durationMinutes) || (Number.isFinite(existingStart.getTime()) && Number.isFinite(existingEnd.getTime()) ? Math.round((existingEnd.getTime() - existingStart.getTime()) / 60000) : 0)
      const durationMinutes = inferredMinutes > 0 ? inferredMinutes : name === 'createScheduledTask' ? 120 : 60
      args.end = new Date(new Date(String(args.start)).getTime() + durationMinutes * 60000).toISOString()
      if (name === 'createScheduledTask') args.durationMinutes = durationMinutes
    }
  }
  return args
}
function foldText(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX') }
function money(value: number) { return value.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }) }
function normalizeHistory(value: unknown): Array<{ role: 'user' | 'assistant'; content: string }> { if (!Array.isArray(value)) return []; return value.slice(-6).flatMap((turn) => { const item = asRecord(turn); return (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string' && item.content.trim() ? [{ role: item.role, content: item.content.trim().slice(0, 2000) }] : [] }) }
function contextForSurface(context: FinanceContext, surface: FaroSurface) { const limit = surface === 'finances' || surface === 'lab' ? 75 : surface === 'today' ? 30 : 20; return { accounts: context.accounts.slice(0, 20), categories: context.categories.slice(0, 40), recurring: context.recurring.slice(0, limit), recurringOccurrences: context.recurringOccurrences.slice(0, limit), plannedTransactions: context.plannedTransactions.slice(0, limit), recentTransactions: context.recentTransactions.slice(0, limit), budgets: context.budgets.slice(0, 20), currentPeriod: context.currentPeriod } }
function idempotentArguments(name: string, raw: Record<string, unknown>) { const args = { ...raw }; if ((name === 'createExpense' || name === 'createIncome') && !validUuid(args.transactionId)) args.transactionId = crypto.randomUUID(); if (name === 'createRecurringExpense' && !validUuid(args.recurringId)) args.recurringId = crypto.randomUUID(); if (name === 'createCalendarEvent' && !validUuid(args.eventId)) args.eventId = crypto.randomUUID(); if (name === 'createScheduledTask' && !validUuid(args.taskId)) args.taskId = crypto.randomUUID(); return args }
function validUuid(value: unknown) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function asRecord(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {} }
function numericRecord(value: unknown) { return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([key, item]) => typeof item === 'number' && Number.isFinite(item) ? [[key, Math.round(item * 100) / 100]] : [])) }
function extractQuestions(text: string) { return text.split(/\n+/).map((item) => item.trim()).filter((item) => item.endsWith('?')) }

async function findPotentialDuplicate(db: Db, userId: string, toolName: string, args: Record<string, unknown>) {
  if (!args.accountId || !args.date || !Number.isFinite(Number(args.amount))) return undefined
  const { data, error } = await db.from('finance_transactions').select('id,description,amount,transaction_date').eq('user_id', userId).eq('type', toolName === 'createExpense' ? 'expense' : 'income').eq('account_id', args.accountId).eq('transaction_date', args.date).eq('amount', Number(args.amount)).neq('status', 'cancelled').limit(1)
  if (error) throw error; const match = data?.[0]; return match ? { id: match.id, description: match.description, amount: Number(match.amount), date: match.transaction_date } : undefined
}
function confirmationSummary(name: string, args: Record<string, unknown>, context: { accounts?: Array<{ id: string; name: string }>; categories?: Array<{ id: string; name: string }>; recurring?: Array<{ id: string; description: string }> }) { const label = (items: Array<{ id: string; name: string }> | undefined, id: unknown) => items?.find((item) => item.id === id)?.name ?? String(id ?? 'sin definir'); if (name === 'createExpense' || name === 'createIncome') return `${name === 'createExpense' ? 'Gasto' : 'Ingreso'} de ${money(Number(args.amount))} en ${label(context.accounts, args.accountId)}, categoría ${label(context.categories, args.categoryId)}, fecha ${args.date}.`; if (name === 'deleteFinanceTransaction') return 'Eliminar el movimiento seleccionado.'; if (name === 'updateFinanceTransaction') return 'Actualizar el movimiento seleccionado.'; if (name === 'createRecurringExpense') return `Crear ${args.description} por ${money(Number(args.amount))}.`; if (name === 'registerRecurringPayment') return `Registrar el pago de ${context.recurring?.find((item) => item.id === args.recurringId)?.description ?? 'este recurrente'}.`; return `${name}: ${JSON.stringify(args)}` }
function confirmationPrompt(name: string, args: Record<string, unknown>, context: { categories?: Array<{ id: string; name: string }>; recurring?: Array<{ id: string; description: string }> }, duplicate: boolean) { if (duplicate) return 'Ya existe un movimiento igual. ¿Quieres registrarlo otra vez?'; if (name === 'createExpense' || name === 'createIncome') return `¿Registro ${money(Number(args.amount))} como ${name === 'createExpense' ? 'gasto' : 'ingreso'} en ${context.categories?.find((item) => item.id === args.categoryId)?.name ?? 'Sin categoría'}?`; if (name === 'registerRecurringPayment') return `¿Registro el pago de ${context.recurring?.find((item) => item.id === args.recurringId)?.description ?? 'este recurrente'}?`; if (name === 'createCalendarEvent') return `Voy a agregar “${String(args.title)}” de ${formatTimeForSpeech(String(args.start), String(args.timezone))} a ${formatTimeForSpeech(String(args.end), String(args.timezone))}. ¿Confirmas?`; return '¿Confirmas este cambio?' }
function successMessage(name: string, args: Record<string, unknown> = {}) {
  if (name === 'createCalendarEvent') return `Listo. Agendé “${String(args.title)}” a las ${formatTimeForSpeech(String(args.start), String(args.timezone ?? 'America/Mexico_City'))}.`
  if (name === 'createScheduledTask') return `Listo. Programé “${String(args.title)}” a las ${formatTimeForSpeech(String(args.start))}.`
  if (name === 'updateCalendarEvent') return typeof args.title === 'string' && args.title
    ? `Listo. Cambié el título a “${args.title}”.`
    : `Listo. Moví el elemento a la ${formatTimeForSpeech(String(args.start))}.`
  if (name === 'deleteCalendarEvent') return 'Listo. Eliminé el elemento del calendario FARO.'
  const labels: Record<string, string> = { createExpense: 'Gasto registrado correctamente.', createIncome: 'Ingreso registrado correctamente.', updateFinanceTransaction: 'Movimiento actualizado correctamente.', updateFinanceTransactionStatus: 'Estado actualizado correctamente.', deleteFinanceTransaction: 'Movimiento eliminado correctamente.', createRecurringExpense: 'Gasto recurrente creado.', registerRecurringPayment: 'Pago recurrente registrado.', completePlannedTransaction: 'Movimiento completado correctamente.', updateRecurringAmount: 'Recurrencia actualizada correctamente.' }
  return labels[name] ?? 'Cambio guardado correctamente.'
}
function readResultMessage(name: string, result: unknown) { if (name === 'getSpentToday') return `Hoy has gastado ${money(Number(asRecord(result).total ?? 0))}.`; if (name === 'getFinanceSummary') return 'Aquí tienes tu resumen financiero.'; if (name === 'listRecurringExpenses') return `Encontré ${Array.isArray(result) ? result.length : 0} gasto(s) recurrente(s).`; return `Encontré ${Array.isArray(result) ? result.length : 1} resultado(s).` }

async function insertLog(db: Db, userId: string, meta: RequestMeta, values: Record<string, unknown>) { const { error } = await db.from('voice_action_logs').insert({ user_id: userId, request_id: meta.requestId, session_id: meta.sessionId, source: meta.source, transcript: meta.message, surface: meta.surface, skill: 'finance', ...values }); if (error) throw error }
async function updateLog(db: Db, userId: string, requestId: string, values: Record<string, unknown>) { const { error } = await db.from('voice_action_logs').update(values).eq('user_id', userId).eq('request_id', requestId); if (error) throw error }
