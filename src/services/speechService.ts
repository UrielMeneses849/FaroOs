import { supabase } from '../lib/supabase/client'
import type { FaroTtsModel } from '../features/voice/voiceSchemas'

type SpeechDependencies = {
  getAccessToken: () => Promise<string>
  endpoint: string
  fetch: typeof window.fetch
  createAudio: (url: string) => HTMLAudioElement
  createObjectURL: (value: Blob | MediaSource) => string
  revokeObjectURL: (url: string) => void
}

export type SpeechPlaybackMode = 'auto' | 'stream' | 'blob'
export type SpeechMetrics = {
  ttsRequestMs: number
  ttsFirstByteMs: number
  audioPlaybackStartMs: number
  ttsTotalMs: number
  mode: 'stream' | 'blob'
  model: FaroTtsModel
  providerModel?: string
}

const abortError = () => new DOMException('Speech playback cancelled.', 'AbortError')
export const isSpeechAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
export class SpeechProviderError extends Error {
  constructor(public readonly providerStatus: number, public readonly providerCode: string | null, public readonly providerMessage: string) { super(providerMessage); this.name = 'SpeechProviderError' }
}

const units = ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve','veinte','veintiuno','veintidos','veintitres','veinticuatro','veinticinco','veintiseis','veintisiete','veintiocho','veintinueve']
const hundreds = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos']
const integerToSpanish = (amount: number): string => {
  if (amount < 30) return units[amount]
  if (amount < 100) { const tens=Math.floor(amount/10)*10;const names:Record<number,string>={30:'treinta',40:'cuarenta',50:'cincuenta',60:'sesenta',70:'setenta',80:'ochenta',90:'noventa'};return amount%10?`${names[tens]} y ${units[amount%10]}`:names[tens] }
  if (amount === 100) return 'cien'
  if (amount < 1000) return `${hundreds[Math.floor(amount/100)]}${amount%100?` ${integerToSpanish(amount%100)}`:''}`
  if (amount < 2000) return `mil${amount%1000?` ${integerToSpanish(amount%1000)}`:''}`
  if (amount < 1_000_000) return `${integerToSpanish(Math.floor(amount/1000))} mil${amount%1000?` ${integerToSpanish(amount%1000)}`:''}`
  return amount.toLocaleString('es-MX')
}
const moneyToSpeech = (raw: string) => { const amount=Number(raw.replace(/,/g,''));if(!Number.isFinite(amount))return`${raw} pesos`;const pesos=Math.floor(amount);const cents=Math.round((amount-pesos)*100);return`${integerToSpanish(pesos)} ${pesos===1?'peso':'pesos'}${cents?` con ${integerToSpanish(cents)} centavos`:''}` }
export const speechSafeText = (value:string) => /^\s*[[{]/.test(value)?'No pude procesar la respuesta. Inténtalo nuevamente.':value
  .replace(/([^\s.!?;,])\s*\n+\s*/g, '$1; ')
  .replace(/\s*\n+\s*/g, ' ')
  .replace(/\b\d{4}-\d{2}-\d{2}\b/g,'')
  .replace(/\$\s*([\d,]+(?:\.\d{1,2})?)/g,(_,amount:string)=>moneyToSpeech(amount))
  .replace(/\s+/g,' ')
  .trim()
  .slice(0,600)

export class SpeechService {
  private controller?: AbortController
  private audio?: HTMLAudioElement
  private objectUrl?: string
  private rejectPlayback?: (reason: unknown) => void

  constructor(private readonly dependencies: SpeechDependencies) {}

  async health(signal?: AbortSignal) {
    const token = await this.dependencies.getAccessToken()
    const response = await this.dependencies.fetch(this.dependencies.endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ type: 'health' }), signal,
    })
    return response.ok
  }

  stop() {
    this.controller?.abort(); this.controller = undefined
    this.audio?.pause(); this.audio?.removeAttribute('src'); this.audio?.load(); this.audio = undefined
    const reject = this.rejectPlayback; this.rejectPlayback = undefined
    if (reject) reject(abortError())
    else if (this.objectUrl) this.dependencies.revokeObjectURL(this.objectUrl)
    this.objectUrl = undefined
  }

  async speak(text: string, options: { model?: FaroTtsModel; mode?: SpeechPlaybackMode } = {}): Promise<SpeechMetrics> {
    this.stop()
    const controller = new AbortController(); this.controller = controller
    const model = options.model ?? 'current'
    const canStream = options.mode !== 'blob' && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported?.('audio/mpeg')
    try {
      if (canStream) {
        try { return await this.requestAndStream(text, model, controller) }
        catch (error) {
          if (isSpeechAbortError(error) || options.mode === 'stream') throw error
          this.clearPlaybackOnly()
        }
      }
      return await this.requestAndPlayBlob(text, model, controller)
    } finally {
      if (this.controller === controller) this.controller = undefined
    }
  }

  private async request(text: string, model: FaroTtsModel, stream: boolean, controller: AbortController) {
    const startedAt = performance.now()
    const token = await this.dependencies.getAccessToken()
    const response = await this.dependencies.fetch(this.dependencies.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ text, model, stream }), signal: controller.signal,
    })
    const ttsRequestMs = performance.now() - startedAt
    if (!response.ok) {
      let payload: { providerStatus?:unknown;providerCode?:unknown;providerMessage?:unknown } = {}
      try { payload = await response.json() as typeof payload } catch { payload = {} }
      throw new SpeechProviderError(typeof payload.providerStatus==='number'?payload.providerStatus:response.status,typeof payload.providerCode==='string'?payload.providerCode:null,typeof payload.providerMessage==='string'?payload.providerMessage:'ElevenLabs rechazó la solicitud.')
    }
    return { response, startedAt, ttsRequestMs, providerModel: response.headers?.get?.('x-faro-model-id') ?? undefined }
  }

  private async requestAndPlayBlob(text: string, model: FaroTtsModel, controller: AbortController) {
    const { response, startedAt, ttsRequestMs, providerModel } = await this.request(text, model, false, controller)
    const { blob, firstByte } = await readAudioBlob(response, startedAt)
    if (controller.signal.aborted) throw abortError()
    const objectUrl = this.dependencies.createObjectURL(blob); const audio = this.dependencies.createAudio(objectUrl)
    this.objectUrl = objectUrl; this.audio = audio
    const audioPlaybackStartMs = await this.playToEnd(audio, startedAt, objectUrl)
    return { ttsRequestMs, ttsFirstByteMs: firstByte, audioPlaybackStartMs, ttsTotalMs: performance.now() - startedAt, mode: 'blob' as const, model, providerModel }
  }

  private async requestAndStream(text: string, model: FaroTtsModel, controller: AbortController) {
    const { response, startedAt, ttsRequestMs, providerModel } = await this.request(text, model, true, controller)
    if (!response.body) throw new Error('El navegador no recibió un stream de audio.')
    const mediaSource = new MediaSource(); const objectUrl = this.dependencies.createObjectURL(mediaSource); const audio = this.dependencies.createAudio(objectUrl)
    this.objectUrl = objectUrl; this.audio = audio
    let ttsFirstByteMs = 0; let audioPlaybackStartMs = 0
    const ended = this.waitForEnd(audio, objectUrl)
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => reject(error)
      mediaSource.addEventListener('sourceopen', async () => {
        try {
          const source = mediaSource.addSourceBuffer('audio/mpeg'); const reader = response.body!.getReader(); let started = false
          while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            if (!chunk.value?.byteLength) continue
            if (!ttsFirstByteMs) ttsFirstByteMs = performance.now() - startedAt
            await appendChunk(source, chunk.value)
            if (!started) { started = true; await audio.play(); audioPlaybackStartMs = performance.now() - startedAt }
          }
          if (mediaSource.readyState === 'open') mediaSource.endOfStream()
          resolve()
        } catch (error) { fail(error) }
      }, { once: true })
      mediaSource.addEventListener('error', () => fail(new Error('MediaSource no pudo reproducir el stream.')), { once: true })
    })
    await ended
    return { ttsRequestMs, ttsFirstByteMs, audioPlaybackStartMs, ttsTotalMs: performance.now() - startedAt, mode: 'stream' as const, model, providerModel }
  }

  private waitForEnd(audio: HTMLAudioElement, objectUrl: string) {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return; settled = true; this.rejectPlayback = undefined; audio.onended = null; audio.onerror = null
        if (this.audio === audio) this.audio = undefined
        if (this.objectUrl === objectUrl) this.objectUrl = undefined
        this.dependencies.revokeObjectURL(objectUrl)
        if (error) reject(error); else resolve()
      }
      this.rejectPlayback = (reason) => finish(reason)
      audio.onended = () => finish(); audio.onerror = () => finish(new Error('No fue posible reproducir la voz de FARO.'))
    })
  }

  private async playToEnd(audio: HTMLAudioElement, startedAt: number, objectUrl: string) {
    const ended = this.waitForEnd(audio, objectUrl)
    await audio.play(); const playbackStart = performance.now() - startedAt
    await ended
    return playbackStart
  }

  private clearPlaybackOnly() {
    this.audio?.pause(); this.audio?.removeAttribute('src'); this.audio?.load(); this.audio = undefined
    if (this.objectUrl) this.dependencies.revokeObjectURL(this.objectUrl)
    this.objectUrl = undefined; this.rejectPlayback = undefined
  }
}

