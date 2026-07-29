import { Bug, Check, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { useCallback, useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { voiceService } from '../../services/voiceService'
import type { PendingVoiceAction, VoiceResponse } from './voiceSchemas'
import { useRealtimeVoice } from './useRealtimeVoice'

type VoiceState = 'ready' | 'listening' | 'thinking' | 'confirmation' | 'executing' | 'completed' | 'error'

export function VoicePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<VoiceState>('ready')
  const [response, setResponse] = useState<VoiceResponse | null>(null)
  const [qaOpen, setQaOpen] = useState(false)

  const send = useCallback(async (message: string, source: 'text' | 'voice' = 'text') => {
    setState('thinking')
    try {
      const next = await voiceService.send(message, source)
      setResponse(next)
      setState(next.status === 'pending_confirmation' ? 'confirmation' : next.status === 'error' ? 'error' : 'completed')
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'FARO no pudo procesar la solicitud.', questions: [] })
      setState('error')
    }
  }, [])
  const transcript = useCallback((value: string) => {
    setText(value)
    void send(value, 'voice')
  }, [send])
  const realtime = useRealtimeVoice(transcript)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    void send(text.trim())
  }
  const toggleMicrophone = async () => {
    try {
      if (realtime.listening) realtime.stop()
      else await realtime.start()
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'No fue posible usar el micrófono.', questions: [] })
      setState('error')
    }
  }
  const resolve = async (action: PendingVoiceAction, confirmed: boolean) => {
    setState('executing')
    try {
      const next = confirmed ? await voiceService.confirm(action) : await voiceService.cancel(action)
      setResponse(next)
      setState('completed')
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'No fue posible ejecutar la acción.', questions: [] })
      setState('error')
    }
  }

  return (
    <Modal panelClassName="voice-modal" open={open} title="Hablar con FARO" onClose={() => { realtime.stop(); onClose() }}>
      <section className="voice-panel" aria-live="polite">
        <div className={`voice-orb voice-orb--${realtime.listening ? 'listening' : state}`} aria-hidden="true"><Sparkles size={24} /></div>
        <p className="voice-state">{realtime.listening ? 'Escuchando…' : state === 'thinking' ? 'Pensando…' : state === 'executing' ? 'Ejecutando…' : 'Listo para ayudarte'}</p>
        {response && (
          <div className={`voice-response voice-response--${response.status}`}>
            <p>{response.message}</p>
            {response.questions.map((question) => <p key={question}>• {question}</p>)}
          </div>
        )}
        {response?.pendingAction && (
          <div className="voice-confirmation">
            <strong>Confirma antes de guardar</strong>
            <p>{response.pendingAction.summary}</p>
            <div><Button icon={<Check size={16} />} onClick={() => void resolve(response.pendingAction!, true)}>Confirmar</Button><Button variant="ghost" onClick={() => void resolve(response.pendingAction!, false)}>Cancelar</Button></div>
          </div>
        )}
        <form className="voice-compose" onSubmit={submit}>
          <textarea aria-label="Escribe a FARO" placeholder="Ej. Registra un gasto de 350 pesos en comida…" value={text} onChange={(event) => setText(event.target.value)} />
          <div>
            <Button type="button" variant={realtime.listening ? 'secondary' : 'ghost'} icon={realtime.listening ? <MicOff size={17} /> : <Mic size={17} />} onClick={() => void toggleMicrophone()}>
              {realtime.listening ? 'Detener' : 'Hablar'}
            </Button>
            <Button type="submit" icon={<Send size={16} />} disabled={!text.trim() || state === 'thinking'}>Enviar</Button>
          </div>
        </form>
        <button className="voice-qa-toggle" type="button" onClick={() => setQaOpen((value) => !value)}><Bug size={14} /> QA</button>
        {qaOpen && <pre className="voice-qa">{JSON.stringify(response?.qa ?? { state }, null, 2)}</pre>}
      </section>
    </Modal>
  )
}
