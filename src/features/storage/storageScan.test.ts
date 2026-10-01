import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageOverview } from './storageTypes'

const scan = vi.hoisted(() => vi.fn())
vi.mock('../../desktop/desktopBridge', () => ({ scanDesktopStorage: scan }))

beforeEach(() => { vi.resetModules(); scan.mockReset() })

describe('Storage scan reuse', () => {
  it('shares an in-flight scan and reuses it when navigating back', async () => {
    const result = { scannedAt: 123 } as StorageOverview
    let resolve!: (value: StorageOverview) => void
    scan.mockReturnValue(new Promise<StorageOverview>((done) => { resolve = done }))
    const { readStorageScan } = await import('./storageScan')
    const first = readStorageScan()
    expect(readStorageScan()).toBe(first)
    resolve(result)
    expect(await first).toBe(result)
    expect(await readStorageScan()).toBe(result)
    expect(scan).toHaveBeenCalledTimes(1)
  })

  it('rescans explicitly after mutations and does not reuse results on failure', async () => {
    scan.mockResolvedValueOnce({ scannedAt: 1 }).mockRejectedValueOnce(new Error('Disk unavailable')).mockResolvedValueOnce({ scannedAt: 2 })
    const { readStorageScan } = await import('./storageScan')
    await readStorageScan()
    await expect(readStorageScan(true)).rejects.toThrow('Disk unavailable')
    expect(await readStorageScan()).toEqual({ scannedAt: 2 })
    expect(scan).toHaveBeenCalledTimes(3)
  })

  it('expires cached results after a minute', async () => {
    const clock = vi.spyOn(Date, 'now')
    clock.mockReturnValue(100_000)
    scan.mockResolvedValue({ scannedAt: 1 })
    const { readStorageScan } = await import('./storageScan')
    await readStorageScan()
    clock.mockReturnValue(160_001)
    await readStorageScan()
    expect(scan).toHaveBeenCalledTimes(2)
    clock.mockRestore()
  })
})
