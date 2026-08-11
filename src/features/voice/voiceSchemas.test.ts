import { describe, expect, it } from 'vitest'
import { pendingActionSchema, voiceActionSchema, voiceResponseSchema } from './voiceSchemas'

describe('FARO Voice contracts', () => {
  it('accepts a text request with a stable id', () => {
    const value = voiceActionSchema.parse({
      requestId: '48e30c50-e4bb-44a0-bdeb-bf098b2c3547',
      source: 'text',
      message: 'Crea una tarea para hoy',
    })
    expect(value.message).toBe('Crea una tarea para hoy')
  })

  it('rejects empty requests', () => {
    expect(() => voiceActionSchema.parse({
      requestId: '48e30c50-e4bb-44a0-bdeb-bf098b2c3547',
      source: 'voice',
      message: ' ',
    })).toThrow()
  })

  it('accepts the calendar snapshot rendered by the client', () => {
    const value = voiceActionSchema.parse({
      requestId: '48e30c50-e4bb-44a0-bdeb-bf098b2c3547',
      source: 'voice',
      message: '¿Qué hay mañana?',
      localContext: {
        now: '2026-08-08T20:30:00.000Z',
        timezone: 'America/Mexico_City',
        calendarItems: [{
          id: 'task-1',
          kind: 'task',
          title: 'Integrar Hotfix de FaroOS',
          start: '2026-08-09T14:00:00.000Z',
          end: '2026-08-09T16:00:00.000Z',
          allDay: false,
        }],
      },
    })
    expect(value.localContext?.calendarItems[0].title).toBe('Integrar Hotfix de FaroOS')
  })

  it('limits clarification to three questions', () => {
    expect(() => voiceResponseSchema.parse({
      status: 'needs_clarification',
      message: 'Necesito datos',
      questions: ['Uno?', 'Dos?', 'Tres?', 'Cuatro?'],
    })).toThrow()
  })

  it('rejects tools outside the allowlist', () => {
    expect(() => pendingActionSchema.parse({
      requestId: '48e30c50-e4bb-44a0-bdeb-bf098b2c3547',
      toolName: 'runSql',
      arguments: {},
      summary: 'Acción peligrosa',
    })).toThrow()
  })
  it('acepta importes reales por periodo y cambios base explícitos',()=>{
    expect(pendingActionSchema.parse({requestId:'48e30c50-e4bb-44a0-bdeb-bf098b2c3547',toolName:'completePlannedTransaction',arguments:{transactionId:'x',actualAmount:1450},summary:'Pago'}).toolName).toBe('completePlannedTransaction')
    expect(pendingActionSchema.parse({requestId:'48e30c50-e4bb-44a0-bdeb-bf098b2c3547',toolName:'updateRecurringAmount',arguments:{recurringId:'x',amount:7200},summary:'Cambio futuro'}).toolName).toBe('updateRecurringAmount')
  })
})
