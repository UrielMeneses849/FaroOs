import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { needsCategoryRepository, needsPriceMemoryRepository, needsRepository } from '../repositories/needsRepository'
import { nextNeedDate, sortNeeds, type NeedItem, type NeedPriceObservation, type NeedPriceReceiptDraft, type NeedsCategory } from '../features/needs/needsTypes'
import { useAuth } from './auth'

const errorMessage = (reason: unknown) => reason instanceof Error ? reason.message : 'No se pudieron guardar tus necesidades.'

const localPricesKey = (userId: string) => `faro.needs.learned-prices.${userId}`

const readLocalPrices = (userId: string): NeedPriceObservation[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(localPricesKey(userId)) ?? '[]')
    return Array.isArray(stored) ? stored as NeedPriceObservation[] : []
  } catch { return [] }
}

const writeLocalPrices = (userId: string, observations: NeedPriceObservation[]) => {
  try { localStorage.setItem(localPricesKey(userId), JSON.stringify(observations)) } catch { /* storage is only a resilient fallback */ }
}

const syncLocalPriceMemory = async (userId: string) => {
  const pending = readLocalPrices(userId)
  if (!pending.length) return [] as NeedPriceObservation[]
  const byReceipt = new Map<string, NeedPriceObservation[]>()
  pending.forEach((observation) => byReceipt.set(observation.receiptId, [...(byReceipt.get(observation.receiptId) ?? []), observation]))
  const synced: NeedPriceObservation[] = []
  const remaining = new Set(pending.map((observation) => observation.id))
  for (const observations of byReceipt.values()) {
    const first = observations[0]
    try {
      const saved = await needsPriceMemoryRepository.recordReceipt({
        storeName: first.storeName,
        purchasedOn: first.observedOn,
        lines: observations.map((observation) => ({
          sourceName: observation.sourceName,
          canonicalName: observation.canonicalName,
          needItemId: observation.needItemId,
          presentation: observation.presentation,
          amountCents: observation.amountCents,
          remember: true,
        })),
      }, userId)
      synced.push(...saved)
      observations.forEach((observation) => remaining.delete(observation.id))
    } catch { break }
  }
  if (synced.length) writeLocalPrices(userId, pending.filter((observation) => remaining.has(observation.id)))
  return synced
}

export function useNeeds() {
  const { user } = useAuth()
  const [items, setItems] = useState<NeedItem[]>([])
  const [categories, setCategories] = useState<NeedsCategory[]>([])
  const [priceObservations, setPriceObservations] = useState<NeedPriceObservation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (!user) { setItems([]); setCategories([]); setPriceObservations([]); setLoading(false); return }
    setLoading(true); setError(undefined)
    try {
      const [nextItems, nextCategories] = await Promise.all([
        needsRepository.list(user.id),
        needsCategoryRepository.list(user.id),
      ])
      setItems(sortNeeds(nextItems)); setCategories(nextCategories)
      // A local copy keeps the private price memory useful if the user is
      // offline or a desktop build is opened while a schema migration arrives.
      const nextPriceObservations = await needsPriceMemoryRepository.list(user.id)
        .then(async (remote) => [...await syncLocalPriceMemory(user.id), ...remote])
        .catch(() => readLocalPrices(user.id))
      setPriceObservations(nextPriceObservations)
    }
    catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }, [user])

  useEffect(() => { queueMicrotask(() => void refresh()) }, [refresh])

  const save = async (item: NeedItem) => {
    if (!user) throw new Error('No hay una sesión activa.')
    const saved = await needsRepository.save(item, user.id)
    setItems((current) => sortNeeds([saved, ...current.filter((candidate) => candidate.id !== saved.id)]))
    setError(undefined)
    return saved
  }

  const addToShoppingList = async (item: NeedItem) => save({
    ...item,
    isOnShoppingList: true,
    updatedAt: new Date().toISOString(),
  })

  const completeShoppingItem = async (item: NeedItem) => {
    const today = format(new Date(), 'yyyy-MM-dd')
    const saved = await save({
      ...item,
      isActive: item.frequency !== 'one_time',
      isOnShoppingList: false,
      lastCompletedAt: new Date().toISOString(),
      nextNeededOn: item.frequency === 'as_needed' ? undefined : nextNeedDate(today, item.frequency),
      updatedAt: new Date().toISOString(),
    })
    // A one-off is no longer a live need after it is resolved. It remains in
    // the database as inactive history, but leaves this everyday list now.
    if (item.frequency === 'one_time') setItems((current) => current.filter((candidate) => candidate.id !== item.id))
    return saved
  }

  const remove = async (id: string) => {
    if (!user) throw new Error('No hay una sesión activa.')
    await needsRepository.remove(id, user.id)
    setItems((current) => current.filter((item) => item.id !== id))
    setError(undefined)
  }

  const saveCategory = async (category: NeedsCategory) => {
    if (!user) throw new Error('No hay una sesión activa.')
    const saved = await needsCategoryRepository.save(category, user.id)
    setCategories((current) => [...current.filter((item) => item.id !== saved.id), saved]
      .sort((left, right) => left.name.localeCompare(right.name, 'es')))
    return saved
  }

  const removeCategory = async (id: string) => {
    if (!user) throw new Error('No hay una sesión activa.')
    await needsCategoryRepository.remove(id, user.id)
    setCategories((current) => current.filter((item) => item.id !== id))
    setItems((current) => current.map((item) => item.categoryId === id ? { ...item, categoryId: undefined } : item))
  }

  const rememberReceiptPrices = async (draft: NeedPriceReceiptDraft) => {
    if (!user) throw new Error('No hay una sesión activa.')
    const saved = await needsPriceMemoryRepository.recordReceipt(draft, user.id).catch(() => {
      const receiptId = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const local = draft.lines.filter((line) => line.remember && line.canonicalName.trim()).map((line) => ({
        id: crypto.randomUUID(), receiptId, needItemId: line.needItemId, canonicalName: line.canonicalName.trim(), sourceName: line.sourceName.trim(),
        presentation: line.presentation?.trim() || undefined, amountCents: line.amountCents, observedOn: draft.purchasedOn,
        storeName: draft.storeName?.trim() || undefined, createdAt,
      }))
      const next = [...local, ...readLocalPrices(user.id)]
      writeLocalPrices(user.id, next)
      return local
    })
    setPriceObservations((current) => [...saved, ...current])
    return saved
  }

  return { items, categories, priceObservations, loading, error, refresh, save, addToShoppingList, completeShoppingItem, remove, saveCategory, removeCategory, rememberReceiptPrices }
}
