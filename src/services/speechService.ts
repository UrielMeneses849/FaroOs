import { supabase } from '../lib/supabase/client'

type SpeechDependencies = {
  getAccessToken: () => Promise<string>
  endpoint: string
  fetch: typeof window.fetch
  createAudio: (url: string) => HTMLAudioElement
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
}

const abortError = () => new DOMException('Speech playback cancelled.', 'AbortError')
export const isSpeechAbortError = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
export class SpeechProviderError extends Error {
  constructor(public readonly providerStatus: number, public readonly providerCode: string | null, public readonly providerMessage: string) { super(providerMessage);this.name='SpeechProviderError' }
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
export const speechSafeText = (value:string) => /^\s*[[{]/.test(value)?'No pude procesar la respuesta. Inténtalo nuevamente.':value.replace(/\b\d{4}-\d{2}-\d{2}\b/g,'').replace(/\$\s*([\d,]+(?:\.\d{1,2})?)/g,(_,amount:string)=>moneyToSpeech(amount)).replace(/\s+/g,' ').trim().slice(0,220)

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
    this.controller?.abort()
    this.controller = undefined
    this.audio?.pause()
    this.audio?.removeAttribute('src')
    this.audio?.load()
    this.audio = undefined
    const reject = this.rejectPlayback
    this.rejectPlayback = undefined
    if (reject) reject(abortError())
    else if (this.objectUrl) this.dependencies.revokeObjectURL(this.objectUrl)
    this.objectUrl = undefined
  }

  async speak(text: string) {
    this.stop()
    const startedAt = performance.now()
    const controller = new AbortController()
    this.controller = controller
    const token = await this.dependencies.getAccessToken()
    const response = await this.dependencies.fetch(this.dependencies.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!response.ok) {
      let payload: { providerStatus?:unknown;providerCode?:unknown;providerMessage?:unknown } = {}
      try { payload = await response.json() as typeof payload } catch { payload = {} }
      throw new SpeechProviderError(typeof payload.providerStatus==='number'?payload.providerStatus:response.status,typeof payload.providerCode==='string'?payload.providerCode:null,typeof payload.providerMessage==='string'?payload.providerMessage:'ElevenLabs rechazó la solicitud.')
    }
    const blob = await response.blob()
    if (import.meta.env.DEV) console.debug('[FARO Voice]', { stage: 'faro-speech', durationMs: Math.round(performance.now() - startedAt) })
    if (controller.signal.aborted) throw abortError()
    const objectUrl = this.dependencies.createObjectURL(blob)
    const audio = this.dependencies.createAudio(objectUrl)
    this.objectUrl = objectUrl
    this.audio = audio

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown) => {
        if (settled) return
        settled = true
        this.rejectPlayback = undefined
        audio.onended = null
        audio.onerror = null
        if (this.audio === audio) this.audio = undefined
        if (this.objectUrl === objectUrl) this.objectUrl = undefined
        this.dependencies.revokeObjectURL(objectUrl)
        if (error) reject(error)
        else resolve()
      }
      this.rejectPlayback = (reason) => finish(reason)
      audio.onended = () => finish()
      audio.onerror = () => finish(new Error('No fue posible reproducir la voz de FARO.'))
      void audio.play().then(() => {
        if (import.meta.env.DEV) console.debug('[FARO Voice]', { stage: 'audio-start', durationMs: Math.round(performance.now() - startedAt) })
      }).catch((error) => finish(error))
    })
    if (this.controller === controller) this.controller = undefined
  }
}

export const speechService = new SpeechService({
  getAccessToken: async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Tu sesión de FARO expiró.')
    return session.access_token
  },
  endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/faro-speech`,
  fetch: window.fetch.bind(window),
  createAudio: (url) => new Audio(url),
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
})
