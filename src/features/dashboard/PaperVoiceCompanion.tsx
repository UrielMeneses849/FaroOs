import { Mic, MicOff, ArrowUpRight, MessageCircle } from 'lucide-react'
import faroOrb from '../../assets/faro-orb-v1.png'
import { useOptionalFaroVoice } from '../voice/FaroVoiceProvider'

const stateCopy = {
  ready: 'Listo cuando tú lo necesites.', listening: 'Te estoy escuchando.', understanding: 'Entendiendo tu solicitud.',
  consulting: 'Consultando tu información.', awaiting_confirmation: 'Tu confirmación está pendiente.',
  executing: 'Procesando tu acción.', speaking: 'FARO está hablando.', error: 'Abre la conversación para revisar.',
} as const

export function PaperVoiceCompanion() {
  const voice = useOptionalFaroVoice()
  const enabled = Boolean(voice?.enabled)
  const visualState = voice?.visualState ?? 'ready'
  const listening = Boolean(voice?.open && visualState === 'listening')
  const openVoice = () => voice?.openFaroVoice({ surface: 'dashboard' })
  return <aside className="paper-voice" aria-labelledby="paper-voice-title">
    <div className="paper-voice__image"><img src={faroOrb} alt="" /></div>
    <div className="paper-voice__intro"><h2 id="paper-voice-title"><strong>FARO</strong> Voice</h2>
      <p>{enabled ? stateCopy[visualState] : 'FARO Voice no está disponible aquí.'}</p>
    </div>
    <button className="paper-voice__talk" type="button" disabled={!enabled} onClick={openVoice}>
      <Mic size={23} aria-hidden="true" />{voice?.open ? 'Continuar con FARO' : 'Hablar con FARO'}
    </button>
    <p className="paper-voice__microphone" role="status">{voice?.open ? <Mic size={18} /> : <MicOff size={18} />}
      {listening ? 'Te estoy escuchando' : voice?.open ? 'Conversación en curso' : 'Micrófono apagado'}
    </p>
    <div className="paper-voice__conversation">
      <button type="button" className="paper-voice__question" disabled={!enabled} onClick={openVoice}>
        <span>Pregúntame por tu día…</span><MessageCircle size={20} aria-hidden="true" />
      </button>
      <span>Por ejemplo:</span>
      <button type="button" className="paper-voice__example" disabled={!enabled} onClick={openVoice}>
        <span>“¿Qué necesito atender hoy?”</span><ArrowUpRight size={15} aria-hidden="true" />
      </button>
      <small>Abre la conversación para hacer tu consulta.</small>
    </div>
  </aside>
}
