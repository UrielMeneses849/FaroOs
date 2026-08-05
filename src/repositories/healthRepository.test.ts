import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HealthLog } from '../types'

const single = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() => vi.fn(() => ({ single })))
const upsert = vi.hoisted(() => vi.fn(() => ({ select })))
const from = vi.hoisted(() => vi.fn(() => ({ upsert })))
vi.mock('../lib/supabase/client', () => ({ supabase: { from } }))

import { healthRepository } from './healthRepository'

const log: HealthLog = {
  id: 'new-id', area: 'health', occurredAt: '2026-08-04', energy: 7,
  weightKg: 85.1, createdAt: '2026-08-04T10:00:00Z', updatedAt: '2026-08-04T10:00:00Z',
}

describe('healthRepository', () => {
  beforeEach(() => vi.clearAllMocks())

  it('guarda por usuario y fecha para respetar el índice único', async () => {
    single.mockResolvedValue({ data: {
      id: 'new-id', user_id: 'user-1', log_date: '2026-08-04', energy: 7,
      food_quality: null, mood: null, anxiety: null, sleep_hours: null,
      movement_minutes: null, training_minutes: null, meditation_minutes: null,
      weight_kg: 85.1, water_liters: null, workout_completed: false, notes: null,
      archived_at: null, created_at: log.createdAt, updated_at: log.updatedAt,
    }, error: null })

    await healthRepository.save(log, 'user-1')

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', log_date: '2026-08-04' }), {
      onConflict: 'user_id,log_date',
    })
  })
})
