import { describe, expect, it } from 'vitest'
import { extractFinanceAmounts, routeFinanceIntent } from '../../supabase/functions/_shared/voice/financeFastPath'
import { routeCalendarIntent } from '../../supabase/functions/_shared/voice/calendarFastPath'

describe('router determinista de FARO Voice financiero', () => {
  it.each([
    ['Gasté 350 en comida.', 'create_expense', [350]],
    ['Registra 1200 de ingreso en BBVA.', 'create_income', [1200]],
    ['¿Cuánto gasté hoy?', 'spent_today', []],
    ['Elimina el gasto de 500 de ayer.', 'delete_transaction', [500]],
    ['Cambia el gasto de 350 a Transporte.', 'update_transaction', [350]],
    ['Registra el pago recurrente de Seguro Hermana.', 'register_recurring', []],
  ])('clasifica %s sin LLM', (message, intent, amounts) => {
    const route = routeFinanceIntent(message)
    expect(route.intent).toBe(intent)
    expect(route.entities.amounts).toEqual(amounts)
  })

  it('deja una instrucción ambigua para aclaración/LLM', () => {
    expect(routeFinanceIntent('Haz lo de ayer, por favor.')).toMatchObject({ intent: 'unknown', confidence: 0 })
  })

  it('mantiene Finance CREATE después de una lectura de Calendar', () => {
    expect(routeCalendarIntent('¿Qué tengo mañana?').intent).toBe('list_calendar_items')
    expect(routeFinanceIntent('Registra un gasto de 350 pesos en comida').intent).toBe('create_expense')
  })

  it('normaliza montos mexicanos sin confundir separadores', () => {
    expect(extractFinanceAmounts('Pagué $1,200.50 y antes 350 pesos')).toEqual([1200.5, 350])
    expect(extractFinanceAmounts('Fueron 1.200,50 MXN')).toEqual([1200.5])
  })
})
