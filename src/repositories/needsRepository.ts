import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { NeedItem, NeedPriceObservation, NeedPriceReceiptDraft, NeedsCategory } from '../features/needs/needsTypes'

type Row = Database['public']['Tables']['needs_items']['Row']
type Insert = Database['public']['Tables']['needs_items']['Insert']
type CategoryRow = Database['public']['Tables']['needs_categories']['Row']
type PriceRow = Database['public']['Tables']['needs_price_observations']['Row']
type ReceiptRow = Database['public']['Tables']['needs_purchase_receipts']['Row']

const fromRow = (row: Row): NeedItem => ({
  id: row.id,
  name: row.name,
  category: row.category as NeedItem['category'],
  categoryId: row.category_id ?? undefined,
  shoppingGroup: row.shopping_group as NeedItem['shoppingGroup'],
  priority: row.priority as NeedItem['priority'],
  frequency: row.frequency as NeedItem['frequency'],
  isOnShoppingList: row.is_on_shopping_list,
  nextNeededOn: row.next_needed_on ?? undefined,
  quantity: row.quantity ?? undefined,
  estimatedAmountCents: row.estimated_amount == null ? undefined : Math.round(Number(row.estimated_amount) * 100),
  notes: row.notes ?? undefined,
  isActive: row.is_active,
  lastCompletedAt: row.last_completed_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const categoryFromRow = (row: CategoryRow): NeedsCategory => ({
  id: row.id,
  name: row.name,
  shoppingGroup: row.shopping_group as NeedsCategory['shoppingGroup'],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const priceFromRow = (row: PriceRow, receipt?: ReceiptRow): NeedPriceObservation => ({
  id: row.id,
  receiptId: row.receipt_id,
  needItemId: row.need_item_id ?? undefined,
  canonicalName: row.canonical_name,
  sourceName: row.source_name,
  presentation: row.presentation ?? undefined,
  amountCents: Math.round(Number(row.amount) * 100),
  observedOn: row.observed_on,
  storeName: receipt?.store_name ?? undefined,
  createdAt: row.created_at,
})

const toRow = (item: NeedItem, userId: string): Insert => ({
  id: item.id,
  user_id: userId,
  name: item.name.trim(),
  category: item.category,
  category_id: item.categoryId ?? null,
  shopping_group: item.shoppingGroup,
  priority: item.priority,
  frequency: item.frequency,
  is_on_shopping_list: item.isOnShoppingList,
  next_needed_on: item.nextNeededOn ?? null,
  quantity: item.quantity?.trim() || null,
  estimated_amount: item.estimatedAmountCents == null ? null : item.estimatedAmountCents / 100,
  notes: item.notes?.trim() || null,
  is_active: item.isActive,
  last_completed_at: item.lastCompletedAt ?? null,
  created_at: item.createdAt,
  updated_at: item.updatedAt,
})

export const needsRepository = {
  async list(userId: string) {
    const { data, error } = await supabase.from('needs_items').select('*')
      .eq('user_id', userId).eq('is_active', true)
    if (error) throw error
    return (data ?? []).map(fromRow)
  },
  async save(item: NeedItem, userId: string) {
    const { data, error } = await supabase.from('needs_items').upsert(toRow(item, userId), { onConflict: 'id' })
      .select().single()
    if (error) throw error
    return fromRow(data)
  },
  async remove(id: string, userId: string) {
    const { error } = await supabase.from('needs_items').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
} as const

export const needsCategoryRepository = {
  async list(userId: string) {
    const { data, error } = await supabase.from('needs_categories').select('*')
      .eq('user_id', userId).order('name')
    if (error) throw error
    return (data ?? []).map(categoryFromRow)
  },
  async save(item: NeedsCategory, userId: string) {
    const { data, error } = await supabase.from('needs_categories').upsert({
      id: item.id,
      user_id: userId,
      name: item.name.trim(),
      shopping_group: item.shoppingGroup,
    }, { onConflict: 'id' }).select().single()
    if (error) throw error
    return categoryFromRow(data)
  },
  async remove(id: string, userId: string) {
    const { error } = await supabase.from('needs_categories').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
} as const

export const needsPriceMemoryRepository = {
  async list(userId: string) {
    const [{ data: prices, error: priceError }, { data: receipts, error: receiptError }] = await Promise.all([
      supabase.from('needs_price_observations').select('*').eq('user_id', userId).order('observed_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('needs_purchase_receipts').select('*').eq('user_id', userId),
    ])
    if (priceError) throw priceError
    if (receiptError) throw receiptError
    const receiptsById = new Map((receipts ?? []).map((receipt) => [receipt.id, receipt]))
    return (prices ?? []).map((price) => priceFromRow(price, receiptsById.get(price.receipt_id)))
  },
  async recordReceipt(draft: NeedPriceReceiptDraft, userId: string) {
    const remembered = draft.lines.filter((line) => line.remember && line.canonicalName.trim() && Number.isFinite(line.amountCents) && line.amountCents >= 0)
    if (!remembered.length) throw new Error('Selecciona al menos un precio que quieras recordar.')
    const totalCents = remembered.reduce((sum, line) => sum + line.amountCents, 0)
    const { data: receipt, error: receiptError } = await supabase.from('needs_purchase_receipts').insert({
      user_id: userId,
      store_name: draft.storeName?.trim() || null,
      purchased_on: draft.purchasedOn,
      source_file_name: draft.sourceFileName?.trim() || null,
      total_amount: totalCents / 100,
    }).select().single()
    if (receiptError) throw receiptError
    const { data: prices, error: priceError } = await supabase.from('needs_price_observations').insert(remembered.map((line) => ({
      user_id: userId,
      receipt_id: receipt.id,
      need_item_id: line.needItemId ?? null,
      canonical_name: line.canonicalName.trim(),
      source_name: line.sourceName.trim(),
      presentation: line.presentation?.trim() || null,
      amount: line.amountCents / 100,
      observed_on: draft.purchasedOn,
    }))).select()
    if (priceError) throw priceError
    return (prices ?? []).map((price) => priceFromRow(price, receipt))
  },
} as const
