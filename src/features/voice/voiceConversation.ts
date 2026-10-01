import type { PendingVoiceAction } from './voiceSchemas'

export const normalizeVoiceReply = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const shouldAcceptRealtimeWake = (value: string, speechDurationMs?: number) => {
  // “FARO” is intentionally a short wake word. Server VAD can report it in
  // less than 650 ms, so duration is not a valid reason to discard it.
  void speechDurationMs
  return Boolean(normalizeVoiceReply(value))
}

const hasExplicitNegative = (value: string) => /\b(no|cancela|cancelar|olvidalo|dejalo)\b/.test(value)
const hasModification = (value: string) => /\b(pero|mejor|cambia|cambialo|monto|importe|fueron|desde|categoria|ayer)\b/.test(value)

export const isNewCommandDuringConfirmation = (value: string) => {
  const normalized = normalizeVoiceReply(value)
  const operation = /\b(que|cual|cuanto|dime|busca|buscame|encuentra|mueve|muevelo|recorre|crea|agrega|agenda|programa|elimina|borra|registra|muestra|muestrame)\b/.test(normalized)
  const domain = /\b(evento|eventos|reunion|reuniones|cita|citas|calendario|agenda|tarea|tareas|movimiento|movimientos|gasto|gastos|gaste|ingreso|ingresos|finanzas)\b/.test(normalized)
  return operation && domain && !/\b(?:ponlo|cambialo|cambia|mejor)\b/.test(normalized)
}

export const isVoiceConfirmation = (value: string) => {
  const normalized = normalizeVoiceReply(value)
  if (hasExplicitNegative(normalized) || hasModification(normalized)) return false
  return /\b(si|confirmo|confirma|correcto|adelante|hazlo|registralo|registro el pago|registra el pago|registra el cobro|procede|de acuerdo|esta bien|dale)\b/.test(normalized)
}

export const isVoiceCancellation = (value: string) => {
  const normalized = normalizeVoiceReply(value)
  return /\b(cancela|cancelar|olvidalo|dejalo)\b/.test(normalized) || /^(no|mejor no|no lo registres|no lo hagas)$/.test(normalized)
}

export const isVoiceGoodbye = (value: string) => {
  const normalized = normalizeVoiceReply(value)
  return /^(adios(?: faro)?|hasta luego(?: faro)?|gracias faro(?: adios)?|termina(?: la)? conversacion|eso es todo faro)$/.test(normalized)
}

export type VoiceInputRoute =
  | { kind: 'ignore'; transcript: string }
  | { kind: 'wake'; transcript: string }
  | { kind: 'command'; command: string; transcript: string }
  | { kind: 'confirm'; transcript: string }
  | { kind: 'cancel'; transcript: string }
  | { kind: 'modify'; action: PendingVoiceAction; transcript: string }
  | { kind: 'request_pending_edit'; field: 'title'; transcript: string }
  | { kind: 'pending_turn'; intent: 'modify' | 'clarify' | 'reject_assumption' | 'question'; transcript: string }
  | { kind: 'new_intent'; transcript: string }
  | { kind: 'goodbye'; transcript: string }

export type PendingTurnIntent = Extract<VoiceInputRoute, { kind: 'pending_turn' }>['intent']

/**
 * Pending proposals are conversational state, not a yes/no modal.  Keep this
 * classifier deliberately conservative: it handles only unambiguous local
 * turns and leaves the controlled field update to the server.
 */
export function classifyPendingTurn(value: string): PendingTurnIntent | 'new_intent' {
  const normalized = normalizeVoiceReply(value)
  if (isNewCommandDuringConfirmation(normalized)) return 'new_intent'
  if (/\?$|\b(?:cual|cuanto|por que|porque|que categoria|que encontraste|explicame)\b/.test(normalized)) return 'question'
  if (/\b(?:no es(?: el)? mismo|no es igual|eso esta mal|te equivocaste|no es ese|no es lo mismo|ese movimiento es otro|ese dice|yo dije|yo te estoy diciendo|no me entendiste|son movimientos diferentes)\b/.test(normalized)) return 'reject_assumption'
  if (/\b(?:mejor|cambia|cambialo|ponle|ponlo|descripcion|categoria|importe|monto|fueron|ayer|hoy|manana|prioridad|workspace|a las)\b/.test(normalized)) return 'modify'
  return 'clarify'
}

