import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { VoicePanel, type VoicePresentation } from './VoicePanel'
import { FARO_LOCAL_WAKE_EVENT, FARO_VOICE_ACTION_EVENT, FARO_VOICE_PANEL_OPENED_EVENT, FARO_VOICE_SESSION_ENDED_EVENT, publishFaroVoiceSnapshot } from './desktopVoiceEvents'
import { FARO_VOICE_PRODUCTION_ENABLED, type FaroVoiceSnapshot, type FaroVoiceSurface, type FaroVoiceVisualState } from './faroVoiceConfig'

interface FaroVoiceContextValue {
  enabled: boolean
  open: boolean
  surface: FaroVoiceSurface
  visualState: FaroVoiceVisualState
  openFaroVoice: (options: { surface: FaroVoiceSurface }) => void
  closeFaroVoice: () => void
}

const FaroVoiceContext = createContext<FaroVoiceContextValue | null>(null)

export function FaroVoiceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [surface, setSurface] = useState<FaroVoiceSurface>('dashboard')
  const [visualState, setVisualState] = useState<FaroVoiceVisualState>('ready')
  const [autoStartToken, setAutoStartToken] = useState(0)
  const [activateOnStart, setActivateOnStart] = useState(false)
  const [presentation, setPresentation] = useState<VoicePresentation>('modal')
  const openFaroVoice = useCallback(({ surface: origin }: { surface: FaroVoiceSurface }) => {
    if (!FARO_VOICE_PRODUCTION_ENABLED) return
    setSurface(origin)
    setPresentation('modal')
    setOpen(true)
    window.dispatchEvent(new Event(FARO_VOICE_PANEL_OPENED_EVENT))
  }, [])
  const openFaroMiniVoice = useCallback((wakeDetected = false) => {
    if (!FARO_VOICE_PRODUCTION_ENABLED) return
    setPresentation('mini')
    setOpen(true)
    setActivateOnStart(wakeDetected)
    setAutoStartToken((value) => value + 1)
    window.dispatchEvent(new Event(FARO_VOICE_PANEL_OPENED_EVENT))
  }, [])
  const closeFaroVoice = useCallback(() => {
    setOpen(false)
    setPresentation('modal')
    setActivateOnStart(false)
    setVisualState('ready')
    publishFaroVoiceSnapshot({ state: 'ready' })
    window.dispatchEvent(new Event(FARO_VOICE_SESSION_ENDED_EVENT))
  }, [])
  const setVoiceSnapshot = useCallback((snapshot: FaroVoiceSnapshot) => {
    setVisualState(snapshot.state)
    publishFaroVoiceSnapshot(snapshot)
  }, [])
  useEffect(() => {
    const openFromMini = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'open') openFaroVoice({ surface })
      // A deliberate click/shortcut uses the existing wake-activated path.
      // The user should not need to say FARO again after pressing Talk.
      if (action === 'open_and_listen') openFaroMiniVoice(true)
      if (action === 'stop_listening' || action === 'close_assistant') closeFaroVoice()
      if (action === 'pause_focus' || action === 'finish_focus') window.dispatchEvent(new CustomEvent('faro:computer-action', { detail: action }))
    }
    const wakeFromDesktop = () => {
      openFaroMiniVoice(true)
    }
    window.addEventListener(FARO_VOICE_ACTION_EVENT, openFromMini)
    window.addEventListener(FARO_LOCAL_WAKE_EVENT, wakeFromDesktop)
    return () => {
      window.removeEventListener(FARO_VOICE_ACTION_EVENT, openFromMini)
      window.removeEventListener(FARO_LOCAL_WAKE_EVENT, wakeFromDesktop)
    }
  }, [closeFaroVoice, openFaroMiniVoice, openFaroVoice, surface])

  // Opening Desktop must never claim the microphone. Realtime begins only
  // after an explicit action such as the Mini microphone button or shortcut.
  const value = useMemo(() => ({ enabled: FARO_VOICE_PRODUCTION_ENABLED, open, surface, visualState, openFaroVoice, closeFaroVoice }), [closeFaroVoice, open, openFaroVoice, surface, visualState])

  useEffect(() => { window.dispatchEvent(new Event('faro:voice-ready')) }, [])
  return <FaroVoiceContext.Provider value={value}>{children}<VoicePanel open={open} presentation={presentation} surface={surface} autoStartToken={autoStartToken} activateOnStart={activateOnStart} onSnapshotChange={setVoiceSnapshot} onClose={closeFaroVoice} /></FaroVoiceContext.Provider>
}

// Context and provider intentionally live together to keep this feature boundary small.
// eslint-disable-next-line react-refresh/only-export-components
export function useFaroVoice() {
  const value = useContext(FaroVoiceContext)
  if (!value) throw new Error('useFaroVoice debe usarse dentro de FaroVoiceProvider.')
  return value
}

// FinancePage is also embedded inside the isolated Lab, where the production provider must not exist.
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalFaroVoice() {
  return useContext(FaroVoiceContext)
}
