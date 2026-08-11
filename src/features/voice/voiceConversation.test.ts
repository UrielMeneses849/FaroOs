import { describe, expect, it } from 'vitest'
import { isNewCommandDuringConfirmation, isVoiceCancellation, isVoiceConfirmation, routeVoiceInput, shouldAcceptRealtimeWake } from './voiceConversation'
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
  it('extrae Hola FARO y conserva la transcripción completa', () => expect(routeVoiceInput('Hola FARO, registra un gasto', { commandActive: false })).toEqual({ kind: 'command', command: 'registra un gasto', transcript: 'Hola FARO, registra un gasto' }))
  it('ignora FARO aislado en conversación ambiental', () => expect(routeVoiceInput('FARO, registra un gasto', { commandActive: false }).kind).toBe('ignore'))
  it('FARO solo activa la escucha', () => expect(routeVoiceInput('Hola FARO', { commandActive: false }).kind).toBe('wake'))
  it('ignora un wake phrase residual si la conversación ya está activa', () => expect(routeVoiceInput('Hola FARO', { commandActive: true }).kind).toBe('ignore'))
  it('ignora un wake phrase residual durante una confirmación', () => expect(routeVoiceInput('Hola FARO', { commandActive: true, pendingAction: pending }).kind).toBe('ignore'))
  it.each(['Hola, Faro', 'Hola: FARO', 'Oye, Faro'])('acepta puntuación automática de STT en %s', value => expect(routeVoiceInput(value, { commandActive: false }).kind).toBe('wake'))
  it('detecta la despedida antes que cualquier acción financiera', () => expect(routeVoiceInput('Adiós FARO', { pendingAction: pending, commandActive: true }).kind).toBe('goodbye'))
  it('no confunde una respuesta de FARO con confirmación', () => expect(isVoiceConfirmation('Encontré Licencia Moto, ¿confirmas?')).toBe(false))
  it('bloquea el agente general ante una respuesta desconocida mientras hay acción pendiente', () => expect(routeVoiceInput('no estoy seguro', { pendingAction: pending, commandActive: true }).kind).toBe('pending_unknown'))
  it.each([
    'Faro, busca el evento que tengo mañana a las 2 de la tarde',
    'Mueve el evento de mañana de las 7 a las 8 de la noche',
    '¿Qué eventos tengo el martes?',
  ])('permite reemplazar una propuesta incorrecta con el nuevo comando %s', value => {
    expect(isNewCommandDuringConfirmation(value)).toBe(true)
    expect(routeVoiceInput(value, { pendingAction: pending, commandActive: true })).toEqual({ kind: 'pending_unknown', transcript: value })
  })
  it('rechaza un wake aislado demasiado corto, típico de un ruido o notificación', () => expect(shouldAcceptRealtimeWake('Hola, FARO', 180)).toBe(false))
  it('acepta el wake cuando contiene habla humana sostenida', () => expect(shouldAcceptRealtimeWake('Hola, FARO', 920)).toBe(true))
  it('no filtra comandos cortos distintos al wake phrase', () => expect(shouldAcceptRealtimeWake('Sí', 180)).toBe(true))
  it('permite cambiar el título de una acción Calendar pendiente', () => {
    const route = routeVoiceInput('cambia el título a Revisión de contratos', { pendingAction: { ...pending, toolName: 'createCalendarEvent', arguments: { title: 'Título incorrecto' } }, commandActive: true })
    expect(route.kind).toBe('modify')
    if (route.kind === 'modify') expect(route.action.arguments.title).toBe('Revisión de contratos')
  })
  it('pide el nuevo título cuando la instrucción quedó incompleta', () => expect(routeVoiceInput('cambia el título a', { pendingAction: { ...pending, toolName: 'createCalendarEvent' }, commandActive: true }).kind).toBe('request_pending_edit'))
})
