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
  it('acepta FARO seguido de una instrucción sin saludo previo', () => expect(routeVoiceInput('FARO, registra un gasto', { commandActive: false })).toEqual({ kind: 'command', command: 'registra un gasto', transcript: 'FARO, registra un gasto' }))
  it.each(['FARO OS, activa modo concentración', 'Claro, activa modo concentración', 'Caro, activa modo concentración'])('tolera %s sólo desde FARO Mini abierto', value => {
    expect(routeVoiceInput(value, { commandActive: false, permissiveWake: true })).toMatchObject({ kind: 'command', command: 'activa modo concentración' })
  })
  it('FARO solo activa la escucha', () => expect(routeVoiceInput('Hola FARO', { commandActive: false }).kind).toBe('wake'))
  it('ignora un wake phrase residual si la conversación ya está activa', () => expect(routeVoiceInput('Hola FARO', { commandActive: true }).kind).toBe('ignore'))
  it('ignora un wake phrase residual durante una confirmación', () => expect(routeVoiceInput('Hola FARO', { commandActive: true, pendingAction: pending }).kind).toBe('ignore'))
  it.each(['Hola, Faro', 'Hola: FARO', 'Oye, Faro'])('acepta puntuación automática de STT en %s', value => expect(routeVoiceInput(value, { commandActive: false }).kind).toBe('wake'))
  it('detecta la despedida antes que cualquier acción financiera', () => expect(routeVoiceInput('Adiós FARO', { pendingAction: pending, commandActive: true }).kind).toBe('goodbye'))
  it('no confunde una respuesta de FARO con confirmación', () => expect(isVoiceConfirmation('Encontré Licencia Moto, ¿confirmas?')).toBe(false))
  it('mantiene una propuesta activa ante una respuesta ambigua', () => expect(routeVoiceInput('no estoy seguro', { pendingAction: pending, commandActive: true })).toMatchObject({ kind: 'pending_turn', intent: 'clarify' }))
  it.each([
    'Faro, busca el evento que tengo mañana a las 2 de la tarde',
    'Mueve el evento de mañana de las 7 a las 8 de la noche',
    '¿Qué eventos tengo el martes?',
  ])('permite reemplazar una propuesta incorrecta con el nuevo comando %s', value => {
    expect(isNewCommandDuringConfirmation(value)).toBe(true)
    expect(routeVoiceInput(value, { pendingAction: pending, commandActive: true })).toEqual({ kind: 'new_intent', transcript: value })
  })
  it('acepta un FARO aislado aunque sea corto', () => expect(shouldAcceptRealtimeWake('FARO', 180)).toBe(true))
  it('acepta el wake cuando contiene habla humana sostenida', () => expect(shouldAcceptRealtimeWake('FARO', 920)).toBe(true))
  it('no filtra comandos cortos distintos al wake phrase', () => expect(shouldAcceptRealtimeWake('Sí', 180)).toBe(true))
  it('permite cambiar el título de una acción Calendar pendiente', () => {
    const route = routeVoiceInput('cambia el título a Revisión de contratos', { pendingAction: { ...pending, toolName: 'createCalendarEvent', arguments: { title: 'Título incorrecto' } }, commandActive: true })
    expect(route.kind).toBe('modify')
    if (route.kind === 'modify') expect(route.action.arguments.title).toBe('Revisión de contratos')
  })
  it('no convierte una negación con aclaración en cancelación', () => {
    expect(routeVoiceInput('No es el mismo, ese dice Recarga y este es Comida de Kira.', { pendingAction: pending, commandActive: true })).toMatchObject({ kind: 'pending_turn', intent: 'reject_assumption' })
  })
  it.each([
    ['¿Cuál encontraste?', 'question'],
    ['No, ponlo en Transporte.', 'modify'],
    ['Olvida eso. ¿Cuánto gasté hoy?', 'new_intent'],
  ] as const)('clasifica turnos pendientes conversacionales: %s', (value, intent) => {
    const route = routeVoiceInput(value, { pendingAction: pending, commandActive: true })
    expect(intent === 'new_intent' ? route.kind : route.kind === 'pending_turn' && route.intent).toBe(intent)
  })
  it('pide el nuevo título cuando la instrucción quedó incompleta', () => expect(routeVoiceInput('cambia el título a', { pendingAction: { ...pending, toolName: 'createCalendarEvent' }, commandActive: true }).kind).toBe('request_pending_edit'))
})
