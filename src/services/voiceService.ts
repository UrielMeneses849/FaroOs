import { supabase } from '../lib/supabase/client'
import {
  pendingActionSchema,
  voiceResponseSchema,
  voiceActionSchema,
  type PendingVoiceAction,
  type VoiceConversationTurn,
  type VoicePipeline,
  type VoiceSessionContext,
  type VoiceTrace,
} from '../features/voice/voiceSchemas'
import type { FaroVoiceSurface } from '../features/voice/faroVoiceConfig'
import { normalizeCalendarData } from './calendarService'
import { useFaroStore } from '../store/useFaroStore'

export function getVoiceCalendarSnapshot() {
  const { tasks, projects, goals } = useFaroStore.getState()
  return normalizeCalendarData({ tasks, projects, goals })
    .filter((item) => item.sourceType === 'task')
    .slice(0, 250)
    .map((item) => ({
      id: item.sourceId,
      kind: 'task' as const,
      title: item.title,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      workspaceId: item.workspaceId,
    }))
}

async function invoke(body: Record<string, unknown>) {
  let result = await supabase.functions.invoke('faro-voice', { body })
  for (let attempt = 0; result.error && attempt < 2; attempt += 1) {
    const context = 'context' in result.error ? result.error.context : undefined
    const retryableStatus = context instanceof Response && [408, 429, 502, 503, 504].includes(context.status)
    const retryableMessage = /failed to send|fetch|network|timeout|temporar/i.test(result.error.message)
    if (!retryableStatus && !retryableMessage) break
    await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)))
    result = await supabase.functions.invoke('faro-voice', { body })
  }
  const { data, error } = result
  if (error) {
    const context = 'context' in error ? error.context : undefined
    if (context instanceof Response) {
      try {
        const payload = await context.clone().json() as { message?: unknown }
        if (typeof payload.message === 'string' && payload.message) throw new Error(payload.message)
      } catch (cause) {
        if (cause instanceof Error && !(cause instanceof SyntaxError)) throw cause
      }
    }
    throw new Error(error.message)
  }
  return voiceResponseSchema.parse(data)
}

export const voiceService = {
  health() {
    return invoke({ type: 'health' })
  },
  send(message: string, source: 'text' | 'voice' = 'text', history: VoiceConversationTurn[] = [], surface: FaroVoiceSurface | 'lab' = 'lab', options: {
    requestId?: string
    sessionId?: string
    pipeline?: VoicePipeline
    sessionContext?: VoiceSessionContext
    trace?: VoiceTrace
  } = {}) {
    return invoke(voiceActionSchema.parse({
      requestId: options.requestId ?? crypto.randomUUID(),
      sessionId: options.sessionId,
      source,
      message,
      history,
      surface,
      pipeline: options.pipeline,
      sessionContext: options.sessionContext,
      trace: options.trace,
      localContext: {
        now: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City',
        calendarItems: getVoiceCalendarSnapshot(),
      },
    }))
  },
  confirm(action: PendingVoiceAction) {
    const parsed = pendingActionSchema.parse(action)
    return invoke({ type: 'confirm', requestId: parsed.requestId })
  },
  cancel(action: PendingVoiceAction) {
    const parsed = pendingActionSchema.parse(action)
    return invoke({ type: 'cancel', requestId: parsed.requestId })
  },
  revise(action: PendingVoiceAction) {
    const parsed = pendingActionSchema.parse(action)
    if (['createCalendarEvent', 'createScheduledTask', 'updateCalendarEvent'].includes(parsed.toolName)) {
      return invoke({ type: 'revise', requestId: parsed.requestId, title: parsed.arguments.title })
    }
    const value = parsed.arguments.actualAmount ?? parsed.arguments.amount
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('El nuevo monto no es válido.')
    return invoke({ type: 'revise', requestId: parsed.requestId, amount: value })
  },
  async telemetry(requestId: string, timings: Record<string, number>, providerMetadata: Record<string, unknown> = {}) {
    try {
      await invoke({ type: 'telemetry', requestId, timings, providerMetadata })
    } catch (error) {
      if (import.meta.env.DEV) console.debug('[FARO Voice] telemetry failed', error)
    }
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