const spokenNumber = (value: string) => {
  const numeric = value.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/)
  if (numeric) return Number(numeric[1])
  const words: Record<string, number> = {
    cien: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
    seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
    mil: 1000, 'mil cien': 1100, 'mil doscientos': 1200, 'mil trescientos': 1300,
    'mil cuatrocientos': 1400, 'mil quinientos': 1500, 'dos mil': 2000,
  }
  const normalized = normalizeVoiceReply(value)
  return Object.entries(words).sort((a, b) => b[0].length - a[0].length).find(([word]) => normalized.includes(word))?.[1]
}

export function updatePendingActionFromVoice(action: PendingVoiceAction, value: string) {
  const title = value.match(/\b(?:cambia|cámbiale|cambiale|ponle)\s+(?:el\s+)?t[ií]tulo\s+(?:a\s+)?(.+?)\s*$/i)?.[1]?.trim()
  if (title && ['createCalendarEvent', 'createScheduledTask', 'updateCalendarEvent', 'createBacklogTask', 'updateBacklogTask'].includes(action.toolName)) {
    return { ...action, arguments: { ...action.arguments, title }, summary: action.summary.replace(/“[^”]+”/, `“${title}”`) }
  }
  const amount = spokenNumber(value)
  if (amount === undefined || !/(mejor|fueron|cambia|cambialo|monto|importe)/.test(normalizeVoiceReply(value))) return undefined
  const amountKey = action.toolName === 'registerRecurringPayment' || action.toolName === 'completePlannedTransaction' ? 'actualAmount' : 'amount'
  return {
    ...action,
    arguments: { ...action.arguments, [amountKey]: amount },
    summary: `${action.summary.replace(/\$[\d,.]+/g, '').trim()} · $${amount.toLocaleString('es-MX')}`,
  }
}

export function routeVoiceInput(value: string, options: { pendingAction?: PendingVoiceAction; commandActive: boolean; permissiveWake?: boolean }): VoiceInputRoute {
  const transcript = value.trim()
  if (isVoiceGoodbye(transcript)) return { kind: 'goodbye', transcript }
  // Realtime is prompted for FARO, but short names are where transcription
  // is least certain. When Mini was explicitly opened by the user, accept a
  // few close Spanish renderings too; the regular full-panel flow stays
  // deliberately stricter to avoid accidental wake-ups in a conversation.
  const wakeWord = options.permissiveWake
    ? '(?:faro(?:\\s*os)?|faros|farro|foro|fara|farol|claro|caro)'
    : '(?:faro(?:\\s*os)?|faros|farro|foro|fara|farol)'
  const wake = transcript.match(new RegExp(`^\\s*(?:(?:hola|oye|hey|ey|eh)[\\s,.:;-]+)?${wakeWord}\\b[\\s,.:;-]*(.*)$`, 'i'))
  if (wake && !wake[1].trim() && (options.commandActive || options.pendingAction)) return { kind: 'ignore', transcript }
  if (options.pendingAction) {
    if (isVoiceConfirmation(transcript)) return { kind: 'confirm', transcript }
    if (isNewCommandDuringConfirmation(transcript)) return { kind: 'new_intent', transcript }
    if (isVoiceCancellation(transcript)) return { kind: 'cancel', transcript }
    if (/\b(?:cambia|cambiale|ponle)\s+(?:el\s+)?titulo\s+a?\s*$/.test(normalizeVoiceReply(transcript))) return { kind: 'request_pending_edit', field: 'title', transcript }
    const action = updatePendingActionFromVoice(options.pendingAction, transcript)
    if (action) return { kind: 'modify', action, transcript }
    const pendingIntent = classifyPendingTurn(transcript)
    if (pendingIntent === 'new_intent') return { kind: 'new_intent', transcript }
    return { kind: 'pending_turn', intent: pendingIntent, transcript }
  }
  if (options.commandActive) return { kind: 'command', command: transcript, transcript }
  if (!wake) return { kind: 'ignore', transcript }
  const command = wake[1].trim()
  return command ? { kind: 'command', command, transcript } : { kind: 'wake', transcript }
}
