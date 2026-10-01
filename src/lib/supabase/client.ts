import { createClient } from '@supabase/supabase-js';
import { getFaroSessionStorage, isFaroTauriRuntime } from '../../core/platform/runtime';
import type { Database } from '../../types/database.types';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY.',
  );
}
export const supabase = createClient<Database>(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      autoRefreshToken: true,
      // Tauri desktop uses the same Supabase project and RLS identity. Its
      // native entry can provide an async Stronghold/Store adapter before
      // boot; WebView localStorage remains the compatible default.
      storage: getFaroSessionStorage(),
      detectSessionInUrl: !isFaroTauriRuntime(),
      persistSession: true,
    },
  },
);
