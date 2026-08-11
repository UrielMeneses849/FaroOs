import { ArrowRight, Bug, Check, Mic, Send, Sparkles, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '../../components/common'
import { voiceService } from '../../services/voiceService'
import { isSpeechAbortError, speechSafeText, speechService, type SpeechMetrics } from '../../services/speechService'
import type { FaroTtsModel, PendingVoiceAction, VoiceConversationTurn, VoicePipeline, VoiceResponse, VoiceSessionContext } from './voiceSchemas'
import { useSpeechInput, type SpeechInputMetrics } from './useSpeechInput'
import { isNewCommandDuringConfirmation, routeVoiceInput, shouldAcceptRealtimeWake, updatePendingActionFromVoice } from './voiceConversation'
import type { FaroVoiceSurface, FaroVoiceVisualState } from './faroVoiceConfig'
import { useRealtimeVoice } from './useRealtimeVoice'

const examples = [
  'Muéstrame mi resumen financiero del mes',
  'Registra un gasto de 350 pesos en Comida desde NU Pruebas',
  'Registra un ingreso de 1,200 pesos en BBVA Pruebas',
  'Busca mis movimientos de la categoría Personal',
]
const calendarExamples = [
  '¿Qué tengo mañana?',
  'Encuéntrame un espacio de dos horas esta semana',
  'Agenda una reunión con Ana mañana a las 4',
  'Mueve la reunión una hora más tarde',
  'Elimina ese evento',
  '¿Qué sigue?',
]
const benchmarkScenarios = [
  'Gasté 350 en comida.',
  'Registra 1200 de ingreso en BBVA.',
  '¿Cuánto gasté hoy?',
  'Elimina el gasto de 500 de ayer.',
  'Cambia el gasto de 350 a Transporte.',
  'Registra el pago de Seguro Hermana.',
  'Elimina ese gasto.',
]
const CALENDAR_TOOLS = new Set(['createCalendarEvent','updateCalendarEvent','deleteCalendarEvent','createScheduledTask'])

type ConsoleState = 'ready' | 'thinking' | 'confirmation' | 'executing' | 'completed' | 'error'
type ConversationState = 'stopped' | 'waiting_for_wake_word' | 'listening_command' | 'processing' | 'speaking' | 'awaiting_confirmation'

interface AiLabConsoleProps {
  onOpenFinance: () => void
  onOpenCalendar?: () => void
  mode?: 'lab' | 'product'
  surface?: FaroVoiceSurface
  onStateChange?: (state: FaroVoiceVisualState) => void
}

export function AiLabConsole({ onOpenFinance, onOpenCalendar, mode = 'lab', surface = 'dashboard', onStateChange }: AiLabConsoleProps) {
  const [text, setText] = useState('')
  const [state, setState] = useState<ConsoleState>('ready')
  const [response, setResponse] = useState<VoiceResponse | null>(null)
  const [history, setHistory] = useState<VoiceConversationTurn[]>([])
  const [qaOpen, setQaOpen] = useState(false)
  const [conversationState, setConversationState] = useState<ConversationState>('stopped')
  const [pendingAction, setPendingAction] = useState<PendingVoiceAction>()
  const [voiceStatus, setVoiceStatus] = useState('Micrófono apagado')
  const [pipeline, setPipeline] = useState<VoicePipeline>('optimized')
  const [ttsModel, setTtsModel] = useState<FaroTtsModel>('current')
  const [measurements, setMeasurements] = useState<Array<Record<string, string | number>>>([])
  const [benchmarkBusy,setBenchmarkBusy]=useState(false)
  const [bargeInEnabled,setBargeInEnabled]=useState(false)
  const [lastRealtimeTranscript,setLastRealtimeTranscript]=useState('')
  const timer = useRef<number | undefined>(undefined)
  const conversationRef = useRef(false)
  const pendingRef = useRef<PendingVoiceAction | undefined>(undefined)
  const commandActiveRef = useRef(false)
  const executingRef = useRef(false)
  const turnInFlightRef = useRef(false)
  const closingRef = useRef(false)
  const realtimeWakeRef = useRef(false)
  const pendingEditRef = useRef<'title' | null>(null)
  const speakingRef = useRef(false)
  const lastSpokenRef = useRef({ value: '', at: 0 })
  const spokenTranscriptRef = useRef<string | undefined>(undefined)
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
  const sessionContextRef = useRef<VoiceSessionContext>({ sessionId, lastSkill: 'finance', lastResults: [] })
  const inputMetricsRef = useRef<SpeechInputMetrics | undefined>(undefined)
  const routingMsRef = useRef(0)
  const serverMetricsRef = useRef<Record<string, number>>({})
  const lastAcceptedRef = useRef({ value: '', at: 0 })
  const sendRef = useRef<(value:string)=>void>(()=>undefined)
  const resolveRef = useRef<(confirmed:boolean,value?:string)=>void>(()=>undefined)
  const goodbyeRef = useRef<(value:string)=>void>(()=>undefined)
  const reviseRef = useRef<(action:PendingVoiceAction,value:string)=>void>(()=>undefined)
  const acceptTranscript = useCallback((value: string) => setText(value), [])
  const acceptFinal = useCallback((value:string)=>{if(!conversationRef.current)return;const normalized=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();const now=Date.now();const lastSpoken=lastSpokenRef.current;if(lastSpoken.value&&now-lastSpoken.at<5000&&(normalized===lastSpoken.value||lastSpoken.value.includes(normalized)||normalized.includes(lastSpoken.value)))return;if(lastAcceptedRef.current.value===normalized&&now-lastAcceptedRef.current.at<2000)return;lastAcceptedRef.current={value:normalized,at:now};window.clearTimeout(timer.current);if(pendingEditRef.current==='title'&&pendingRef.current){pendingEditRef.current=null;const updated=updatePendingActionFromVoice(pendingRef.current,`cambia el título a ${value}`);if(updated){reviseRef.current(updated,value);return}}const routeStartedAt=performance.now();const route=routeVoiceInput(value,{pendingAction:pendingRef.current,commandActive:commandActiveRef.current});routingMsRef.current=performance.now()-routeStartedAt;if(route.kind==='ignore')return;if(route.kind==='goodbye'){goodbyeRef.current(route.transcript);return}if(route.kind==='wake'){commandActiveRef.current=true;spokenTranscriptRef.current=route.transcript;setConversationState('listening_command');setVoiceStatus('FARO está escuchando');sendRef.current('__wake_only__');return}if(route.kind==='confirm'){resolveRef.current(true,route.transcript);return}if(route.kind==='cancel'){pendingEditRef.current=null;resolveRef.current(false,route.transcript);return}if(route.kind==='modify'){reviseRef.current(route.action,route.transcript);return}if(route.kind==='request_pending_edit'){pendingEditRef.current='title';spokenTranscriptRef.current=route.transcript;sendRef.current('__pending_edit_title__');return}if(route.kind==='pending_unknown'){spokenTranscriptRef.current=route.transcript;sendRef.current('__pending_unknown__');return}commandActiveRef.current=true;spokenTranscriptRef.current=route.transcript;setText(route.transcript);setConversationState('processing');setVoiceStatus('FARO está entendiendo');sendRef.current(route.command)},[])
  const speech = useSpeechInput(acceptTranscript,acceptFinal,(value)=>{inputMetricsRef.current=value})
  const realtime = useRealtimeVoice((value,meta)=>{setLastRealtimeTranscript(value);if(!commandActiveRef.current&&!pendingRef.current&&!shouldAcceptRealtimeWake(value,meta.speechDurationMs))return;acceptFinal(value)},()=>{if(bargeInEnabled&&speakingRef.current){speechService.stop();window.speechSynthesis?.cancel();speakingRef.current=false;setConversationState('listening_command');setVoiceStatus('FARO está escuchando')}})

  const speak = useCallback((value:string,restart:boolean,requestId?:string,endToEndStartedAt?:number)=>{if(!conversationRef.current)return;speech.stop();speechService.stop();window.speechSynthesis?.cancel();speakingRef.current=true;lastSpokenRef.current={value:value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim(),at:Date.now()};setConversationState('speaking');setVoiceStatus('FARO está hablando');let finished=false;const finish=(speechMetrics?:SpeechMetrics)=>{if(finished)return;finished=true;speakingRef.current=false;if(requestId&&speechMetrics){const clientMetrics={...serverMetricsRef.current,...inputMetricsRef.current,clientRoutingMs:routingMsRef.current,...speechMetrics,endToEndMs:endToEndStartedAt?performance.now()-endToEndStartedAt:undefined};void voiceService.telemetry(requestId,numericMetrics(clientMetrics),{sttProvider:inputMetricsRef.current?.provider??'text',ttsModel:speechMetrics.providerModel??ttsModel,playbackMode:speechMetrics.mode});setMeasurements(current=>[...current,{requestId,pipeline,ttsModel,...numericMetrics(clientMetrics)}].slice(-40))}if(closingRef.current){closingRef.current=false;pendingRef.current=undefined;setPendingAction(undefined);setHistory([]);const nextSessionId=crypto.randomUUID();setSessionId(nextSessionId);sessionContextRef.current={sessionId:nextSessionId,lastSkill:'finance',lastResults:[]};if(realtimeWakeRef.current){conversationRef.current=true;commandActiveRef.current=false;setConversationState('waiting_for_wake_word');setVoiceStatus('Esperando “Hola FARO”')}else{conversationRef.current=false;setConversationState('stopped');setVoiceStatus('Conversación detenida')}return}if(conversationRef.current&&restart&&!executingRef.current){setConversationState(pendingRef.current?'awaiting_confirmation':'listening_command');setVoiceStatus(pendingRef.current?'Esperando confirmación':'FARO está escuchando');if(!realtimeWakeRef.current)speech.start(true)}else if(!conversationRef.current)setVoiceStatus('Conversación detenida')};const fallback=()=>{if(!conversationRef.current||!('speechSynthesis'in window)){finish();return}const utterance=new SpeechSynthesisUtterance(speechSafeText(value));utterance.lang='es-MX';utterance.rate=1;utterance.pitch=1;utterance.volume=1;utterance.onend=()=>finish();utterance.onerror=()=>finish();window.speechSynthesis.speak(utterance)};void speechService.speak(speechSafeText(value),{model:ttsModel}).then(finish).catch((error)=>{if(!isSpeechAbortError(error))fallback()})},[pipeline,speech,ttsModel])

  const send = async (message: string) => {
    if(message==='__wake_only__'){const transcript=spokenTranscriptRef.current??'FARO';spokenTranscriptRef.current=undefined;setHistory(current=>[...current,{role:'user',content:transcript},{role:'assistant',content:'Te escucho.'}].slice(-6) as VoiceConversationTurn[]);speak('Te escucho.',true);return}
    if(message==='__pending_unknown__'){const transcript=spokenTranscriptRef.current??'';spokenTranscriptRef.current=undefined;if(pendingRef.current&&isNewCommandDuringConfirmation(transcript)){const abandoned=pendingRef.current;pendingEditRef.current=null;pendingRef.current=undefined;setPendingAction(undefined);sessionContextRef.current={...sessionContextRef.current,pendingAction:undefined};void voiceService.cancel(abandoned).catch(()=>undefined);window.setTimeout(()=>sendRef.current(transcript),0);return}const reply='No entendí si deseas confirmar o cancelar.';setResponse(current=>current?{...current,message:reply,pendingAction:pendingRef.current}:current);setHistory(current=>[...current,{role:'user',content:transcript},{role:'assistant',content:reply}].slice(-6) as VoiceConversationTurn[]);setState('confirmation');setConversationState('awaiting_confirmation');speak(reply,true);return}
    if(message==='__pending_edit_title__'){const transcript=spokenTranscriptRef.current??'';spokenTranscriptRef.current=undefined;const reply='Claro. ¿Qué título quieres usar?';setResponse(current=>current?{...current,message:reply,pendingAction:pendingRef.current}:current);setHistory(current=>[...current,{role:'user',content:transcript},{role:'assistant',content:reply}].slice(-6) as VoiceConversationTurn[]);setState('confirmation');setConversationState('awaiting_confirmation');speak(reply,true);return}
    if (turnInFlightRef.current) return
    turnInFlightRef.current = true
    const spokenTranscript = spokenTranscriptRef.current
    spokenTranscriptRef.current = undefined
    setState('thinking')
    if(conversationRef.current)setVoiceStatus('FARO está pensando')
    setResponse(null)
    try {
      const recentHistory = history.slice(-6)
      const startedAt = performance.now()
      const requestId=crypto.randomUUID()
      if(mode==='lab'&&pipeline==='legacy')await new Promise(resolve=>window.setTimeout(resolve,250))
      const next = await voiceService.send(message, spokenTranscript ? 'voice' : 'text', recentHistory, mode === 'lab' ? 'lab' : surface,{requestId,sessionId,pipeline:mode==='lab'?pipeline:'optimized',sessionContext:sessionContextRef.current,trace:{startedAt,marks:{sttFinalMs:inputMetricsRef.current?.finalResultMs??0,clientRoutingMs:routingMsRef.current,legacyClientDelayMs:mode==='lab'&&pipeline==='legacy'?250:0}}})
      serverMetricsRef.current={...(next.qa?.timings??{}),voiceResponseMs:performance.now()-startedAt}
      if (import.meta.env.DEV) console.debug('[FARO Voice]', { stage: 'faro-voice', durationMs: Math.round(performance.now() - startedAt), surface: mode === 'lab' ? 'lab' : surface })
      setResponse(next)
      const visibleMessage=spokenTranscript??message
      const completedTurns: VoiceConversationTurn[] = [
        ...recentHistory,
        { role: 'user', content: visibleMessage },
        { role: 'assistant', content: next.message },
      ]
      setHistory(completedTurns.slice(-6))
      setState(next.status === 'pending_confirmation' ? 'confirmation' : next.status === 'error' ? 'error' : 'completed')
      pendingRef.current=next.pendingAction
      setPendingAction(next.pendingAction)
      const result=next.result&&typeof next.result==='object'?next.result as {references?:VoiceSessionContext['lastResults'];pendingClarification?:VoiceSessionContext['pendingClarification']}:{}
      sessionContextRef.current={...sessionContextRef.current,lastSkill:next.qa?.skill??sessionContextRef.current.lastSkill,lastResults:result.references??sessionContextRef.current.lastResults,pendingClarification:result.pendingClarification,pendingAction:next.pendingAction}
      setConversationState(next.pendingAction?'awaiting_confirmation':'listening_command')
      speak(next.message,true,requestId,startedAt)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FARO no pudo procesar la solicitud.'
      setResponse({ status: 'error', message, questions: [] })
      setState('error')
      speak(message,true)
    } finally { turnInFlightRef.current = false }
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
      if(succeeded){
        pendingEditRef.current=null
        pendingRef.current=undefined
        setPendingAction(undefined)
        const result=next.result&&typeof next.result==='object'?next.result as {reference?:VoiceSessionContext['lastResults'][number]}:{}
        sessionContextRef.current={
          ...sessionContextRef.current,
          pendingAction:undefined,
          ...('reference'in result&&result.reference
            ? {lastResults:[result.reference]}
            : action.toolName==='deleteCalendarEvent' ? {lastResults:[]} : {}),
        }
      }
      if(spoken)setHistory(current=>[...current,{role:'user',content:spoken},{role:'assistant',content:next.message}].slice(-6) as VoiceConversationTurn[])
      setState(next.status === 'error' ? 'error' : 'completed')
      if (confirmed && next.status === 'completed') window.dispatchEvent(new CustomEvent(next.qa?.skill==='calendar'||CALENDAR_TOOLS.has(action.toolName)?'faro:calendar-updated':'faro:finance-updated',{detail:{toolName:action.toolName,result:next.result}}))
      speak(confirmed?next.message:'De acuerdo. No modifiqué ningún dato.',conversationRef.current,action.requestId,performance.now())
    } catch (error) {
      const message=error instanceof Error?error.message:'No fue posible ejecutar la acción.'
      setResponse({ status: 'error', message, questions: [] })
      setState('error')
      speak(message,conversationRef.current)
    } finally {executingRef.current=false}
  }
  const revise=async(action:PendingVoiceAction,spoken:string)=>{if(executingRef.current)return;executingRef.current=true;setState('executing');try{const next=await voiceService.revise(action);pendingRef.current=next.pendingAction;setPendingAction(next.pendingAction);setResponse(next);setHistory(current=>[...current,{role:'user',content:spoken},{role:'assistant',content:next.message}].slice(-6) as VoiceConversationTurn[]);setState('confirmation');setConversationState('awaiting_confirmation');speak(next.message,true,action.requestId,performance.now())}catch(error){setResponse({status:'error',message:error instanceof Error?error.message:'No fue posible revisar la acción.',questions:[]});setState('error')}finally{executingRef.current=false}}
  const stopConversation=useCallback(()=>{conversationRef.current=false;commandActiveRef.current=false;closingRef.current=false;pendingEditRef.current=null;setConversationState('stopped');window.clearTimeout(timer.current);speech.stop();speechService.stop();window.speechSynthesis?.cancel();setVoiceStatus('Conversación detenida')},[speech])
  const goodbye=async(spoken:string)=>{if(closingRef.current)return;closingRef.current=true;commandActiveRef.current=false;pendingEditRef.current=null;window.clearTimeout(timer.current);speech.stop();window.speechSynthesis?.cancel();if(pendingRef.current){try{await voiceService.cancel(pendingRef.current)}catch(error){setResponse({status:'error',message:error instanceof Error?error.message:'No fue posible cancelar la propuesta.',questions:[]})}pendingRef.current=undefined;setPendingAction(undefined)}setHistory(current=>[...current,{role:'user',content:spoken},{role:'assistant',content:'Hasta luego.'}].slice(-6) as VoiceConversationTurn[]);speak('Hasta luego.',false)}
  useEffect(() => {
    sendRef.current=(value)=>void send(value)
    resolveRef.current=(confirmed,value)=>void resolve(confirmed,value)
    goodbyeRef.current=(value)=>void goodbye(value)
    reviseRef.current=(action,value)=>void revise(action,value)
  })
  const startConversation=useCallback(()=>{conversationRef.current=true;commandActiveRef.current=false;setConversationState('waiting_for_wake_word');setVoiceStatus("Esperando ‘FARO’");speech.start(true)},[speech])
  const startRealtimeWake=useCallback(async()=>{conversationRef.current=true;realtimeWakeRef.current=true;commandActiveRef.current=false;setConversationState('waiting_for_wake_word');setVoiceStatus('Esperando “Hola FARO”');await realtime.start()},[realtime])
  const stopRealtimeWake=useCallback(()=>{realtimeWakeRef.current=false;realtime.stop();stopConversation()},[realtime,stopConversation])
  useEffect(()=>()=>{conversationRef.current=false;window.clearTimeout(timer.current);speechService.stop();window.speechSynthesis?.cancel()},[])

  useEffect(() => {
    if (!onStateChange) return
    const visual: FaroVoiceVisualState = state === 'error' ? 'error' : conversationState === 'speaking' ? 'speaking' : state === 'executing' ? 'executing' : state === 'confirmation' || conversationState === 'awaiting_confirmation' ? 'awaiting_confirmation' : state === 'thinking' ? 'consulting' : conversationState === 'processing' ? 'understanding' : speech.state === 'listening' || conversationState === 'listening_command' ? 'listening' : 'ready'
    onStateChange(visual)
  }, [conversationState, onStateChange, speech.state, state])

  const busy = state === 'thinking' || state === 'executing'
  const conversation=conversationState!=='stopped'
  const runBenchmark=async()=>{if(benchmarkBusy)return;setBenchmarkBusy(true);const samples:Array<Record<string,string|number>>=[];try{for(const candidatePipeline of ['legacy','optimized'] as const){for(const scenario of benchmarkScenarios){const startedAt=performance.now();if(candidatePipeline==='legacy')await new Promise(resolve=>window.setTimeout(resolve,250));const requestId=crypto.randomUUID();const next=await voiceService.send(scenario,'text',[],'lab',{requestId,sessionId:crypto.randomUUID(),pipeline:candidatePipeline,trace:{startedAt,marks:{legacyClientDelayMs:candidatePipeline==='legacy'?250:0}}});samples.push({requestId,pipeline:candidatePipeline,ttsModel:'sin-audio',scenario,proposalMs:performance.now()-startedAt,...(next.qa?.timings??{})});if(next.pendingAction)await voiceService.cancel(next.pendingAction)}}setMeasurements(current=>[...current,...samples].slice(-80))}finally{setBenchmarkBusy(false)}}

  return (
    <section className={`ai-lab-console ${mode === 'product' ? 'ai-lab-console--product' : ''}`} aria-live="polite" data-surface={mode === 'product' ? surface : 'lab'}>
      <header className="ai-lab-console__header">
        <div><Sparkles size={19} /><div><span>{mode === 'lab' ? 'CONSOLA CONVERSACIONAL' : 'FARO VOICE V1'}</span><h2>{mode === 'lab' ? 'Habla con FARO en modo de pruebas' : 'Tu asistente financiero'}</h2><p>{mode === 'lab' ? 'Las consultas se responden al instante. Crear o modificar información siempre exige tu confirmación.' : 'Habla o escribe. FARO siempre pedirá confirmación antes de modificar tus finanzas.'}</p></div></div>
        {mode === 'lab' && <div><Button variant="secondary" icon={<ArrowRight size={15} />} onClick={onOpenFinance}>Ver Finanzas</Button>{onOpenCalendar&&<Button variant="secondary" icon={<ArrowRight size={15}/>} onClick={onOpenCalendar}>Ver Calendar</Button>}</div>}
      </header>

      {mode === 'lab' && <div className="ai-lab-console__guide">
        <article><strong>1</strong><span>Escribe una instrucción con monto, categoría y cuenta.</span></article>
        <article><strong>2</strong><span>Revisa el resumen que FARO propone.</span></article>
        <article><strong>3</strong><span>Confirma y comprueba el resultado en Finanzas.</span></article>
      </div>}

      {mode === 'lab' && <div className="ai-lab-console__examples" aria-label="Prompts de ejemplo">
        {examples.map((example) => <button type="button" key={example} onClick={() => setText(example)}>{example}</button>)}
      </div>}
      {mode === 'lab' && <div className="ai-lab-console__examples" aria-label="Prompts de Calendar">
        {calendarExamples.map((example)=><button type="button" key={example} onClick={()=>setText(example)}>{example}</button>)}
      </div>}

      {mode === 'lab' && <div className="voice-benchmark-controls"><label>Pipeline<select value={pipeline} onChange={(event)=>setPipeline(event.target.value as VoicePipeline)}><option value="optimized">Optimizado</option><option value="legacy">Legacy / baseline</option></select></label><label>ElevenLabs<select value={ttsModel} onChange={(event)=>setTtsModel(event.target.value as FaroTtsModel)}><option value="current">Modelo actual</option><option value="flash">Flash v2.5</option></select></label><button type="button" disabled={benchmarkBusy} onClick={()=>void runBenchmark()}>{benchmarkBusy?'Midiendo…':'Ejecutar baseline A/B'}</button><button type="button" disabled={!realtime.supported} onClick={()=>realtime.listening?stopRealtimeWake():void startRealtimeWake()}>{realtime.listening?'Apagar wake listening':'Activar wake listening'}</button><span>{realtime.metrics.speechToFinalMs?`Realtime final: ${Math.round(realtime.metrics.speechToFinalMs)} ms`:`${measurements.length} muestra(s) locales`}</span></div>}
      {mode==='lab'&&<label className="voice-barge-in"><input type="checkbox" checked={bargeInEnabled} onChange={event=>setBargeInEnabled(event.target.checked)}/> Interrupción experimental (AEC/VAD)</label>}
      {mode==='lab'&&realtime.listening&&<small className="voice-realtime-heard">{lastRealtimeTranscript?`Realtime oyó: “${lastRealtimeTranscript}”`:'Realtime conectado · di “Hola, Faro”'}</small>}
      {mode==='lab'&&realtime.error&&<div className="ai-test-lab__status is-error" role="alert">{realtime.error}</div>}

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
        <div><span>{mode === 'lab' ? 'Consulta Finanzas y Calendar. Toda escritura exige confirmación.' : 'Ningún cambio se guarda sin tu confirmación.'}</span><Button type="submit" icon={<Send size={15} />} disabled={!text.trim() || busy || speech.state === 'listening' || speech.state === 'processing'}>{busy ? 'Procesando…' : 'Enviar a FARO'}</Button></div>
      </form>
      <button className="voice-qa-toggle" type="button" onClick={() => setQaOpen((value) => !value)}><Bug size={13} /> Ver datos de QA</button>
      {qaOpen && <pre className="voice-qa">{JSON.stringify(response?.qa ?? { state }, null, 2)}</pre>}
      {mode==='lab'&&measurements.length>0&&<VoiceMetricsSummary values={measurements}/>}
    </section>
  )
}

function numericMetrics(value:Record<string,unknown>){return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>typeof item==='number'&&Number.isFinite(item)?[[key,Math.round(item*100)/100]]:[]))}
function percentile(values:number[],percent:number){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(percent*sorted.length)-1)]}
function VoiceMetricsSummary({values}:{values:Array<Record<string,string|number>>}){const grouped=values.reduce<Record<string,Array<Record<string,string|number>>>>((result,item)=>{const key=`${item.pipeline}/${item.ttsModel}`;(result[key]??=[]).push(item);return result},{});return <section className="voice-benchmark"><header><strong>Latencia observada</strong><span>p50 / p95 en ms</span></header>{Object.entries(grouped).map(([key,rows])=><article key={key}><b>{key}</b>{['proposalMs','serverTotalMs','audioPlaybackStartMs','endToEndMs'].map(metric=>{const samples=rows.map(row=>Number(row[metric])).filter(Number.isFinite);return <span key={metric}>{metric}: {samples.length?`${Math.round(percentile(samples,.5))} / ${Math.round(percentile(samples,.95))}`:'sin muestra'}</span>})}</article>)}</section>}
