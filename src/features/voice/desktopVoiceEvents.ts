import type { FaroVoiceSnapshot } from './faroVoiceConfig'

export const FARO_VOICE_SNAPSHOT_EVENT = 'faro:voice-snapshot'
export const FARO_VOICE_ACTION_EVENT = 'faro:voice-action'
export const FARO_VOICE_TRANSCRIPT_EVENT = 'faro:voice-transcript'
export const FARO_DESKTOP_NAVIGATE_EVENT = 'faro:desktop-navigate'
export const FARO_LOCAL_WAKE_EVENT = 'faro:local-wake'
export const FARO_VOICE_PANEL_OPENED_EVENT = 'faro:voice-panel-opened'
export const FARO_VOICE_SESSION_ENDED_EVENT = 'faro:voice-session-ended'

export type FaroDesktopVoiceAction = 'open' | 'open_and_listen' | 'confirm' | 'cancel' | 'stop_listening' | 'close_assistant' | 'pause_focus' | 'finish_focus'

export function publishFaroVoiceSnapshot(snapshot: FaroVoiceSnapshot) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<FaroVoiceSnapshot>(FARO_VOICE_SNAPSHOT_EVENT, { detail: snapshot }))
}
