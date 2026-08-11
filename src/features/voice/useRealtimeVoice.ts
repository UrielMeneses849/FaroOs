import { useCallback, useRef, useState } from 'react'
import { voiceService } from '../../services/voiceService'

export interface RealtimeTranscriptMeta { speechDurationMs?: number }

export function useRealtimeVoice(onTranscript: (text: string, meta: RealtimeTranscriptMeta) => void, onSpeechStarted?: () => void) {
  const peer = useRef<RTCPeerConnection | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState<{ connectionMs?: number; speechToFinalMs?: number; speechDurationMs?: number }>({})
  const speechStartedAt = useRef<number | undefined>(undefined)
  const completedSpeechDuration = useRef<number | undefined>(undefined)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    peer.current?.close()
    stream.current = null
    peer.current = null
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    stop()
    setError('')
    const connectionStartedAt = performance.now()
    const pc = new RTCPeerConnection()
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    microphone.getTracks().forEach((track) => pc.addTrack(track, microphone))
    const channel = pc.createDataChannel('oai-events')
    channel.onmessage = (event) => {
      let payload: { type?: string; transcript?: string }
      try { payload = JSON.parse(event.data) as { type?: string; transcript?: string } }
      catch { return }
      if (payload.type === 'input_audio_buffer.speech_started') { speechStartedAt.current = performance.now(); onSpeechStarted?.() }
      if (payload.type === 'input_audio_buffer.speech_stopped' && speechStartedAt.current) {
        completedSpeechDuration.current = performance.now() - speechStartedAt.current
        setMetrics(current => ({ ...current, speechDurationMs: completedSpeechDuration.current }))
      }
      if (payload.type === 'conversation.item.input_audio_transcription.completed' && payload.transcript) {
        if (speechStartedAt.current) setMetrics(current => ({ ...current, speechToFinalMs: performance.now() - speechStartedAt.current! }))
        onTranscript(payload.transcript, { speechDurationMs: completedSpeechDuration.current })
        completedSpeechDuration.current = undefined
        speechStartedAt.current = undefined
      }
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const answer = await voiceService.createRealtimeSession(offer.sdp ?? '')
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    peer.current = pc
    stream.current = microphone
    setListening(true)
    setMetrics(current => ({ ...current, connectionMs: performance.now() - connectionStartedAt }))
  }, [onSpeechStarted, onTranscript, stop])

  const safeStart = useCallback(async () => { try { await start() } catch (cause) { stop(); setError(cause instanceof Error ? cause.message : 'No fue posible iniciar OpenAI Realtime.') } }, [start, stop])
  return { supported: typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia), listening, start: safeStart, stop, metrics, error }
}
