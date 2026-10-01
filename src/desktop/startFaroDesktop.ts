import { configureFaroRuntime, type FaroNavigationAdapter, type FaroSessionStorage } from '../core/platform/runtime'
import { configureFaroVoiceAdapters, type FaroVoiceAdapters } from '../core/voice/adapters'
import { webAudioPlaybackAdapter, webVoiceInputAdapter, webWakeListeningAdapter } from '../features/voice/webVoiceAdapters'
import { desktopSessionStorage } from './desktopSessionStorage'

export interface FaroDesktopOptions {
  /** Optional Tauri Stronghold/Store bridge. WebView localStorage is the fallback. */
  sessionStorage?: FaroSessionStorage
  navigation?: FaroNavigationAdapter
  voiceAdapters?: Partial<FaroVoiceAdapters>
}

/**
 * Tauri calls this before importing the shared React entry. It deliberately
 * loads the existing web UI instead of creating a second domain/application.
 */
export async function startFaroDesktop(options: FaroDesktopOptions = {}) {
  configureFaroRuntime({ surface: 'desktop', sessionStorage: options.sessionStorage ?? desktopSessionStorage, navigation: options.navigation })
  configureFaroVoiceAdapters({
    input: webVoiceInputAdapter,
    audio: webAudioPlaybackAdapter,
    // The shared browser adapter keeps manual Voice available immediately.
    // The ONNX wake engine is loaded after the UI bootstraps below so a
    // missing/corrupt local model can never leave the desktop app blank.
    wake: webWakeListeningAdapter,
    ...options.voiceAdapters,
  })
  const isMini = new URLSearchParams(globalThis.location.search).get('window') === 'mini'
  if (isMini) {
    await import('./miniBootstrap')
    return
  }
  const { installFaroDesktopRuntime } = await import('./desktopRuntime')
  installFaroDesktopRuntime()
  await import('../bootstrap')

  // Local wake is progressive enhancement: Voice via shortcut/orb remains
  // fully usable even if the optional ONNX runtime cannot initialize.
  if (!options.voiceAdapters?.wake) {
    void import('./desktopWakeAdapter')
      .then(({ desktopWakeListeningAdapter }) => {
        configureFaroVoiceAdapters({ wake: desktopWakeListeningAdapter })
        window.dispatchEvent(new Event('faro:desktop-wake-adapter-ready'))
      })
      .catch((error) => console.error('[FARO Desktop] local wake unavailable', error))
  }
}
