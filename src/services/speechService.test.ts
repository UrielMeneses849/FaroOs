import { describe, expect, it, vi } from 'vitest'
import { SpeechProviderError, SpeechService, speechSafeText } from './speechService'

type AudioMock = HTMLAudioElement & { play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn> }

function setup() {
  const audios: AudioMock[] = []
  const audioBlob = new Blob(['mp3'], { type: 'audio/mpeg' })
  const fetch = vi.fn(async (...request: [RequestInfo | URL, RequestInit?]) => {
    void request
    return { ok: true, status: 200, blob: async () => audioBlob, json: async () => ({}) } as Response
  })
  const revokeObjectURL = vi.fn()
  const createObjectURL = vi.fn(() => `blob:${audios.length + 1}`)
  const createAudio = vi.fn(() => {
    const audio = { play: vi.fn(async () => undefined), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null } as unknown as AudioMock
    audios.push(audio)
    return audio
  })
  const service = new SpeechService({ getAccessToken: async () => 'token', endpoint: 'https://example.test/faro-speech', fetch: fetch as unknown as typeof window.fetch, createAudio, createObjectURL, revokeObjectURL })
  return { service, audios, fetch, createObjectURL, revokeObjectURL }
}

describe('speechService', () => {
  it('comprueba faro-speech sin solicitar audio', async()=>{const {service,fetch}=setup();await expect(service.health()).resolves.toBe(true);expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({type:'health'})})
  it('prepara montos para una lectura natural',()=>expect(speechSafeText('Registré $700.00 el 2026-08-06.')).toBe('Registré setecientos pesos el .'))
  it('envía sin campos adicionales el texto de diagnóstico aislado',async()=>{const {service,audios,fetch}=setup();const text='Hola. Soy FARO. La conexión de voz está funcionando.';const playback=service.speak(text);await vi.waitFor(()=>expect(audios).toHaveLength(1));expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({text});audios[0].onended?.(new Event('ended'));await playback})
  it('conserva el status, código y mensaje seguros del proveedor',async()=>{const {service,fetch}=setup();fetch.mockResolvedValueOnce({ok:false,status:400,json:async()=>({error:'speech_provider_failed',providerStatus:400,providerCode:'voice_not_found',providerMessage:'Voice not found.'})} as Response);const error=await service.speak('Prueba').catch(cause=>cause);expect(error).toBeInstanceOf(SpeechProviderError);expect(error).toMatchObject({providerStatus:400,providerCode:'voice_not_found',providerMessage:'Voice not found.'})})
  it('reproduce el Blob recibido y libera la URL al terminar', async () => {
    const { service, audios, fetch, revokeObjectURL } = setup()
    const playback = service.speak('Hola, soy FARO.')
    await vi.waitFor(() => expect(audios).toHaveLength(1))
    expect(fetch).toHaveBeenCalledOnce()
    expect(audios[0].play).toHaveBeenCalledOnce()
    audios[0].onended?.(new Event('ended'))
    await playback
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:1')
  })

  it('cancela y limpia la reproducción anterior antes de iniciar otra', async () => {
    const { service, audios, revokeObjectURL } = setup()
    const first = service.speak('Primera')
    const firstResult = first.catch((error: unknown) => error)
    await vi.waitFor(() => expect(audios).toHaveLength(1))
    const second = service.speak('Segunda')
    await expect(firstResult).resolves.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(audios).toHaveLength(2))
    expect(audios[0].pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(audios[1].play).toHaveBeenCalledOnce()
    audios[1].onended?.(new Event('ended'))
    await second
  })

  it('stop cancela audio, fetch y URL sin dejar reproducción activa', async () => {
    const { service, audios, revokeObjectURL } = setup()
    const playback = service.speak('Detener')
    const playbackResult = playback.catch((error: unknown) => error)
    await vi.waitFor(() => expect(audios).toHaveLength(1))
    service.stop()
    await expect(playbackResult).resolves.toMatchObject({ name: 'AbortError' })
    expect(audios[0].pause).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
  })
})
