import { Mic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useOptionalFaroVoice } from './FaroVoiceProvider'

const labels = {
  ready: 'Hablar con FARO', listening: 'Escuchando', understanding: 'Entendiendo', consulting: 'Consultando',
  awaiting_confirmation: 'Esperando confirmación', executing: 'Ejecutando', speaking: 'Hablando', error: 'Necesita atención',
} as const

interface FaroVoicePresenceProps {
  surface?: 'dashboard' | 'today' | 'finances'
}

export function FaroVoicePresence({ surface = 'dashboard' }: FaroVoicePresenceProps) {
  const voice = useOptionalFaroVoice()
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  if (!voice?.enabled) return null
  const { visualState, openFaroVoice } = voice
  return <button className="faro-presence" data-state={visualState} data-visible={visible} type="button" aria-label={`${labels[visualState]}. Abrir FARO Voice`} onClick={() => openFaroVoice({ surface })}>
    <span className="faro-presence__core"><i /><i /><i /><Mic size={18} /></span>
    <span><small>FARO VOICE V1</small><strong>{labels[visualState]}</strong></span>
  </button>
}
