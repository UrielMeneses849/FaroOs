import { ArrowRight, Bug, Check, Send, Sparkles } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '../../components/common'
import { voiceService } from '../../services/voiceService'
import type { PendingVoiceAction, VoiceConversationTurn, VoiceResponse } from './voiceSchemas'

const examples = [
  'Muéstrame mi resumen financiero del mes',
  'Registra un gasto de 350 pesos en Comida desde NU Pruebas',
  'Registra un ingreso de 1,200 pesos en BBVA Pruebas',
  'Busca mis movimientos de la categoría Personal',
]

type ConsoleState = 'ready' | 'thinking' | 'confirmation' | 'executing' | 'completed' | 'error'

export function AiLabConsole({ onOpenFinance }: { onOpenFinance: () => void }) {
  const [text, setText] = useState('')
  const [state, setState] = useState<ConsoleState>('ready')
  const [response, setResponse] = useState<VoiceResponse | null>(null)
  const [history, setHistory] = useState<VoiceConversationTurn[]>([])
  const [qaOpen, setQaOpen] = useState(false)

  const send = async (message: string) => {
    setState('thinking')
    setResponse(null)
    try {
      const recentHistory = history.slice(-6)
      const next = await voiceService.send(message, 'text', recentHistory)
      setResponse(next)
      const completedTurns: VoiceConversationTurn[] = [
        ...recentHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: next.message },
      ]
      setHistory(completedTurns.slice(-6))
      setState(next.status === 'pending_confirmation' ? 'confirmation' : next.status === 'error' ? 'error' : 'completed')
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'FARO no pudo procesar la solicitud.', questions: [] })
      setState('error')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const message = text.trim()
    if (!message) return
    void send(message)
  }

  const resolve = async (action: PendingVoiceAction, confirmed: boolean) => {
    setState('executing')
    try {
      const next = confirmed ? await voiceService.confirm(action) : await voiceService.cancel(action)
      setResponse(next)
      setState(next.status === 'error' ? 'error' : 'completed')
      if (confirmed && next.status === 'completed') window.dispatchEvent(new Event('faro:finance-updated'))
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'No fue posible ejecutar la acción.', questions: [] })
      setState('error')
    }
  }

  const busy = state === 'thinking' || state === 'executing'

  return (
    <section className="ai-lab-console" aria-live="polite">
      <header className="ai-lab-console__header">
        <div><Sparkles size={19} /><div><span>CONSOLA CONVERSACIONAL</span><h2>Habla con FARO en modo de pruebas</h2><p>Las consultas se responden al instante. Crear o modificar información siempre exige tu confirmación.</p></div></div>
        <Button variant="secondary" icon={<ArrowRight size={15} />} onClick={onOpenFinance}>Ver Finanzas</Button>
      </header>

      <div className="ai-lab-console__guide">
        <article><strong>1</strong><span>Escribe una instrucción con monto, categoría y cuenta.</span></article>
        <article><strong>2</strong><span>Revisa el resumen que FARO propone.</span></article>
        <article><strong>3</strong><span>Confirma y comprueba el resultado en Finanzas.</span></article>
      </div>

      <div className="ai-lab-console__examples" aria-label="Prompts de ejemplo">
        {examples.map((example) => <button type="button" key={example} onClick={() => setText(example)}>{example}</button>)}
      </div>

      <div className="ai-lab-console__thread">
        {!response && <div className="ai-lab-console__empty"><Sparkles size={22} /><strong>{busy ? 'FARO está analizando…' : 'Aquí aparecerá la respuesta'}</strong><span>Empieza con uno de los ejemplos o escribe tu propia instrucción.</span></div>}
        {response && <div className={`voice-response voice-response--${response.status}`}><p>{response.message}</p>{response.questions.filter((question) => !response.message.includes(question)).map((question) => <p key={question}>• {question}</p>)}</div>}
        {response?.pendingAction && <div className="voice-confirmation"><strong>Confirma antes de guardar</strong><p>{response.pendingAction.summary}</p><div><Button icon={<Check size={15} />} disabled={busy} onClick={() => void resolve(response.pendingAction!, true)}>Confirmar</Button><Button variant="ghost" disabled={busy} onClick={() => void resolve(response.pendingAction!, false)}>Cancelar</Button></div></div>}
      </div>

      <form className="ai-lab-console__compose" onSubmit={submit}>
        <label htmlFor="ai-lab-prompt">Tu instrucción</label>
        <textarea id="ai-lab-prompt" placeholder="Ej. Registra un gasto de 350 pesos en Comida desde NU Pruebas" value={text} onChange={(event) => setText(event.target.value)} />
        <div><span>Por ahora el chat consulta, crea y cambia estados financieros. La eliminación por prompt todavía no está habilitada; puedes probarla manualmente en Finanzas.</span><Button type="submit" icon={<Send size={15} />} disabled={!text.trim() || busy}>{busy ? 'Procesando…' : 'Enviar a FARO'}</Button></div>
      </form>
      <button className="voice-qa-toggle" type="button" onClick={() => setQaOpen((value) => !value)}><Bug size={13} /> Ver datos de QA</button>
      {qaOpen && <pre className="voice-qa">{JSON.stringify(response?.qa ?? { state }, null, 2)}</pre>}
    </section>
  )
}
