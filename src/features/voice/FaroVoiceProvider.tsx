import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { VoicePanel } from './VoicePanel'
import { FARO_VOICE_PRODUCTION_ENABLED, type FaroVoiceSurface, type FaroVoiceVisualState } from './faroVoiceConfig'

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
  const openFaroVoice = useCallback(({ surface: origin }: { surface: FaroVoiceSurface }) => {
    if (!FARO_VOICE_PRODUCTION_ENABLED) return
    setSurface(origin)
    setOpen(true)
  }, [])
  const closeFaroVoice = useCallback(() => {
    setOpen(false)
    setVisualState('ready')
  }, [])
  const value = useMemo(() => ({ enabled: FARO_VOICE_PRODUCTION_ENABLED, open, surface, visualState, openFaroVoice, closeFaroVoice }), [closeFaroVoice, open, openFaroVoice, surface, visualState])

  return <FaroVoiceContext.Provider value={value}>{children}<VoicePanel open={open} surface={surface} onStateChange={setVisualState} onClose={closeFaroVoice} /></FaroVoiceContext.Provider>
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