function appendChunk(source: SourceBuffer, chunk: Uint8Array) {
  return new Promise<void>((resolve, reject) => {
    const done = () => { cleanup(); resolve() }; const fail = () => { cleanup(); reject(new Error('No fue posible anexar audio al stream.')) }
    const cleanup = () => { source.removeEventListener('updateend', done); source.removeEventListener('error', fail) }
    source.addEventListener('updateend', done, { once: true }); source.addEventListener('error', fail, { once: true }); const copy=new Uint8Array(chunk.byteLength);copy.set(chunk);source.appendBuffer(copy.buffer)
  })
}

async function readAudioBlob(response: Response, startedAt: number) {
  if (!response.body) return { blob: await response.blob(), firstByte: Number.NaN }
  const reader=response.body.getReader();const chunks:ArrayBuffer[]=[];let firstByte=Number.NaN
  while(true){const chunk=await reader.read();if(chunk.done)break;if(chunk.value?.byteLength){if(!Number.isFinite(firstByte))firstByte=performance.now()-startedAt;const copy=new Uint8Array(chunk.value.byteLength);copy.set(chunk.value);chunks.push(copy.buffer)}}
  return { blob:new Blob(chunks,{type:response.headers.get('Content-Type')??'audio/mpeg'}), firstByte }
}

export const speechService = new SpeechService({
  getAccessToken: async () => { const { data: { session } } = await supabase.auth.getSession(); if (!session) throw new Error('Tu sesión de FARO expiró.'); return session.access_token },
  endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/faro-speech`, fetch: window.fetch.bind(window),
  createAudio: (url) => new Audio(url), createObjectURL: (value) => URL.createObjectURL(value), revokeObjectURL: (url) => URL.revokeObjectURL(url),
})
