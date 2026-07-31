import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFaroStore } from '../store'
import type { HealthLog } from '../types'
import { useHealthRecords } from './useHealthRecords'

const repository = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  saveMissing: vi.fn(),
  remove: vi.fn(),
}))
const authUser = vi.hoisted(() => ({ id: 'user-1' }))

vi.mock('../repositories/healthRepository', () => ({ healthRepository: repository }))
vi.mock('./auth', () => ({ useAuth: () => ({ user: authUser }) }))

const localLog: HealthLog = {
  id: 'local-health-log',
  area: 'health',
  occurredAt: '2026-07-30',
  energy: 7,
  weightKg: 84.5,
  foodQuality: 'good',
  createdAt: '2026-07-30T14:00:00.000Z',
  updatedAt: '2026-07-30T14:00:00.000Z',
}

describe('sincronización de salud', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useFaroStore.setState({ healthLogs: [localLog] })
  })

  it('recupera un registro local ausente en Supabase sin sobrescribir datos remotos', async () => {
    repository.list.mockResolvedValueOnce([]).mockResolvedValueOnce([localLog])
    repository.saveMissing.mockResolvedValue([localLog])

    const { result } = renderHook(() => useHealthRecords())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(repository.saveMissing).toHaveBeenCalledWith([localLog], 'user-1')
    expect(result.current.logs).toEqual([localLog])
    expect(useFaroStore.getState().healthLogs).toEqual([localLog])
  })

  it('solo actualiza el respaldo local después de guardar correctamente en Supabase', async () => {
    repository.list.mockResolvedValue([localLog])
    repository.saveMissing.mockResolvedValue([])
    const updated = { ...localLog, weightKg: 84.1, updatedAt: '2026-07-31T10:00:00.000Z' }
    repository.save.mockResolvedValue(updated)

    const { result } = renderHook(() => useHealthRecords())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await result.current.save(updated) })

    expect(repository.save).toHaveBeenCalledWith(updated, 'user-1')
    expect(result.current.logs[0]).toEqual(updated)
    expect(useFaroStore.getState().healthLogs[0]).toEqual(updated)
  })
})
