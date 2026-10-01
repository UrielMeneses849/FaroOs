import { scanDesktopStorage } from '../../desktop/desktopBridge'
import type { StorageOverview } from './storageTypes'

const CACHE_MS = 60_000
let cached: StorageOverview | undefined
let cachedAt = 0
let pending: Promise<StorageOverview | undefined> | undefined

export function readStorageScan(force = false): Promise<StorageOverview | undefined> {
  if (pending) return pending
  if (!force && cached && Date.now() - cachedAt < CACHE_MS) return Promise.resolve(cached)
  cached = undefined
  pending = scanDesktopStorage().then((result) => {
    cached = result ?? undefined
    cachedAt = Date.now()
    return cached
  }).finally(() => { pending = undefined })
  return pending
}
