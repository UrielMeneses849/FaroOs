import { describe, expect, it } from 'vitest'
import { buildDotHandoff, parseTaskBrief, serializeTaskBrief } from './taskBrief'

describe('documentación ejecutable de tareas', () => {
  it('abre descripciones antiguas como contexto sin perder su contenido', () => {
    expect(parseTaskBrief('El filtro conserva selecciones antiguas.')).toEqual(expect.objectContaining({
      objective: '',
      currentBehavior: 'El filtro conserva selecciones antiguas.',
    }))
  })

  it('conserva todos los campos estructurados al guardar y volver a abrir', () => {
    const brief = {
      objective: 'Limpiar la selección sin desactivar Explorer.',
      currentBehavior: 'Los puntos quedan ocultos en caché.',
      reproductionSteps: '1. Seleccionar puntos\n2. Limpiar filtros',
      acceptanceCriteria: '- La selección queda vacía\n- Explorer sigue activo',
      references: 'Captura: /tmp/fallo.png',
    }
    expect(parseTaskBrief(serializeTaskBrief(brief))).toEqual(brief)
  })

  it('genera un encargo explícito con ID, contexto y límites de ejecución', () => {
    const handoff = buildDotHandoff({
      id: 'task-123',
      title: 'Corregir filtros',
      workspace: 'BIMSA',
      section: 'Descargas',
      project: 'Construleads',
      taskType: 'bug',
      status: 'todo',
      priority: 'high',
      brief: { objective: 'Restablecer selección.', currentBehavior: 'Queda en caché.', reproductionSteps: 'Limpiar filtros.', acceptanceCriteria: 'Selección vacía.', references: '' },
    })
    expect(handoff).toContain('No ha sido enviado ni iniciado automáticamente')
    expect(handoff).toContain('- ID: task-123')
    expect(handoff).toContain('- Proyecto: Construleads')
    expect(handoff).toContain('## Criterios de aceptación')
    expect(handoff).toContain('No hagas commit, push, despliegue ni publiques sin autorización')
  })
})
