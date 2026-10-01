/** Platform contracts used by FARO Voice. They intentionally contain no domain
 * rules, prompts, router decisions, Supabase calls, or UI state. */
export type VoiceRecognitionEvent = {
  results: ArrayLike<{ 0: { transcript: string }; isFinal?: boolean }>
}

export type VoiceRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: VoiceRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
}

export interface VoiceInputAdapter {
  id: string
  isSupported(): boolean
  createRecognition(): VoiceRecognition | undefined
}

export interface AudioPlaybackAdapter {
  id: string
  supportsStreaming(): boolean
  createAudio(url: string): HTMLAudioElement
  createObjectURL(value: Blob | MediaSource): string
  revokeObjectURL(url: string): void
  createMediaSource(): MediaSource
  stopFallback(): void
  speakFallback(text: string, onEnd: () => void): boolean
}

export interface WakeListeningAdapter {
  id: string
  isSupported(): boolean
  requestMicrophone(): Promise<MediaStream>
  createPeerConnection(): RTCPeerConnection
  /** Optional low-power, on-device wake engine. Product Voice never requires it. */
  localWake?: LocalWakeEngine
}

export type LocalWakeState = 'unavailable' | 'loading' | 'standby' | 'detected' | 'error'

export interface LocalWakeEngine {
  isAvailable(): Promise<boolean>
  start(options: { onDetected: (detail: { score: number; latencyMs: number }) => void; onLevel?: (level: number) => void; onState?: (state: LocalWakeState) => void }): Promise<void>
  stop(): Promise<void>
  isListening(): boolean
}

export interface FaroVoiceAdapters {
  input: VoiceInputAdapter
  audio: AudioPlaybackAdapter
  wake: WakeListeningAdapter
}

let configuredAdapters: Partial<FaroVoiceAdapters> = {}

export function configureFaroVoiceAdapters(adapters: Partial<FaroVoiceAdapters>) {
  configuredAdapters = { ...configuredAdapters, ...adapters }
}

export function getConfiguredFaroVoiceAdapters() {
  return configuredAdapters
}

export function resetFaroVoiceAdaptersForTests() {
  configuredAdapters = {}
}
