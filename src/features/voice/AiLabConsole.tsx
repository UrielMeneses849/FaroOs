import { ArrowRight, Bug, Check, Mic, Send, Sparkles, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/common'
import { voiceService } from '../../services/voiceService'
import { isSpeechAbortError, speechSafeText, speechService } from '../../services/speechService'
import type { PendingVoiceAction, VoiceConversationTurn, VoiceResponse } from './voiceSchemas'
import { useSpeechInput } from './useSpeechInput'
import { routeVoiceInput } from './voiceConversation'
import type { FaroVoiceSurface, FaroVoiceVisualState } from './faroVoiceConfig'

const examples = [
  'Muéstrame mi resumen financiero del mes',
  'Registra un gasto de 350 pesos en Comida desde NU Pruebas',
  'Registra un ingreso de 1,200 pesos en BBVA Pruebas',
  'Busca mis movimientos de la categoría Personal',
]

type ConsoleState = 'ready' | 'thinking' | 'confirmation' | 'executing' | 'completed' | 'error'
type ConversationState = 'stopped' | 'waiting_for_wake_word' | 'listening_command' | 'processing' | 'speaking' | 'awaiting_confirmation'

interface AiLabConsoleProps {
  onOpenFinance: () => void
  mode?: 'lab' | 'product'
  surface?: FaroVoiceSurface
  onStateChange?: (state: FaroVoiceVisualState) => void
}

export function AiLabConsole({ onOpenFinance, mode = 'lab', surface = 'dashboard', onStateChange }: AiLabConsoleProps) {
  const [text, setText] = useState('')
  const [state, setState] = useState<ConsoleState>('ready')
  const [response, setResponse] = useState<VoiceResponse | null>(null)
  const [history, setHistory] = useState<VoiceConversationTurn[]>([])
  const [qaOpen, setQaOpen] = useState(false)
  const [conversationState, setConversationState] = useState<ConversationState>('stopped')
  const [pendingAction, setPendingAction] = useState<PendingVoiceAction>()
  const [voiceStatus, setVoiceStatus] = useState('Micrófono apagado')
  const timer = useRef<number | undefined>(undefined)
  const conversationRef = useRef(false)
  const pendingRef = useRef<PendingVoiceAction | undefined>(undefined)
  const commandActiveRef = useRef(false)
  const executingRef = useRef(false)
  const closingRef = useRef(false)
  const spokenTranscriptRef = useRef<string | undefined>(undefined)
  const sendRef = useRef<(value:string)=>void>(()=>undefined)
  const resolveRef = useRef<(confirmed:boolean,value?:string)=>void>(()=>undefined)
  const goodbyeRef = useRef<(value:string)=>void>(()=>undefined)
  const acceptTranscript = useCallback((value: string) => setText(value), [])
  const acceptFinal = useCallback((value:string)=>{if(!conversationRef.current)return;window.clearTimeout(timer.current);const route=routeVoiceInput(value,{pendingAction:pendingRef.current,commandActive:commandActiveRef.current});if(route.kind==='ignore')return;if(route.kind==='goodbye'){goodbyeRef.current(route.transcript);return}if(route.kind==='wake'){commandActiveRef.current=true;spokenTranscriptRef.current=route.transcript;setConversationState('listening_command');setVoiceStatus('FARO está escuchando');sendRef.current('__wake_only__');return}if(route.kind==='confirm'){resolveRef.current(true,route.transcript);return}if(route.kind==='cancel'){resolveRef.current(false,route.transcript);return}if(route.kind==='modify'){pendingRef.current=route.action;setPendingAction(route.action);setResponse(current=>current?{...current,status:'pending_confirmation',message:`Actualizaré el importe a ${String(route.action.arguments.actualAmount??route.action.arguments.amount)} pesos. ¿Confirmas?`,pendingAction:route.action}:current);setHistory(current=>[...current,{role:'user',content:route.transcript}].slice(-6) as VoiceConversationTurn[]);setState('confirmation');setConversationState('awaiting_confirmation');return}if(route.kind==='pending_unknown'){spokenTranscriptRef.current=route.transcript;sendRef.current('__pending_unknown__');return}spokenTranscriptRef.current=route.transcript;setText(route.transcript);setConversationState('processing');setVoiceStatus('FARO está pensando');timer.current=window.setTimeout(()=>sendRef.current(route.command),250)},[])
  const speech = useSpeechInput(acceptTranscript,acceptFinal)

  const speak = useCallback((value:string,restart:boolean)=>{if(!conversationRef.current)return;speech.stop();speechService.stop();window.speechSynthesis?.cancel();setConversationState('speaking');setVoiceStatus('FARO está hablando');let finished=false;const finish=()=>{if(finished)return;finished=true;if(closingRef.current){closingRef.current=false;conversationRef.current=false;setConversationState('stopped');setVoiceStatus('Conversación detenida');return}if(conversationRef.current&&restart&&!executingRef.current){setConversationState(pendingRef.current?'awaiting_confirmation':'listening_command');setVoiceStatus(pendingRef.current?'Esperando confirmación':'FARO está escuchando');speech.start(true)}else if(!conversationRef.current)setVoiceStatus('Conversación detenida')};const fallback=()=>{if(!conversationRef.current||!('speechSynthesis'in window)){finish();return}const utterance=new SpeechSynthesisUtterance(speechSafeText(value));utterance.lang='es-MX';utterance.rate=1;utterance.pitch=1;utterance.volume=1;utterance.onend=finish;utterance.onerror=finish;window.speechSynthesis.speak(utterance)};void speechService.speak(speechSafeText(value)).then(finish).catch((error)=>{if(!isSpeechAbortError(error))fallback()})},[speech])

  const send = async (message: string) => {
    if(message==='__wake_only__'){const transcript=spokenTranscriptRef.current??'FARO';spokenTranscriptRef.current=undefined;setHistory(current=>[...current,{role:'user',content:transcript},{role:'assistant',content:'Te escucho.'}].slice(-6) as VoiceConversationTurn[]);speak('Te escucho.',true);return}
    if(message==='__pending_unknown__'){const transcript=spokenTranscriptRef.current??'';spokenTranscriptRef.current=undefined;const reply='No entendí si deseas confirmar o cancelar.';setResponse(current=>current?{...current,message:reply,pendingAction:pendingRef.current}:current);setHistory(current=>[...current,{role:'user',content:transcript},{role:'assistant',content:reply}].slice(-6) as VoiceConversationTurn[]);setState('confirmation');setConversationState('awaiting_confirmation');speak(reply,true);return}
    setState('thinking')
    if(conversationRef.current)setVoiceStatus('FARO está pensando')
    setResponse(null)
    try {
      const recentHistory = history.slice(-6)
      const startedAt = performance.now()
      const next = await voiceService.send(message, spokenTranscriptRef.current ? 'voice' : 'text', recentHistory, mode === 'lab' ? 'lab' : surface)
      if (import.meta.env.DEV) console.debug('[FARO Voice]', { stage: 'faro-voice', durationMs: Math.round(performance.now() - startedAt), surface: mode === 'lab' ? 'lab' : surface })
      setResponse(next)
      const visibleMessage=spokenTranscriptRef.current??message
      spokenTranscriptRef.current=undefined
      const completedTurns: VoiceConversationTurn[] = [
        ...recentHistory,
        { role: 'user', content: visibleMessage },
        { role: 'assistant', content: next.message },
      ]
      setHistory(completedTurns.slice(-6))
      setState(next.status === 'pending_confirmation' ? 'confirmation' : next.status === 'error' ? 'error' : 'completed')
      pendingRef.current=next.pendingAction
      setPendingAction(next.pendingAction)
      setConversationState(next.pendingAction?'awaiting_confirmation':'listening_command')
      speak(next.status==='error'?'No pude registrar el movimiento. Inténtalo nuevamente.':next.message,true)
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

  const resolve = async (confirmed: boolean, spoken?:string) => {
    const action=pendingRef.current
    if(!action||executingRef.current)return
    executingRef.current=true
    setState('executing')
    try {
      const next = confirmed ? await voiceService.confirm(action) : await voiceService.cancel(action)
      setResponse(next)
      const succeeded=next.status!=='error'
      if(succeeded){pendingRef.current=undefined;setPendingAction(undefined)}
      if(spoken)setHistory(current=>[...current,{role:'user',content:spoken},{role:'assistant',content:next.message}].slice(-6) as VoiceConversationTurn[])
      setState(next.status === 'error' ? 'error' : 'completed')
      if (confirmed && next.status === 'completed') window.dispatchEvent(new Event('faro:finance-updated'))
      speak(next.status==='error'?'No pude registrar el movimiento. Inténtalo nuevamente.':confirmed?next.message:'De acuerdo. No modifiqué ningún dato.',conversationRef.current)
    } catch (error) {
      setResponse({ status: 'error', message: error instanceof Error ? error.message : 'No fue posible ejecutar la acción.', questions: [] })
      setState('error')
      speak('No pude registrar el movimiento. Inténtalo nuevamente.',conversationRef.current)
    } finally {executingRef.current=false}
  }
  const stopConversation=useCallback(()=>{conversationRef.current=false;commandActiveRef.current=false;closingRef.current=false;setConversationState('stopped');window.clearTimeout(timer.current);speech.stop();speechService.stop();window.speechSynthesis?.cancel();setVoiceStatus('Conversación detenida')},[speech])
  const goodbye=async(spoken:string)=>{if(closingRef.current)return;closingRef.current=true;commandActiveRef.current=false;window.clearTimeout(timer.current);speech.stop();window.speechSynthesis?.cancel();if(pendingRef.current){try{await voiceService.cancel(pendingRef.current)}catch(error){setResponse({status:'error',message:error instanceof Error?error.message:'No fue posible cancelar la propuesta.',questions:[]})}pendingRef.current=undefined;setPendingAction(undefined)}setHistory(current=>[...current,{role:'user',content:spoken},{role:'assistant',content:'Hasta luego.'}].slice(-6) as VoiceConversationTurn[]);speak('Hasta luego.',false)}
  useEffect(() => {
    sendRef.current=(value)=>void send(value)
    resolveRef.current=(confirmed,value)=>void resolve(confirmed,value)
    goodbyeRef.current=(value)=>void goodbye(value)
  })
  const startConversation=useCallback(()=>{conversationRef.current=true;commandActiveRef.current=false;setConversationState('waiting_for_wake_word');setVoiceStatus("Esperando ‘FARO’");speech.start(true)},[speech])
  useEffect(()=>()=>{conversationRef.current=false;window.clearTimeout(timer.current);speechService.stop();window.speechSynthesis?.cancel()},[])

  useEffect(() => {
    if (!onStateChange) return
    const visual: FaroVoiceVisualState = state === 'error' ? 'error' : conversationState === 'speaking' ? 'speaking' : state === 'thinking' || state === 'executing' || conversationState === 'processing' ? 'thinking' : speech.state === 'listening' || conversationState === 'listening_command' ? 'listening' : 'idle'
    onStateChange(visual)
  }, [conversationState, onStateChange, speech.state, state])

  const busy = state === 'thinking' || state === 'executing'
  const conversation=conversationState!=='stopped'

  return (
    <section className={`ai-lab-console ${mode === 'product' ? 'ai-lab-console--product' : ''}`} aria-live="polite" data-surface={mode === 'product' ? surface : 'lab'}>
      <header className="ai-lab-console__header">
        <div><Sparkles size={19} /><div><span>{mode === 'lab' ? 'CONSOLA CONVERSACIONAL' : 'FARO VOICE V1'}</span><h2>{mode === 'lab' ? 'Habla con FARO en modo de pruebas' : 'Tu asistente financiero'}</h2><p>{mode === 'lab' ? 'Las consultas se responden al instante. Crear o modificar información siempre exige tu confirmación.' : 'Habla o escribe. FARO siempre pedirá confirmación antes de modificar tus finanzas.'}</p></div></div>
        {mode === 'lab' && <Button variant="secondary" icon={<ArrowRight size={15} />} onClick={onOpenFinance}>Ver Finanzas</Button>}
      </header>

      {mode === 'lab' && <div className="ai-lab-console__guide">
        <article><strong>1</strong><span>Escribe una instrucción con monto, categoría y cuenta.</span></article>
        <article><strong>2</strong><span>Revisa el resumen que FARO propone.</span></article>
        <article><strong>3</strong><span>Confirma y comprueba el resultado en Finanzas.</span></article>
      </div>}

      {mode === 'lab' && <div className="ai-lab-console__examples" aria-label="Prompts de ejemplo">
        {examples.map((example) => <button type="button" key={example} onClick={() => setText(example)}>{example}</button>)}
      </div>}

      <div className="ai-lab-console__thread">
        {history.length>0&&<div className="ai-lab-console__history">{history.map((turn,index)=><p key={`${turn.role}-${index}`}><strong>{turn.role==='user'?'Tú':'FARO'}:</strong> {turn.content}</p>)}</div>}
        {!response && <div className="ai-lab-console__empty"><Sparkles size={22} /><strong>{busy ? 'FARO está analizando…' : 'Aquí aparecerá la respuesta'}</strong><span>{mode === 'lab' ? 'Empieza con uno de los ejemplos o escribe tu propia instrucción.' : 'Di “FARO” para iniciar o escribe una instrucción financiera.'}</span></div>}
        {response && <div className={`voice-response voice-response--${response.status}`}><p>{response.message}</p>{response.questions.filter((question) => !response.message.includes(question)).map((question) => <p key={question}>• {question}</p>)}</div>}
        {pendingAction && <div className={`voice-confirmation ${pendingAction.possibleDuplicate ? 'voice-confirmation--duplicate' : ''}`}><strong>{pendingAction.possibleDuplicate ? 'Posible movimiento duplicado' : 'Confirma antes de guardar'}</strong><p>{pendingAction.summary}</p>{pendingAction.possibleDuplicate && <small>Ya existe “{pendingAction.possibleDuplicate.description}” por ${pendingAction.possibleDuplicate.amount.toLocaleString('es-MX')} del {pendingAction.possibleDuplicate.date}.</small>}<div><Button icon={<Check size={15} />} disabled={busy} onClick={() => void resolve(true)}>{state==='executing'?'Registrando…':pendingAction.possibleDuplicate ? 'Registrar de todos modos' : 'Confirmar'}</Button><Button variant="ghost" disabled={busy} onClick={() => void resolve(false)}>Cancelar</Button></div></div>}
      </div>

      <form className="ai-lab-console__compose" onSubmit={submit}>
        <label htmlFor="ai-lab-prompt">Tu instrucción</label>
        <textarea id="ai-lab-prompt" placeholder={mode === 'lab' ? 'Ej. Registra un gasto de 350 pesos en Comida desde NU Pruebas' : 'Ej. Gasté 350 pesos en comida'} value={text} onChange={(event) => setText(event.target.value)} />
        <button className="ai-lab-console__mic" type="button" disabled={!speech.supported || busy || speech.state === 'processing'} onClick={speech.state === 'listening' ? speech.stop : () => speech.start(false)}>{speech.state === 'listening' ? <Square size={14} /> : <Mic size={16} />} {speech.state === 'listening' ? 'Escuchando…' : speech.state === 'processing' ? 'Procesando…' : 'Usar micrófono'}</button>
        <button className="ai-lab-console__mic" type="button" disabled={!speech.supported||busy} onClick={conversation?stopConversation:startConversation}>{conversation?<Square size={14}/>:<Mic size={16}/>} {conversation?'Detener conversación':'Iniciar conversación'}</button><small>{voiceStatus}</small>
        {!speech.supported && <small role="status">Este navegador no admite reconocimiento de voz. Puedes seguir escribiendo normalmente.</small>}{speech.state === 'denied' && <small role="alert">Permiso de micrófono denegado. Habilítalo en Chrome para usar voz.</small>}{speech.state === 'error' && <small role="alert">No pudimos iniciar el reconocimiento de voz.</small>}
        <div><span>{mode === 'lab' ? 'Por ahora el chat consulta, crea y cambia estados financieros. La eliminación por prompt todavía no está habilitada; puedes probarla manualmente en Finanzas.' : 'MVP financiero. Ningún cambio se guarda sin tu confirmación.'}</span><Button type="submit" icon={<Send size={15} />} disabled={!text.trim() || busy || speech.state === 'listening' || speech.state === 'processing'}>{busy ? 'Procesando…' : 'Enviar a FARO'}</Button></div>
      </form>
      <button className="voice-qa-toggle" type="button" onClick={() => setQaOpen((value) => !value)}><Bug size={13} /> Ver datos de QA</button>
      {qaOpen && <pre className="voice-qa">{JSON.stringify(response?.qa ?? { state }, null, 2)}</pre>}
    </section>
  )
}
