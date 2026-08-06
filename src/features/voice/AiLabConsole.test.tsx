import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiLabConsole } from './AiLabConsole'

const mocks = vi.hoisted(() => ({
  speechStart: vi.fn(), speechStop: vi.fn(), speechSpeak: vi.fn(), serviceStop: vi.fn(),
  send: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), final: undefined as ((value:string)=>void)|undefined,
}))

vi.mock('./useSpeechInput', () => ({ useSpeechInput: (_transcript:(value:string)=>void, final:(value:string)=>void) => { mocks.final=final;return {supported:true,state:'idle',start:mocks.speechStart,stop:mocks.speechStop} } }))
vi.mock('../../services/speechService', () => ({ speechService:{speak:mocks.speechSpeak,stop:mocks.serviceStop},speechSafeText:(value:string)=>value,isSpeechAbortError:(error:unknown)=>error instanceof DOMException&&error.name==='AbortError' }))
vi.mock('../../services/voiceService', () => ({ voiceService:{send:mocks.send,confirm:mocks.confirm,cancel:mocks.cancel} }))

const action={requestId:'48e30c50-e4bb-44a0-bdeb-bf098b2c3547',toolName:'registerRecurringPayment' as const,arguments:{recurringId:'seguro',period:'2026-08-01',expectedDate:'2026-08-06',actualAmount:700},summary:'Seguro Hermana por $700'}
const pending={status:'pending_confirmation' as const,message:'Encontré Seguro Hermana por $700. ¿Confirmas?',questions:[],pendingAction:action}
const deferred=()=>{let resolve!:(value?:void)=>void;let reject!:(reason?:unknown)=>void;const promise=new Promise<void>((ok,no)=>{resolve=ok;reject=no});return{promise,resolve,reject}}

describe('AiLabConsole con ElevenLabs',()=>{
  beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.send.mockResolvedValue(pending);mocks.confirm.mockResolvedValue({status:'completed',message:'Listo. Registré el cobro.',questions:[]});mocks.cancel.mockResolvedValue({status:'completed',message:'Acción cancelada.',questions:[]});mocks.speechSpeak.mockResolvedValue(undefined);Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{configurable:true,value:class{voice=null;lang='';rate=1;pitch=1;volume=1;onend:null|(()=>void)=null;onerror:null|(()=>void)=null;constructor(public text:string){}}});Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{cancel:vi.fn(),speak:vi.fn()}})})
  afterEach(()=>{cleanup();vi.useRealTimers()})

  const startAndSend=async()=>{render(<AiLabConsole onOpenFinance={vi.fn()}/>);fireEvent.click(screen.getByText('Iniciar conversación'));act(()=>mocks.final?.('FARO, registra el cobro de Seguro Hermana'));await act(async()=>{vi.advanceTimersByTime(250);await Promise.resolve()})}

  it('pausa reconocimiento mientras habla y lo reanuda una sola vez al terminar',async()=>{const audio=deferred();mocks.speechSpeak.mockReturnValueOnce(audio.promise);await startAndSend();expect(mocks.speechStop).toHaveBeenCalled();const startsBefore=mocks.speechStart.mock.calls.length;await act(async()=>audio.resolve());expect(mocks.speechStart).toHaveBeenCalledTimes(startsBefore+1)})

  it('usa speechSynthesis una sola vez si ElevenLabs falla',async()=>{mocks.speechSpeak.mockRejectedValueOnce(new Error('provider failed'));await startAndSend();await act(async()=>Promise.resolve());expect(window.speechSynthesis.speak).toHaveBeenCalledOnce()})

  it('detener conversación cancela audio y no reinicia escucha',async()=>{const audio=deferred();mocks.speechSpeak.mockReturnValueOnce(audio.promise);await startAndSend();const startsBefore=mocks.speechStart.mock.calls.length;fireEvent.click(screen.getByText('Detener conversación'));expect(mocks.serviceStop).toHaveBeenCalled();await act(async()=>audio.resolve());expect(mocks.speechStart).toHaveBeenCalledTimes(startsBefore)})

  it('dos confirmaciones rápidas ejecutan la acción pendiente una sola vez',async()=>{mocks.speechSpeak.mockResolvedValue(undefined);const confirmation=deferred();mocks.confirm.mockReturnValueOnce(confirmation.promise);await startAndSend();await act(async()=>Promise.resolve());act(()=>{mocks.final?.('sí, registra el pago');mocks.final?.('sí registró el pago')});expect(mocks.confirm).toHaveBeenCalledOnce();await act(async()=>confirmation.resolve())})

  it('una transcripción final duplicada envía una sola solicitud',async()=>{render(<AiLabConsole onOpenFinance={vi.fn()} mode="product" surface="today"/>);fireEvent.click(screen.getByText('Iniciar conversación'));act(()=>{mocks.final?.('FARO, gasté 200 en café');mocks.final?.('FARO, gasté 200 en café');vi.advanceTimersByTime(250)});await act(async()=>Promise.resolve());expect(mocks.send).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledWith('gasté 200 en café','voice',[], 'today')})

  it('cancelar por voz descarta exactamente la propuesta pendiente',async()=>{await startAndSend();await act(async()=>Promise.resolve());act(()=>mocks.final?.('cancela'));await act(async()=>Promise.resolve());expect(mocks.cancel).toHaveBeenCalledOnce();expect(mocks.cancel).toHaveBeenCalledWith(action);expect(mocks.confirm).not.toHaveBeenCalled()})
})
