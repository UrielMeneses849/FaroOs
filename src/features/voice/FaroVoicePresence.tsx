import { Mic } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useFaroVoice } from './FaroVoiceProvider'

const labels = { idle: 'Hablar con FARO', listening: 'Escuchando', thinking: 'Analizando', speaking: 'Hablando', error: 'Necesita atención' } as const

export function FaroVoicePresence() {
  const { enabled, visualState, openFaroVoice } = useFaroVoice()
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const change = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', change)
    return () => document.removeEventListener('visibilitychange', change)
  }, [])
  if (!enabled) return null
  return <button className="faro-presence" data-state={visualState} data-visible={visible} type="button" aria-label={`${labels[visualState]}. Abrir FARO Voice`} onClick={() => openFaroVoice({ surface: 'dashboard' })}>
    <span className="faro-presence__core"><i /><i /><i /><Mic size={18} /></span>
    <span><small>FARO VOICE V1</small><strong>{labels[visualState]}</strong></span>
  </button>
}
