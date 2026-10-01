import { describe, expect, it } from 'vitest'
import { needTiming, nextNeedDate, sortNeeds, type NeedItem } from './needsTypes'

const item = (id: string, nextNeededOn?: string): NeedItem => ({
  id, name: id, category: 'home', shoppingGroup: 'supermarket', priority: 'soon', frequency: 'monthly', isOnShoppingList: false, nextNeededOn,
  isActive: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

describe('needs timing', () => {
  it('advances recurring items from the day they were replenished', () => {
    expect(nextNeedDate('2026-09-03', 'biweekly')).toBe('2026-09-17')
    expect(nextNeedDate('2026-09-03', 'quarterly')).toBe('2026-12-03')
    expect(nextNeedDate('2026-09-03', 'one_time')).toBeUndefined()
    expect(nextNeedDate('2026-09-03', 'as_needed')).toBeUndefined()
  })

  it('puts overdue and imminent needs above later ones', () => {
    expect(needTiming('2026-09-02', new Date('2026-09-03T12:00:00'))).toBe('overdue')
    expect(sortNeeds([item('later', '2026-09-20'), item('today', '2026-09-03'), item('overdue', '2026-09-01')])
      .map((candidate) => candidate.id)).toEqual(['overdue', 'today', 'later'])
  })
})
