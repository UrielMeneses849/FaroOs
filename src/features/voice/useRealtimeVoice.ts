import { useCallback, useRef, useState } from 'react'
import { voiceService } from '../../services/voiceService'

export function useRealtimeVoice(onTranscript: (text: string) => void) {
  const peer = useRef<RTCPeerConnection | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const [listening, setListening] = useState(false)

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    peer.current?.close()
    stream.current = null
    peer.current = null
    setListening(false)
  }, [])

  const start = useCallback(async () => {
    stop()
    const pc = new RTCPeerConnection()
    const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
    microphone.getTracks().forEach((track) => pc.addTrack(track, microphone))
    const audio = document.createElement('audio')
    audio.autoplay = true
    pc.ontrack = (event) => { audio.srcObject = event.streams[0] }
    const channel = pc.createDataChannel('oai-events')
    channel.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { type?: string; transcript?: string }
      if (payload.type === 'conversation.item.input_audio_transcription.completed' && payload.transcript) {
        onTranscript(payload.transcript)
      }
    }
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const answer = await voiceService.createRealtimeSession(offer.sdp ?? '')
    await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    peer.current = pc
    stream.current = microphone
    setListening(true)
  }, [onTranscript, stop])

  return { listening, start, stop }
}

