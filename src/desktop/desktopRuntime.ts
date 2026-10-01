import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { router } from '../app/router'
import { getConfiguredFaroVoiceAdapters, type LocalWakeState } from '../core/voice/adapters'
import { FARO_DESKTOP_NAVIGATE_EVENT, FARO_LOCAL_WAKE_EVENT, FARO_VOICE_ACTION_EVENT, FARO_VOICE_PANEL_OPENED_EVENT, FARO_VOICE_SESSION_ENDED_EVENT, FARO_VOICE_SNAPSHOT_EVENT, FARO_VOICE_TRANSCRIPT_EVENT, type FaroDesktopVoiceAction } from '../features/voice/desktopVoiceEvents'
import type { FaroVoiceSnapshot } from '../features/voice/faroVoiceConfig'
import { getDesktopPreferences, publishFaroDesktopVoiceSnapshot, showFaroMini, updateDesktopPreferences } from './desktopBridge'

let installed = false
let voiceReady = false
// The stored local model belongs to the old “Hola FARO” enrollment flow. It
// cannot recognize the new one-word wake reliably, so it must not claim the
// microphone before FARO Mini starts its Realtime listener.
let wakeEnabled = false
let wakeState: LocalWakeState = 'unavailable'

function publishWakeSnapshot(patch: Pick<FaroVoiceSnapshot, 'audioLevel' | 'wakeState' | 'state'>) {
  void publishFaroDesktopVoiceSnapshot(patch).catch(() => undefined)
}

async function startDesktopWake() {
  const wake = getConfiguredFaroVoiceAdapters().wake?.localWake
  if (!voiceReady || !wakeEnabled || !wake || wake.isListening()) return
  const available = await wake.isAvailable().catch(() => false)
  if (!available) { wakeState = 'unavailable'; publishWakeSnapshot({ state: 'ready', wakeState }); return }
  await wake.start({
    onState: (state) => { wakeState = state; publishWakeSnapshot({ state: 'ready', wakeState: state }) },
    onLevel: (audioLevel) => publishWakeSnapshot({ state: 'ready', wakeState, audioLevel }),
    onDetected: (detail) => {
      wakeState = 'detected'
      publishWakeSnapshot({ state: 'listening', wakeState, audioLevel: undefined })
      void showFaroMini()
      dispatchDesktopEvent(FARO_LOCAL_WAKE_EVENT, detail)
    },
  }).catch(() => { wakeState = 'error'; publishWakeSnapshot({ state: 'error', wakeState }) })
}

async function stopDesktopWake() {
  await getConfiguredFaroVoiceAdapters().wake?.localWake?.stop().catch(() => undefined)
}

function dispatchDesktopEvent<T>(name: string, detail: T) {
  window.dispatchEvent(new CustomEvent<T>(name, { detail }))
}

/** Runs in the main WebView only. Native owns windows and the global shortcut. */
export function installFaroDesktopRuntime() {
  if (installed) return
  installed = true

  window.addEventListener(FARO_VOICE_SNAPSHOT_EVENT, (event) => {
    const snapshot = (event as CustomEvent<FaroVoiceSnapshot>).detail
    if (snapshot) void publishFaroDesktopVoiceSnapshot(snapshot).catch(() => undefined)
  })
  window.addEventListener('faro:voice-audio-level', (event) => { void invoke('set_voice_audio_level', { level: (event as CustomEvent<number>).detail }).catch(() => {}) })
  window.addEventListener('faro:voice-ready', () => { voiceReady = true; void startDesktopWake() })
  window.addEventListener('faro:desktop-wake-adapter-ready', () => { void startDesktopWake() })
  window.addEventListener(FARO_VOICE_PANEL_OPENED_EVENT, () => { void stopDesktopWake() })
  window.addEventListener(FARO_VOICE_SESSION_ENDED_EVENT, () => { window.setTimeout(() => void startDesktopWake(), 300) })
  window.addEventListener('faro:desktop-wake-enabled', (event) => {
    wakeEnabled = Boolean((event as CustomEvent<boolean>).detail)
    if (wakeEnabled) void startDesktopWake()
    else void stopDesktopWake()
  })
  void getDesktopPreferences().then((preferences) => {
    // Migrate the already-stored legacy toggle too. Its old model was trained
    // for “Hola FARO”, whereas the current Mini listens for “FARO”.
    if (preferences?.wakeEnabled) void updateDesktopPreferences({ wakeEnabled: false })
    void stopDesktopWake()
  })

  void listen<FaroDesktopVoiceAction>('faro://voice-action', ({ payload }) => {
    dispatchDesktopEvent(FARO_VOICE_ACTION_EVENT, payload)
  })
  void listen<string>('faro://voice-transcript', ({ payload }) => {
    dispatchDesktopEvent(FARO_VOICE_TRANSCRIPT_EVENT, payload)
  })
  void listen<string>('faro://navigate', ({ payload }) => {
    if (payload === '/finance' || payload === '/calendar' || payload === '/backlog' || payload === '/settings') {
      void router.navigate(payload)
      dispatchDesktopEvent(FARO_DESKTOP_NAVIGATE_EVENT, payload)
    }
  })
}
