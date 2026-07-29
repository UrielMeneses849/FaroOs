import { describe, expect, it } from 'vitest'
import { demoData } from '../../data/mockData'
import { buildBacklogItems, filterBacklog } from './backlogUtils'

describe('filtros del backlog', () => {
  it('filtra por tipo, búsqueda, área y prioridad', () => {
    const items = buildBacklogItems(demoData)
    const result = filterBacklog(items, 'tasks', {
      query: 'IA aplicada', area: 'learning', priority: 'high', status: 'all', sort: 'priority',
    })
    expect(result).toHaveLength(1)
    expect(result[0].title).toContain('IA aplicada')
  })
})
