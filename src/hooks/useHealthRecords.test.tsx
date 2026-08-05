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

  it('sincroniza el respaldo local y Supabase al guardar correctamente', async () => {
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

  it('conserva localmente una captura cuando Supabase falla', async () => {
    repository.list.mockResolvedValue([localLog])
    repository.saveMissing.mockResolvedValue([])
    repository.save.mockRejectedValue({ message: 'Sin conexión con Supabase.' })
    const pending = { ...localLog, id: 'health-1722800000000', weightKg: 86, updatedAt: '2026-08-04T10:00:00.000Z' }

    const { result } = renderHook(() => useHealthRecords())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => { await expect(result.current.save(pending)).resolves.toEqual(pending) })

    expect(result.current.logs).toContainEqual(pending)
    expect(useFaroStore.getState().healthLogs).toContainEqual(pending)
    expect(result.current.error).toBe('Sin conexión con Supabase.')
  })

  it('replica por fecha una captura local más reciente aunque tenga otro id', async () => {
    const remote = { ...localLog, weightKg: 84.5, updatedAt: '2026-07-30T14:00:00.000Z' }
    const local = { ...localLog, id: 'another-local-id', weightKg: 86, updatedAt: '2026-08-04T10:00:00.000Z' }
    useFaroStore.setState({ healthLogs: [local] })
    repository.list.mockResolvedValueOnce([remote]).mockResolvedValueOnce([local])
    repository.saveMissing.mockResolvedValue([local])

    const { result } = renderHook(() => useHealthRecords())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(repository.saveMissing).toHaveBeenCalledWith([local], 'user-1')
    expect(result.current.logs).toEqual([local])
  })
})
