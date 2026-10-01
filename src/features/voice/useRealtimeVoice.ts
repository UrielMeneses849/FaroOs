import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfiguredFaroVoiceAdapters, type WakeListeningAdapter } from '../../core/voice/adapters'
import { observeVoiceAudio } from '../../desktop/mini/voiceAudioMeter'
import { isFaroTauriRuntime } from '../../core/platform/runtime'
import { voiceService } from '../../services/voiceService'
import { webWakeListeningAdapter } from './webVoiceAdapters'

export interface RealtimeTranscriptMeta { speechDurationMs?: number }

export function useRealtimeVoice(onTranscript: (text: string, meta: RealtimeTranscriptMeta) => void, onSpeechStarted?: () => void, onPartialTranscript?: (text: string) => void, adapter: WakeListeningAdapter = getConfiguredFaroVoiceAdapters().wake ?? webWakeListeningAdapter) {
  const generation = useRef(0)
  const stopMeter = useRef<(() => void) | undefined>(undefined)
  const peer = useRef<RTCPeerConnection | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const startInFlight = useRef<Promise<void> | null>(null)
  const [listening, setListening] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  // A transcription may fail for a single VAD turn while the WebRTC session
  // and microphone are perfectly healthy. Keep that separate from a fatal
  // connection error so the Mini does not close its mic after one noisy turn.
  const [warning, setWarning] = useState('')
  const [metrics, setMetrics] = useState<{ connectionMs?: number; speechToFinalMs?: number; speechDurationMs?: number }>({})
  const speechStartedAt = useRef<number | undefined>(undefined)
  const completedSpeechDuration = useRef<number | undefined>(undefined)

  const stop = useCallback(() => {
    generation.current += 1
    stopMeter.current?.(); stopMeter.current = undefined
    stream.current?.getTracks().forEach((track) => track.stop())
    peer.current?.close()
    stream.current = null
    peer.current = null
    startInFlight.current = null
    setListening(false)
    setCapturing(false)
    setConnecting(false)
  }, [])

  const start = useCallback(() => {
    const activePeer = peer.current
    const activeStream = stream.current
    if (activePeer?.connectionState === 'connected' && activeStream?.active) {
      setListening(true)
      setConnecting(false)
      return Promise.resolve()
    }
    if (startInFlight.current) return startInFlight.current

    const connect = async () => {
      stop()
      setError('')
      setConnecting(true)
      const connectionStartedAt = performance.now()
      const pc = adapter.createPeerConnection()
      peer.current = pc
      const microphone = await adapter.requestMicrophone()
      if (peer.current !== pc) { microphone.getTracks().forEach(track => track.stop()); return }
      // Register immediately so every failed setup path releases the native mic.
      peer.current = pc
      stream.current = microphone
      if (isFaroTauriRuntime()) stopMeter.current = observeVoiceAudio(microphone, (level) => window.dispatchEvent(new CustomEvent('faro:voice-audio-level', { detail: level })))
      setCapturing(true)
      microphone.getTracks().forEach((track) => pc.addTrack(track, microphone))
      const channel = pc.createDataChannel('oai-events')
      channel.onmessage = (event) => {
        if (peer.current !== pc) return
        let payload: { type?: string; transcript?: string; delta?: string; error?: { message?: string } }
        try { payload = JSON.parse(event.data) as { type?: string; transcript?: string; delta?: string; error?: { message?: string } }
        } catch { return }
        if (payload.type === 'input_audio_buffer.speech_started') {
          speechStartedAt.current = performance.now()
          setWarning('')
          onSpeechStarted?.()
        }
        if (payload.type === 'input_audio_buffer.speech_stopped' && speechStartedAt.current) {
          completedSpeechDuration.current = performance.now() - speechStartedAt.current
          setMetrics(current => ({ ...current, speechDurationMs: completedSpeechDuration.current }))
        }
        if (payload.type === 'conversation.item.input_audio_transcription.completed' && payload.transcript) {
          if (speechStartedAt.current) setMetrics(current => ({ ...current, speechToFinalMs: performance.now() - speechStartedAt.current! }))
          setWarning('')
          onTranscript(payload.transcript, { speechDurationMs: completedSpeechDuration.current })
          completedSpeechDuration.current = undefined
          speechStartedAt.current = undefined
        }
        if (payload.type === 'conversation.item.input_audio_transcription.delta' && payload.delta) onPartialTranscript?.(payload.delta)
        if (payload.type === 'input_audio_buffer.transcription.failed' || payload.type === 'conversation.item.input_audio_transcription.failed') {
          completedSpeechDuration.current = undefined
          speechStartedAt.current = undefined
          setWarning('No alcancé a oírte completo. Inténtalo otra vez sin cerrar el micrófono.')
        }
        if (payload.type === 'error') setError(payload.error?.message || 'La conexión de voz de FARO falló.')
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const answer = await voiceService.createRealtimeSession(offer.sdp ?? '')
      if (peer.current !== pc) return
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
      await waitForRealtimeConnection(pc)
      if (peer.current !== pc) return
      pc.addEventListener('connectionstatechange', () => {
        if (peer.current === pc && pc.connectionState === 'failed') setError('Se perdió la conexión de voz. Vuelve a abrir el micrófono.')
      })
      setListening(true)
      setConnecting(false)
      setMetrics(current => ({ ...current, connectionMs: performance.now() - connectionStartedAt }))
    }
    const pending = connect()
    startInFlight.current = pending
    void pending.then(() => {
      if (startInFlight.current === pending) startInFlight.current = null
    }, () => {
      if (startInFlight.current === pending) startInFlight.current = null
    })
    return pending
  }, [adapter, onPartialTranscript, onSpeechStarted, onTranscript, stop])

  const safeStart = useCallback(async () => {
    const pending = start()
    const attempt = generation.current
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([pending, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('No pude activar la voz. Revisa el permiso de micrófono de FARO y tu conexión, y vuelve a intentar.')), 20000)
      })])
    } catch (cause) {
      if (generation.current === attempt) {
        stop()
        setError(typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'NotAllowedError' ? 'FARO no tiene permiso de micrófono. Actívalo en Ajustes del Sistema → Privacidad y seguridad → Micrófono.' : cause instanceof Error ? cause.message : 'No fue posible iniciar OpenAI Realtime.')
      }
    } finally { clearTimeout(timeout) }
  }, [start, stop])
  useEffect(() => () => {
    generation.current += 1
    stopMeter.current?.(); stopMeter.current = undefined
    stream.current?.getTracks().forEach((track) => track.stop())
    peer.current?.close()
    stream.current = null
    peer.current = null
  }, [])
  return { supported: adapter.isSupported(), listening, capturing, connecting, start: safeStart, stop, metrics, error, warning }
}

function waitForRealtimeConnection(peer: RTCPeerConnection) {
  if (peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('FARO no pudo conectar la transcripción en tiempo real.')), 6_000)
    const check = () => {
      if (peer.connectionState === 'connected' || peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') finish()
      else if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') finish(new Error('La conexión de voz de FARO falló.'))
    }
    const finish = (error?: Error) => {
      window.clearTimeout(timeout)
      peer.removeEventListener('connectionstatechange', check)
      peer.removeEventListener('iceconnectionstatechange', check)
      if (error) reject(error)
      else resolve()
    }
    peer.addEventListener('connectionstatechange', check)
    peer.addEventListener('iceconnectionstatechange', check)
    check()
  })
}
