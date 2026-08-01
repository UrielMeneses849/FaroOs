import { supabase } from '../lib/supabase/client'
import { pendingActionSchema, voiceResponseSchema, voiceActionSchema, type PendingVoiceAction } from '../features/voice/voiceSchemas'

async function invoke(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('faro-voice', { body })
  if (error) throw new Error(error.message)
  return voiceResponseSchema.parse(data)
}

export const voiceService = {
  health() {
    return invoke({ type: 'health' })
  },
  send(message: string, source: 'text' | 'voice' = 'text') {
    return invoke(voiceActionSchema.parse({ requestId: crypto.randomUUID(), source, message }))
  },
  confirm(action: PendingVoiceAction) {
    return invoke({ type: 'confirm', action: pendingActionSchema.parse(action) })
  },
  cancel(action: PendingVoiceAction) {
    return invoke({ type: 'cancel', action: pendingActionSchema.parse(action) })
  },
  async createRealtimeSession(sdp: string) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Tu sesión de FARO expiró.')
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/faro-realtime-session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/sdp',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: sdp,
    })
    if (!response.ok) throw new Error(await response.text())
    return response.text()
  },
}
