import type { PendingVoiceAction } from './voiceSchemas'

export const FARO_VOICE_PRODUCTION_ENABLED = true

export type FaroVoiceSurface = 'dashboard' | 'today' | 'finances'
export type FaroVoiceVisualState = 'ready' | 'listening' | 'understanding' | 'consulting' | 'awaiting_confirmation' | 'executing' | 'speaking' | 'error'

export interface FaroVoiceSnapshot {
  state: FaroVoiceVisualState
  /** Presentation only: the existing Voice session is waiting for its wake phrase. */
  waitingForWake?: boolean
  inputStatus?: 'opening' | 'connecting' | 'active'
  pendingAction?: PendingVoiceAction
  feedback?: string
  /** Current speech-to-text fragment shown only in FARO Mini; it is transient and never persisted. */
  transcript?: string
  /** Transient, normalized local microphone level. Never persisted or traced. */
  audioLevel?: number
  wakeState?: 'unavailable' | 'loading' | 'standby' | 'detected' | 'error'
}
