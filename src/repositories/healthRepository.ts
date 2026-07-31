import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { HealthLog } from '../types'

type Row = Database['public']['Tables']['health_logs']['Row']
type Insert = Database['public']['Tables']['health_logs']['Insert']

const fromRow = (row: Row): HealthLog => ({
  id: row.id,
  area: 'health',
  occurredAt: row.log_date,
  energy: row.energy ?? 7,
  foodQuality: row.food_quality ?? undefined,
  mood: row.mood ?? undefined,
  anxiety: row.anxiety ?? undefined,
  sleepHours: row.sleep_hours ?? undefined,
  movementMinutes: row.movement_minutes ?? undefined,
  trainingMinutes: row.training_minutes ?? undefined,
  meditationMinutes: row.meditation_minutes ?? undefined,
  weightKg: row.weight_kg ?? undefined,
  waterLiters: row.water_liters ?? undefined,
  notes: row.notes ?? undefined,
  archivedAt: row.archived_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toRow = (log: HealthLog, userId: string): Insert => ({
  id: log.id,
  user_id: userId,
  log_date: log.occurredAt.slice(0, 10),
  energy: log.energy,
  food_quality: log.foodQuality ?? null,
  mood: log.mood ?? null,
  anxiety: log.anxiety ?? null,
  sleep_hours: log.sleepHours ?? null,
  movement_minutes: log.movementMinutes ?? null,
  training_minutes: log.trainingMinutes ?? null,
  meditation_minutes: log.meditationMinutes ?? null,
  weight_kg: log.weightKg ?? null,
  water_liters: log.waterLiters ?? null,
  workout_completed: (log.trainingMinutes ?? 0) > 0,
  notes: log.notes ?? null,
  archived_at: log.archivedAt ?? null,
  created_at: log.createdAt,
  updated_at: log.updatedAt,
})

export const healthRepository = {
  async list(userId: string) {
    const { data, error } = await supabase.from('health_logs').select('*')
      .eq('user_id', userId).is('archived_at', null)
      .order('log_date', { ascending: false }).order('created_at', { ascending: false })
    if (error) throw error
    return data.map(fromRow)
  },
  async save(log: HealthLog, userId: string) {
    const { data, error } = await supabase.from('health_logs').upsert(toRow(log, userId), { onConflict: 'id' })
      .select().single()
    if (error) throw error
    return fromRow(data)
  },
  async saveMissing(logs: HealthLog[], userId: string) {
    if (!logs.length) return []
    const { data, error } = await supabase.from('health_logs').upsert(logs.map((log) => toRow(log, userId)), {
      onConflict: 'id',
      ignoreDuplicates: true,
    }).select()
    if (error) throw error
    return data.map(fromRow)
  },
  async remove(id: string, userId: string) {
    const { error } = await supabase.from('health_logs').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
} as const
