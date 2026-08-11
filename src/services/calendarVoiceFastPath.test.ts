import { describe, expect, it } from 'vitest'
import { routeCalendarIntent } from '../../supabase/functions/_shared/voice/calendarFastPath'
import { extractCalendarTimeRange, resolveExplicitCalendarDate, zonedCalendarIso } from '../../supabase/functions/_shared/voice/calendarDateTime'

describe('router determinista de FARO Voice Calendar', () => {
  it.each([
    ['¿Qué tengo mañana?', 'list_calendar_items'],
    ['¿Qué sigue?', 'get_next_commitment'],
    ['Encuentra la reunión de BIMSA en mi calendario', 'find_calendar_event'],
    ['Encuéntrame un espacio de dos horas esta semana', 'find_available_slots'],
    ['Agenda una reunión con Ana mañana a las 4', 'create_calendar_event'],
    ['Agrega un evento a mi calendario mañana con el título Salida con Iris', 'create_calendar_event'],
    ['Programa una tarea para avanzar el reporte mañana a las 3', 'create_scheduled_task'],
    ['Créame una tarea mañana a las 10 en el workspace de BIMSA', 'create_scheduled_task'],
    ['Genérame una tarea el lunes de 10 de la mañana a 12 del día en el workspace de BIMSA con el título Pendientes por maquetar', 'create_scheduled_task'],
    ['Generarme una tarea el día lunes 10 de agosto a las 12 del día con el título Pendientes por realizar en el workspace de BIMSA', 'create_scheduled_task'],
    ['Generarrme una tarea el día lunes 10 de agosto a las 12 del día con el título Pendientes por realizar en el workspace de BIMSA', 'create_scheduled_task'],
    ['No, mejor, genérame una tarea el lunes a las 10', 'create_scheduled_task'],
    ['¿Qué eventos tengo?', 'list_calendar_items'],
    ['¿Qué eventos tengo el día de mañana?', 'list_calendar_items'],
    ['Mueve la reunión una hora más tarde', 'update_calendar_event'],
    ['Elimina ese evento', 'delete_calendar_event'],
    ['Elimínalo', 'delete_calendar_event'],
  ])('clasifica %s como %s', (message, intent) => {
    expect(routeCalendarIntent(message).intent).toBe(intent)
  })

  it('extrae hora local, duración y ordinal sin reloj de servidor', () => {
    expect(routeCalendarIntent('La segunda; reserva una reunión de 90 minutos a las 4 pm')).toMatchObject({
      entities: { ordinal: 2, durationMinutes: 90, time: '16:00' },
    })
  })

  it('extrae un rango horario explícito sin convertirlo a UTC', () => {
    expect(routeCalendarIntent('Crea el evento AWS Summit el 12 de agosto de 09:00 a 18:00')).toMatchObject({
      intent: 'create_calendar_event',
      entities: { time: '09:00', endTime: '18:00' },
    })
  })

  it('entiende rangos hablados con mañana y tarde', () => {
    expect(routeCalendarIntent('Registra un evento el día 12 de agosto de 9 de la mañana a 6 de la tarde, con el título AWS Summit')).toMatchObject({
      intent: 'create_calendar_event',
      entities: { time: '09:00', endTime: '18:00' },
    })
  })

  it('aplica “de la noche” a todo el rango y no mezcla mañana con noche', () => {
    expect(extractCalendarTimeRange('Crea un evento mañana de 9 a 10 de la noche')).toEqual({ start: '21:00', end: '22:00' })
    expect(routeCalendarIntent('Crea un evento mañana de 9 a 10 de la noche con el título Incorrecto')).toMatchObject({
      intent: 'create_calendar_event',
      entities: { time: '21:00', endTime: '22:00' },
    })
  })

  it('usa el último rango como corrección de duración solicitada', () => {
    expect(routeCalendarIntent('Cambia la duración para que en lugar de 2 de la tarde a 6 de la tarde sea de 2 de la tarde a 4 de la tarde')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { time: '14:00', endTime: '16:00' },
    })
  })

  it('resuelve el workspace escrito por nombre', () => {
    expect(routeCalendarIntent('Créame una tarea mañana a las 10 en el workspace de BIMSA')).toMatchObject({ entities: { workspaceName: 'BIMSA' } })
    expect(routeCalendarIntent('Genérame una tarea el lunes de 10 a 12 en el workspace de BIMSA con el título Pendientes')).toMatchObject({
      intent: 'create_scheduled_task',
      entities: { workspaceName: 'BIMSA', time: '10:00', endTime: '12:00' },
    })
  })

  it('no confunde una consulta de disponibilidad para una tarea con crearla', () => {
    expect(routeCalendarIntent('¿Qué horas tengo disponible para agendar una tarea mañana?').intent).toBe('find_available_slots')
  })

  it('separa la hora actual del evento del desplazamiento solicitado', () => {
    expect(routeCalendarIntent('Mueve mi evento de 7 de la noche a una hora después')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { sourceTime: '19:00', relativeMinutes: 60 },
    })
  })

  it('identifica por hora de origen y conserva por separado la hora destino', () => {
    expect(routeCalendarIntent('Mueve el evento que tengo mañana a las 10:30 de la mañana a la una de la tarde')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { sourceTime: '10:30', time: '13:00', endTime: undefined },
    })
  })

  it('localiza por la hora de inicio y entiende una hora antes', () => {
    expect(routeCalendarIntent('Mueve el evento que tengo mañana, que inicia a las 2 de la tarde, para que inicie una hora antes')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { sourceTime: '14:00', relativeMinutes: -60 },
    })
  })

  it('localiza por “de las” sin depender del evento anterior', () => {
    expect(routeCalendarIntent('Mueve el evento de las 7 de la noche a las 8 de la noche')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { sourceTime: '19:00', time: '20:00', ordinal: 0 },
    })
  })

  it('consulta un único evento por su hora local', () => {
    expect(routeCalendarIntent('¿Qué evento tengo mañana a las 2 de la tarde?')).toMatchObject({
      intent: 'list_calendar_items',
      entities: { time: '14:00' },
    })
  })

  it('mantiene alternativas dentro de Calendar aunque la respuesta empiece con sí', () => {
    expect(routeCalendarIntent('Sí, busca alternativas')).toMatchObject({ intent: 'find_available_slots' })
  })

  it('resuelve la fecha explícita y convierte Mexico City sólo al persistir', () => {
    const date = resolveExplicitCalendarDate('el 12 de agosto', '2026-08-08')
    expect(date).toBe('2026-08-12')
    expect(zonedCalendarIso(date!, '09:00', 'America/Mexico_City')).toBe('2026-08-12T15:00:00.000Z')
    expect(zonedCalendarIso(date!, '18:00', 'America/Mexico_City')).toBe('2026-08-13T00:00:00.000Z')
  })

  it('resuelve “ahí” como la primera opción disponible del contexto', () => {
    expect(routeCalendarIntent('Pon ahí una tarea de dos horas para trabajar en FARO')).toMatchObject({intent:'create_scheduled_task',entities:{ordinal:1,durationMinutes:120}})
  })

  it('no confunde una instrucción financiera con Calendar', () => {
    expect(routeCalendarIntent('Gasté 350 pesos en comida').intent).toBe('unknown')
  })

  it('recalcula la intención en cada transición y no reutiliza la lectura anterior', () => {
    expect([
      '¿Qué tengo mañana?',
      'Agrega mañana a las 12 un evento llamado Salida con Iris',
    ].map((message) => routeCalendarIntent(message).intent)).toEqual([
      'list_calendar_items', 'create_calendar_event',
    ])
    expect([
      'Agrega mañana a las 12 un evento llamado Salida con Iris',
      '¿Qué tengo mañana?',
    ].map((message) => routeCalendarIntent(message).intent)).toEqual([
      'create_calendar_event', 'list_calendar_items',
    ])
  })

  it('reconoce cambio de título como actualización contextual', () => {
    expect(routeCalendarIntent('Cámbiale el título a Comida con Iris')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { newTitle: 'Comida con Iris' },
    })
  })

  it('conserva el nombre explícito al modificar, aun si hay resultados anteriores', () => {
    expect(routeCalendarIntent('Cambia de hora el evento llamado Prueba 1')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { targetTitle: 'Prueba 1', updateKind: 'move' },
    })
  })

  it('entiende un seguimiento relativo sin volver a Finanzas', () => {
    expect(routeCalendarIntent('Recórrelo una hora antes')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { relativeMinutes: -60, updateKind: 'move' },
    })
  })

  it('distingue cambiar la duración de mover el evento', () => {
    expect(routeCalendarIntent('Cambia la duración del evento Prueba 3 a 4 horas')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { targetTitle: 'Prueba 3', durationMinutes: 240, time: undefined, endTime: undefined, updateKind: 'duration' },
    })
  })

  it('extrae los dos nombres al renombrar un evento existente', () => {
    expect(routeCalendarIntent('Renombra el evento Prueba 1 a Prueba de validación')).toMatchObject({
      intent: 'update_calendar_event',
      entities: { targetTitle: 'Prueba 1', newTitle: 'Prueba de validación', updateKind: 'rename' },
    })
  })

  it('trata el evento más temprano como una búsqueda singular', () => {
    expect(routeCalendarIntent('Busca el evento que tengo mañana más temprano')).toMatchObject({
      intent: 'get_next_commitment',
    })
  })
})
