import { describe, expect, it } from 'vitest'
import { blankProduct, closePurchase, consume, emptyHousehold, householdSchema, migrateLegacy, shoppingSaturday, starterProducts, suggestedQuantity, type PurchaseLine } from './household'
import type { NeedItem } from './needsTypes'

describe('household replenishment', () => {
  const week = '2026-10-31'
  it('uses the next local Saturday, including today on Saturday and rolling on Sunday', () => {
    expect(shoppingSaturday(new Date(2026, 9, 26, 12))).toBe(week)
    expect(shoppingSaturday(new Date(2026, 9, 31, 23, 59))).toBe(week)
    expect(shoppingSaturday(new Date(2026, 10, 1, 0, 1))).toBe('2026-11-07')
  })
  it('subtracts stock and rounds up to the purchase increment without floating-point extras', () => {
    const rice = { ...blankProduct(), target: 1, stock: .3, step: .1 }
    expect(suggestedQuantity(rice, week)).toBe(.7)
    expect(suggestedQuantity({ ...rice, stock: 1 }, week)).toBe(0)
    expect(suggestedQuantity({ ...rice, target: .3, stock: .2 }, week)).toBe(.1)
  })
  it('converts eggs to whole packs and never buys a fraction of a pack', () => {
    expect(suggestedQuantity({ ...blankProduct(), target: 30, stock: 8, packSize: 30, step: 1 }, week)).toBe(1)
  })
  it('only adds status products when low, empty, or explicitly weekly', () => {
    const p = { ...blankProduct(), mode: 'status' as const, status: 'available' as const, step: 1 }
    expect(suggestedQuantity(p, week)).toBe(0)
    expect(suggestedQuantity({ ...p, status: 'low' }, week)).toBe(1)
    expect(suggestedQuantity({ ...p, weekly: true }, week)).toBe(1)
    expect(suggestedQuantity({ ...p, weekly: true, lastPurchaseWeek: week }, week)).toBe(0)
    expect(suggestedQuantity({ ...p, kind: 'wish', weekly: true }, week)).toBe(0)
  })
  it('scopes manual exclusions to their Saturday', () => {
    const p = { ...blankProduct(), plannedWeek: week, plannedQuantity: 0 }
    expect(suggestedQuantity(p, week)).toBe(0)
    expect(suggestedQuantity(p, '2026-11-07')).toBe(1)
  })
  it('consumes actual stock and rejects negative, excessive and invalid use', () => {
    const eggs = { ...blankProduct(), stock: 8 }
    expect(consume(eggs, 2).stock).toBe(6)
    for (const value of [0, -1, 9, NaN, Infinity]) expect(() => consume(eggs, value)).toThrow()
  })
  it('atomically saves partial purchases and pack contents; repeating the receipt is idempotent', () => {
    const p = { ...blankProduct(), name: 'Huevo', stock: 8, target: 30, packSize: 30, step: 1 }
    const other = { ...blankProduct(), name: 'Arroz' }
    const state = { ...emptyHousehold(), budgetCents: 150000, products: [p, other] }
    const line: PurchaseLine = { id: p.id, name: p.name, quantity: 1, unit: 'paquete', priceCents: 7800, department: 'food', treat: false }
    const next = closePurchase(state, [line], week, 'receipt')
    expect(next.products[0].stock).toBe(38)
    expect(next.products[1].stock).toBe(0)
    expect(next.budgetCents).toBe(150000)
    expect(next.purchases[0].totalCents).toBe(7800)
    expect(closePurchase(next, [line], week, 'receipt')).toBe(next)
    expect(state.products[0].stock).toBe(8)
  })
  it('records fractional kg using rounded line cents and rejects duplicate products', () => {
    const p = { ...blankProduct(), name: 'Pollo' }
    const state = { ...emptyHousehold(), products: [p] }
    const line: PurchaseLine = { id: p.id, name: p.name, quantity: 1.25, unit: 'kg', priceCents: 12000, department: 'food', treat: false }
    expect(closePurchase(state, [line], week).purchases[0].totalCents).toBe(15000)
    expect(() => closePurchase(state, [line, line], week)).toThrow()
    expect(() => closePurchase(state, [], week)).toThrow()
    expect(() => closePurchase(state, [{ ...line, quantity: -1 }], week)).toThrow()
  })
  it('preserves free-text legacy quantity and total without inventing price or stock', () => {
    const old: NeedItem = { id: 'legacy', name: 'Pollo', category: 'home', priority: 'essential', frequency: 'weekly', isOnShoppingList: true, shoppingGroup: 'supermarket', isActive: true, quantity: '2 paquetes', estimatedAmountCents: 24000, createdAt: '', updatedAt: '' }
    const [p] = migrateLegacy([old])
    expect(p.id).toBe('legacy')
    expect(p.priceCents).toBeUndefined()
    expect(p.stock).toBe(0)
    expect(p.notes).toContain('2 paquetes')
    expect(p.notes).toContain('$240.00')
    expect(p.weekly).toBe(true)
  })
  it('validates all starter products and rejects malformed persisted data', () => {
    expect(householdSchema.safeParse({ ...emptyHousehold(), products: starterProducts() }).success).toBe(true)
    expect(householdSchema.safeParse({ ...emptyHousehold(), budgetCents: -1 }).success).toBe(false)
  })
})
