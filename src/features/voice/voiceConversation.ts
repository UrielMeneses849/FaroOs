import type { PendingVoiceAction } from './voiceSchemas'

export const normalizeVoiceReply = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const hasExplicitNegative = (value: string) => /\b(no|cancela|cancelar|olvidalo|dejalo)\b/.test(value)
const hasModification = (value: string) => /\b(pero|mejor|cambia|cambialo|monto|importe|fueron|desde|categoria|ayer)\b/.test(value)

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
  return /^(adios faro|hasta luego faro|gracias faro adios|termina( la)? conversacion)$/.test(normalized)
}

export type VoiceInputRoute =
  | { kind: 'ignore'; transcript: string }
  | { kind: 'wake'; transcript: string }
  | { kind: 'command'; command: string; transcript: string }
  | { kind: 'confirm'; transcript: string }
  | { kind: 'cancel'; transcript: string }
  | { kind: 'modify'; action: PendingVoiceAction; transcript: string }
  | { kind: 'pending_unknown'; transcript: string }
  | { kind: 'goodbye'; transcript: string }

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
  const amount = spokenNumber(value)
  if (amount === undefined || !/(mejor|fueron|cambia|cambialo|monto|importe)/.test(normalizeVoiceReply(value))) return undefined
  const amountKey = action.toolName === 'registerRecurringPayment' || action.toolName === 'completePlannedTransaction' ? 'actualAmount' : 'amount'
  return {
    ...action,
    arguments: { ...action.arguments, [amountKey]: amount },
    summary: `${action.summary.replace(/\$[\d,.]+/g, '').trim()} · $${amount.toLocaleString('es-MX')}`,
  }
}

export function routeVoiceInput(value: string, options: { pendingAction?: PendingVoiceAction; commandActive: boolean }): VoiceInputRoute {
  const transcript = value.trim()
  if (isVoiceGoodbye(transcript)) return { kind: 'goodbye', transcript }
  if (options.pendingAction) {
    if (isVoiceConfirmation(transcript)) return { kind: 'confirm', transcript }
    if (isVoiceCancellation(transcript)) return { kind: 'cancel', transcript }
    const action = updatePendingActionFromVoice(options.pendingAction, transcript)
    if (action) return { kind: 'modify', action, transcript }
    return { kind: 'pending_unknown', transcript }
  }
  if (options.commandActive) return { kind: 'command', command: transcript, transcript }
  const wake = transcript.match(/^\s*(?:hola\s+)?(?:faro|foro)\b[\s,.:;-]*(.*)$/i)
  if (!wake) return { kind: 'ignore', transcript }
  const command = wake[1].trim()
  return command ? { kind: 'command', command, transcript } : { kind: 'wake', transcript }
}
