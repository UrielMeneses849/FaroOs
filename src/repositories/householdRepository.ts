import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase/client'
import type { Database, Json } from '../types/database.types'
import { householdSchema, type Household } from '../features/needs/household'

// Keep the new schema additive to the generated database types.
type HouseholdDatabase = Omit<Database, 'public'> & { public: Omit<Database['public'], 'Tables' | 'Functions'> & {
  Tables: Database['public']['Tables'] & { needs_households: {
    Row: { user_id: string; revision: number; data: Json; updated_at: string }
    Insert: { user_id: string; revision?: number; data: Json; updated_at?: string }
    Update: { revision?: number; data?: Json; updated_at?: string }
    Relationships: []
  } }
  Functions: Database['public']['Functions'] & { save_needs_household: { Args: { expected_revision: number; document: Json }; Returns: number } }
} }
const client = supabase as unknown as SupabaseClient<HouseholdDatabase>
export const householdRepository = {
  async load(userId: string) {
    const { data, error } = await client.from('needs_households').select('revision,data').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data ? { revision: data.revision, state: householdSchema.parse(data.data) } : null
  },
  async save(state: Household, revision: number) {
    const validated = householdSchema.parse(state)
    const { data, error } = await client.rpc('save_needs_household', { expected_revision: revision, document: validated as unknown as Json })
    if (error) throw error
    return data
  },
}
