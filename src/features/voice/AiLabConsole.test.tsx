import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiLabConsole } from './AiLabConsole'

const mocks = vi.hoisted(() => ({
  speechStart: vi.fn(), speechStop: vi.fn(), speechSpeak: vi.fn(), serviceStop: vi.fn(),
  send: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), revise: vi.fn(), telemetry: vi.fn(), final: undefined as ((value:string)=>void)|undefined,
}))

vi.mock('./useSpeechInput', () => ({ useSpeechInput: (_transcript:(value:string)=>void, final:(value:string)=>void) => { mocks.final=final;return {supported:true,state:'idle',start:mocks.speechStart,stop:mocks.speechStop} } }))
vi.mock('../../services/speechService', () => ({ speechService:{speak:mocks.speechSpeak,stop:mocks.serviceStop},speechSafeText:(value:string)=>value,isSpeechAbortError:(error:unknown)=>error instanceof DOMException&&error.name==='AbortError' }))
vi.mock('../../services/voiceService', () => ({ voiceService:{send:mocks.send,confirm:mocks.confirm,cancel:mocks.cancel,revise:mocks.revise,telemetry:mocks.telemetry} }))

const action={requestId:'48e30c50-e4bb-44a0-bdeb-bf098b2c3547',toolName:'registerRecurringPayment' as const,arguments:{recurringId:'seguro',period:'2026-08-01',expectedDate:'2026-08-06',actualAmount:700},summary:'Seguro Hermana por $700'}
const calendarAction={requestId:'58e30c50-e4bb-44a0-bdeb-bf098b2c3547',toolName:'createCalendarEvent' as const,arguments:{eventId:'68e30c50-e4bb-44a0-bdeb-bf098b2c3547',title:'Salida con Iris',start:'2026-08-09T18:00:00.000Z',end:'2026-08-09T19:00:00.000Z',provider:'faro',timezone:'America/Mexico_City'},summary:'Salida con Iris'}
const pending={status:'pending_confirmation' as const,message:'Encontré Seguro Hermana por $700. ¿Confirmas?',questions:[],pendingAction:action}
const deferred=()=>{let resolve!:(value?:void)=>void;let reject!:(reason?:unknown)=>void;const promise=new Promise<void>((ok,no)=>{resolve=ok;reject=no});return{promise,resolve,reject}}

