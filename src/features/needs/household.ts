import { format, addDays, startOfDay } from 'date-fns'
import { z } from 'zod'
import type { NeedItem } from './needsTypes'

export const departments = { food: 'Comida', care: 'Cuidado personal', home: 'Hogar', pet: 'Mascotas', personal: 'Personal', life: 'Calidad de vida', other: 'Otro' } as const
const nonnegative = z.number().finite().nonnegative()
export const productSchema = z.object({
  id: z.string(), name: z.string().trim().min(1).max(120),
  department: z.enum(['food', 'care', 'home', 'pet', 'personal', 'life', 'other']),
  kind: z.enum(['stock', 'wish']), treat: z.boolean(), mode: z.enum(['quantity', 'status']),
  stock: nonnegative, target: nonnegative, unit: z.string().trim().min(1).max(30),
  status: z.enum(['available', 'low', 'empty']), purchaseUnit: z.string().trim().min(1).max(30),
  packSize: z.number().finite().positive(), step: z.number().finite().positive(),
  priceCents: nonnegative.int().optional(), weekly: z.boolean(), weeklyQuantity: nonnegative,
  lastPurchaseWeek: z.string().optional(), plannedWeek: z.string().optional(), plannedQuantity: nonnegative.optional(),
  notes: z.string().max(2000),
})
export type Product = z.infer<typeof productSchema>
export const purchaseLineSchema = z.object({ id: z.string(), name: z.string(), department: productSchema.shape.department, treat: z.boolean(), quantity: z.number().finite().positive(), unit: z.string(), priceCents: nonnegative.int() })
export type PurchaseLine = z.infer<typeof purchaseLineSchema>
export const householdSchema = z.object({
  products: z.array(productSchema), budgetCents: nonnegative.int().nullable(),
  budgets: z.record(z.string(), nonnegative.int()),
  purchases: z.array(z.object({ id: z.string(), at: z.string(), week: z.string(), totalCents: nonnegative.int(), lines: z.array(purchaseLineSchema) })),
  importedLegacy: z.boolean(),
})
export type Household = z.infer<typeof householdSchema>
export const emptyHousehold = (): Household => ({ products: [], budgetCents: null, budgets: {}, purchases: [], importedLegacy: false })
export const pesos = (cents: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100)
export function shoppingSaturday(now = new Date()) {
  const date = startOfDay(now)
  return format(addDays(date, (6 - date.getDay() + 7) % 7), 'yyyy-MM-dd')
}
export function blankProduct(): Product {
  return { id: crypto.randomUUID(), name: '', department: 'food', kind: 'stock', treat: false, mode: 'quantity', stock: 0, target: 1, unit: 'kg', status: 'empty', purchaseUnit: 'kg', packSize: 1, step: 0.1, weekly: false, weeklyQuantity: 1, notes: '' }
}
const round = (n: number) => Math.round(n * 1e6) / 1e6
export function suggestedQuantity(p: Product, week: string) {
  if (p.kind === 'wish') return 0
  if (p.plannedWeek === week && p.plannedQuantity !== undefined) return p.plannedQuantity
  const deficit = p.mode === 'quantity' ? Math.max(0, p.target - p.stock) / p.packSize : p.status === 'available' ? 0 : p.weeklyQuantity
  const weekly = p.weekly && p.lastPurchaseWeek !== week ? p.weeklyQuantity : 0
  return Math.max(0, round(Math.ceil((Math.max(deficit, weekly) - 1e-9) / p.step) * p.step))
}
export function consume(p: Product, amount: number): Product {
  if (!Number.isFinite(amount) || amount <= 0 || amount > p.stock) throw new Error('Indica una cantidad mayor a cero y menor o igual a las existencias.')
  return { ...p, stock: round(p.stock - amount) }
}
export function closePurchase(state: Household, lines: PurchaseLine[], week: string, id: string = crypto.randomUUID()): Household {
  if (!lines.length) throw new Error('Selecciona al menos un producto comprado.')
  if (state.purchases.some(p => p.id === id)) return state
  const parsed = lines.map(line => purchaseLineSchema.parse(line))
  if (new Set(parsed.map(line => line.id)).size !== parsed.length) throw new Error('Hay productos repetidos en la compra.')
  const products = state.products.map(p => {
    const line = parsed.find(l => l.id === p.id)
    if (!line) return p
    return { ...p, kind: 'stock' as const, stock: round(p.stock + line.quantity * p.packSize), status: 'available' as const, priceCents: line.priceCents, lastPurchaseWeek: week, plannedWeek: undefined, plannedQuantity: undefined }
  })
  if (parsed.some(line => !products.some(p => p.id === line.id))) throw new Error('La lista cambió. Vuelve a revisar la compra.')
  return { ...state, products, purchases: [{ id, at: new Date().toISOString(), week, lines: parsed, totalCents: parsed.reduce((sum, line) => sum + Math.round(line.quantity * line.priceCents), 0) }, ...state.purchases] }
}
export function migrateLegacy(items: NeedItem[]): Product[] {
  return items.map(item => {
    // Legacy quantities and amounts were free text / line totals: preserve them
    // in notes instead of guessing a unit price or inventing physical stock.
    const p = blankProduct()
    return { ...p, id: item.id, name: item.name, department: item.shoppingGroup === 'supermarket' ? 'food' as const : item.shoppingGroup === 'pharmacy' ? 'care' as const : item.category === 'big_purchase' ? 'life' as const : item.category === 'cat' ? 'pet' as const : item.category === 'personal' ? 'personal' as const : 'home' as const,
      kind: item.frequency === 'one_time' && !item.isOnShoppingList ? 'wish' as const : 'stock' as const,
      mode: 'status' as const, unit: 'pza', purchaseUnit: 'pza', step: 1, status: item.isOnShoppingList ? 'empty' as const : 'available' as const,
      weekly: item.frequency === 'weekly', plannedWeek: item.isOnShoppingList ? shoppingSaturday() : undefined, plannedQuantity: item.isOnShoppingList ? 1 : undefined,
      notes: [item.notes, item.quantity ? `Cantidad anterior: ${item.quantity}` : '', item.estimatedAmountCents != null ? `Estimado anterior por artículo: ${pesos(item.estimatedAmountCents)}` : '', `Frecuencia anterior: ${item.frequency}`, item.nextNeededOn ? `Próxima fecha anterior: ${item.nextNeededOn}` : ''].filter(Boolean).join('\n').slice(0, 2000) }
  })
}
export function starterProducts(): Product[] {
  return ['Arroz', 'Pechuga de pollo', 'Muslos de pollo', 'Carne de res', 'Carne molida', 'Frijoles enteros', 'Atún', 'Aceite', 'Huevo', 'Aguacate', 'Cebolla', 'Ajo', 'Pimiento morrón'].map(name => {
    const p = blankProduct()
    const unit = name === 'Huevo' || name === 'Ajo' ? 'pza' : name === 'Atún' ? 'lata' : name === 'Aceite' ? 'L' : 'kg'
    return { ...p, name, unit, purchaseUnit: unit, step: ['pza', 'lata'].includes(unit) ? 1 : 0.1, target: name === 'Huevo' ? 12 : 1 }
  })
}
