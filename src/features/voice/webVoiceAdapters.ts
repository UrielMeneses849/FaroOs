import type { AudioPlaybackAdapter, VoiceInputAdapter, VoiceRecognition, WakeListeningAdapter } from '../../core/voice/adapters'

type RecognitionCtor = new () => VoiceRecognition

function webRecognitionConstructor() {
  if (typeof window === 'undefined') return undefined
  const scope = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition
}

export const webVoiceInputAdapter: VoiceInputAdapter = {
  id: 'web-speech',
  isSupported: () => Boolean(webRecognitionConstructor()),
  createRecognition: () => {
    const Constructor = webRecognitionConstructor()
    return Constructor ? new Constructor() : undefined
  },
}

export const webAudioPlaybackAdapter: AudioPlaybackAdapter = {
  id: 'web-audio',
  supportsStreaming: () => typeof MediaSource !== 'undefined' && Boolean(MediaSource.isTypeSupported?.('audio/mpeg')),
  createAudio: (url) => new Audio(url),
  createObjectURL: (value) => URL.createObjectURL(value),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  createMediaSource: () => new MediaSource(),
  stopFallback: () => { window.speechSynthesis?.cancel() },
  speakFallback: (text, onEnd) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'es-MX'
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1
    utterance.onend = onEnd
    utterance.onerror = onEnd
    window.speechSynthesis.speak(utterance)
    return true
  },
}

export const webWakeListeningAdapter: WakeListeningAdapter = {
  id: 'web-realtime',
  isSupported: () => typeof RTCPeerConnection !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
  requestMicrophone: () => navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }),
  createPeerConnection: () => new RTCPeerConnection(),
}