describe('AiLabConsole con ElevenLabs',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.send.mockResolvedValue(pending);mocks.confirm.mockResolvedValue({status:'completed',message:'Listo. Registré el cobro.',questions:[]});mocks.cancel.mockResolvedValue({status:'completed',message:'Acción cancelada.',questions:[]});mocks.revise.mockImplementation(async(value)=>({status:'pending_confirmation',message:'Actualizaré el importe. ¿Confirmas?',questions:[],pendingAction:value}));mocks.speechSpeak.mockResolvedValue(undefined);Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:class{voice=null;lang='';rate=1;pitch=1;volume=1;onend:null|(()=>void)=null;onerror:null|(()=>void)=null;constructor(public text:string){}}});Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel:vi.fn(),speak:vi.fn()}})})
  afterEach(()=>{cleanup();vi.useRealTimers()})

  const startAndSend=async()=>{render(<AiLabConsole onOpenFinance={vi.fn()}/>);fireEvent.click(screen.getByText('Iniciar conversación'));act(()=>mocks.final?.('Hola FARO, registra el cobro de Seguro Hermana'));await act(async()=>{vi.advanceTimersByTime(250);await Promise.resolve()})}

  it('pausa reconocimiento mientras habla y lo reanuda una sola vez al terminar',async()=>{const audio=deferred();mocks.speechSpeak.mockReturnValueOnce(audio.promise);await startAndSend();expect(mocks.speechStop).toHaveBeenCalled();const startsBefore=mocks.speechStart.mock.calls.length;await act(async()=>audio.resolve());expect(mocks.speechStart).toHaveBeenCalledTimes(startsBefore+1)})

  it('usa speechSynthesis una sola vez si ElevenLabs falla',async()=>{mocks.speechSpeak.mockRejectedValueOnce(new Error('provider failed'));await startAndSend();await act(async()=>Promise.resolve());expect(window.speechSynthesis.speak).toHaveBeenCalledOnce()})

  it('detener conversación cancela audio y no reinicia escucha',async()=>{const audio=deferred();mocks.speechSpeak.mockReturnValueOnce(audio.promise);await startAndSend();const startsBefore=mocks.speechStart.mock.calls.length;fireEvent.click(screen.getByText('Detener conversación'));expect(mocks.serviceStop).toHaveBeenCalled();await act(async()=>audio.resolve());expect(mocks.speechStart).toHaveBeenCalledTimes(startsBefore)})

  it('dos confirmaciones rápidas ejecutan la acción pendiente una sola vez',async()=>{mocks.speechSpeak.mockResolvedValue(undefined);const confirmation=deferred();mocks.confirm.mockReturnValueOnce(confirmation.promise);await startAndSend();await act(async()=>Promise.resolve());act(()=>{mocks.final?.('sí, registra el pago');mocks.final?.('sí registró el pago')});expect(mocks.confirm).toHaveBeenCalledOnce();await act(async()=>confirmation.resolve())})

  it('una transcripción final duplicada envía una sola solicitud sin espera artificial',async()=>{render(<AiLabConsole onOpenFinance={vi.fn()} mode="product" surface="today"/>);fireEvent.click(screen.getByText('Iniciar conversación'));act(()=>{mocks.final?.('Hola FARO, gasté 200 en café');mocks.final?.('Hola FARO, gasté 200 en café')});await act(async()=>Promise.resolve());expect(mocks.send).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledWith('gasté 200 en café','voice',[], 'today',expect.objectContaining({pipeline:'optimized',sessionId:expect.any(String),requestId:expect.any(String)}))})

  it('cancelar por voz descarta exactamente la propuesta pendiente',async()=>{await startAndSend();await act(async()=>Promise.resolve());act(()=>mocks.final?.('cancela'));await act(async()=>Promise.resolve());expect(mocks.cancel).toHaveBeenCalledOnce();expect(mocks.cancel).toHaveBeenCalledWith(action);expect(mocks.confirm).not.toHaveBeenCalled()})
  it('persiste en servidor una revisión de monto antes de confirmar',async()=>{await startAndSend();await act(async()=>Promise.resolve());act(()=>mocks.final?.('mejor fueron 1400'));await act(async()=>Promise.resolve());expect(mocks.revise).toHaveBeenCalledOnce();expect(mocks.revise).toHaveBeenCalledWith(expect.objectContaining({requestId:action.requestId,arguments:expect.objectContaining({actualAmount:1400})}))})

  it('permite dictar un título nuevo antes de confirmar Calendar',async()=>{
    mocks.send.mockResolvedValue({status:'pending_confirmation',message:'¿Confirmas?',questions:[],pendingAction:calendarAction})
    mocks.revise.mockImplementation(async(value)=>({status:'pending_confirmation',message:'Usaré el título nuevo. ¿Confirmas?',questions:[],pendingAction:value}))
    render(<AiLabConsole onOpenFinance={vi.fn()}/>)
    fireEvent.click(screen.getByText('Iniciar conversación'))
    act(()=>mocks.final?.('Hola FARO, agrega un evento mañana a las 12 llamado Salida con Iris'))
    await act(async()=>Promise.resolve())
    act(()=>mocks.final?.('cambia el título a'))
    await act(async()=>Promise.resolve())
    expect(screen.getAllByText('Claro. ¿Qué título quieres usar?')).toHaveLength(2)
    act(()=>mocks.final?.('Comida con Iris'))
    await act(async()=>Promise.resolve())
    expect(mocks.revise).toHaveBeenCalledWith(expect.objectContaining({arguments:expect.objectContaining({title:'Comida con Iris'})}))
  })

  it('genera un requestId nuevo y usa sólo el transcript final de cada turno',async()=>{
    mocks.send.mockResolvedValue({status:'completed',message:'Listo',questions:[]})
    render(<AiLabConsole onOpenFinance={vi.fn()} mode="product" surface="today"/>)
    fireEvent.click(screen.getByText('Iniciar conversación'))
    act(()=>mocks.final?.('Hola FARO'))
    await act(async()=>{await Promise.resolve();await Promise.resolve()})
    act(()=>mocks.final?.('¿Qué tengo mañana?'))
    await act(async()=>{await Promise.resolve();await Promise.resolve()})
    act(()=>mocks.final?.('Agrega un evento mañana a las 12 llamado Salida con Iris'))
    await act(async()=>{await Promise.resolve();await Promise.resolve()})
    expect(mocks.send).toHaveBeenCalledTimes(2)
    expect(mocks.send.mock.calls.map((call)=>call[0])).toEqual(['¿Qué tengo mañana?','Agrega un evento mañana a las 12 llamado Salida con Iris'])
    expect(mocks.send.mock.calls[0][4].requestId).not.toBe(mocks.send.mock.calls[1][4].requestId)
  })

  it('emite refresh reactivo sólo después de confirmar una escritura Calendar exitosa',async()=>{
    const refresh=vi.fn()
    window.addEventListener('faro:calendar-updated',refresh)
    mocks.send.mockResolvedValue({status:'pending_confirmation',message:'¿Confirmas?',questions:[],pendingAction:calendarAction})
    mocks.confirm.mockResolvedValue({status:'completed',message:'Listo. Agendé Salida con Iris.',questions:[],result:{reference:{id:calendarAction.arguments.eventId,type:'calendar_event',title:'Salida con Iris'}},qa:{skill:'calendar'}})
    render(<AiLabConsole onOpenFinance={vi.fn()} mode="product" surface="today"/>)
    fireEvent.click(screen.getByText('Iniciar conversación'))
    act(()=>mocks.final?.('Hola FARO, agrega un evento mañana a las 12 llamado Salida con Iris'))
    await act(async()=>Promise.resolve())
    expect(refresh).not.toHaveBeenCalled()
    act(()=>mocks.final?.('Sí'))
    await act(async()=>Promise.resolve())
    expect(refresh).toHaveBeenCalledOnce()
    window.removeEventListener('faro:calendar-updated',refresh)
  })
})
