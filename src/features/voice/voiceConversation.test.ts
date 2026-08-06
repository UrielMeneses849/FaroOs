import { describe, expect, it } from 'vitest'
import { isVoiceCancellation, isVoiceConfirmation, routeVoiceInput } from './voiceConversation'
import type { PendingVoiceAction } from './voiceSchemas'

const pending: PendingVoiceAction = {
  requestId: '48e30c50-e4bb-44a0-bdeb-bf098b2c3547',
  toolName: 'registerRecurringPayment',
  arguments: { recurringId: 'licencia', actualAmount: 1300 },
  summary: 'Licencia Moto por $1,300',
}

describe('flujo conversacional de voz', () => {
  it.each(['Sí', 'sí, registra el pago', 'sí registró el pago', 'confirmo el movimiento', 'correcto, adelante', 'regístralo por favor', 'confirma', 'hazlo', 'procede con el movimiento', 'de acuerdo', 'está bien', 'dale'])('acepta %s', value => expect(isVoiceConfirmation(value)).toBe(true))
  it.each(['si cuesta más no', 'no sé si confirmarlo', 'sí, pero cambia el monto', 'no, mejor cancela'])('no confirma ambiguamente %s', value => expect(isVoiceConfirmation(value)).toBe(false))
  it.each(['No', 'no, cancela', 'cancelar', 'déjalo', 'olvídalo', 'no lo hagas'])('cancela con %s', value => expect(isVoiceCancellation(value)).toBe(true))
  it('prioriza confirmar la acción pendiente sin crear otro comando', () => expect(routeVoiceInput('confirmo', { pendingAction: pending, commandActive: true })).toEqual({ kind: 'confirm', transcript: 'confirmo' }))
  it('confirma una transcripción imperfecta sin reenviarla como comando', () => expect(routeVoiceInput('sí registró el pago', { pendingAction: pending, commandActive: true })).toEqual({ kind: 'confirm', transcript: 'sí registró el pago' }))
  it('prioriza cancelar la acción pendiente', () => expect(routeVoiceInput('no, cancela', { pendingAction: pending, commandActive: true })).toEqual({ kind: 'cancel', transcript: 'no, cancela' }))
  it('actualiza la misma acción antes de confirmar', () => {
    const route = routeVoiceInput('mejor fueron $1,400', { pendingAction: pending, commandActive: true })
    expect(route.kind).toBe('modify')
    if (route.kind === 'modify') expect(route.action.arguments).toMatchObject({ recurringId: 'licencia', actualAmount: 1400 })
  })
  it('ignora conversación ambiental sin palabra de activación', () => expect(routeVoiceInput('qué calor hace', { commandActive: false }).kind).toBe('ignore'))
  it('extrae FARO y conserva la transcripción completa', () => expect(routeVoiceInput('FARO, registra un gasto', { commandActive: false })).toEqual({ kind: 'command', command: 'registra un gasto', transcript: 'FARO, registra un gasto' }))
  it('FARO solo activa la escucha', () => expect(routeVoiceInput('Hola FARO', { commandActive: false }).kind).toBe('wake'))
  it('detecta la despedida antes que cualquier acción financiera', () => expect(routeVoiceInput('Adiós FARO', { pendingAction: pending, commandActive: true }).kind).toBe('goodbye'))
  it('no confunde una respuesta de FARO con confirmación', () => expect(isVoiceConfirmation('Encontré Licencia Moto, ¿confirmas?')).toBe(false))
  it('bloquea el agente general ante una respuesta desconocida mientras hay acción pendiente', () => expect(routeVoiceInput('no estoy seguro', { pendingAction: pending, commandActive: true }).kind).toBe('pending_unknown'))
})
