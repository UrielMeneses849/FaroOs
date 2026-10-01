import { supabase } from '../../lib/supabase/client'

export const SUPABASE_FREE_DATABASE_LIMIT_BYTES = 500 * 1024 * 1024

export type SupabaseCapacityHealth = 'calm' | 'attention' | 'warning' | 'critical'

export interface SupabaseDatabaseCapacity {
  databaseBytes: number
  limitBytes: number
  measuredAt: string
  health: SupabaseCapacityHealth
}

function capacityHealth(databaseBytes: number, limitBytes: number): SupabaseCapacityHealth {
  const ratio = databaseBytes / Math.max(1, limitBytes)
  if (ratio >= .9) return 'critical'
  if (ratio >= .8) return 'warning'
  if (ratio >= .7) return 'attention'
  return 'calm'
}

/**
 * The database size is deliberately calculated by Postgres, not guessed from
 * row counts. It is project-wide capacity; no table contents leave Supabase.
 */
export async function getSupabaseDatabaseCapacity(): Promise<SupabaseDatabaseCapacity> {
  const { data, error } = await supabase.rpc('faro_database_capacity')
  if (error) throw error
  const payload = data as { databaseBytes?: unknown; measuredAt?: unknown } | null
  const databaseBytes = Number(payload?.databaseBytes)
  if (!Number.isFinite(databaseBytes) || databaseBytes < 0) throw new Error('Supabase no devolvió una medida válida de base de datos.')
  return {
    databaseBytes,
    limitBytes: SUPABASE_FREE_DATABASE_LIMIT_BYTES,
    measuredAt: typeof payload?.measuredAt === 'string' ? payload.measuredAt : new Date().toISOString(),
    health: capacityHealth(databaseBytes, SUPABASE_FREE_DATABASE_LIMIT_BYTES),
  }
}
