import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfiguredFaroVoiceAdapters, type VoiceInputAdapter, type VoiceRecognition } from '../../core/voice/adapters'
import { webVoiceInputAdapter } from './webVoiceAdapters'

export type SpeechInputMetrics = { provider: 'web-speech'; firstResultMs?: number; finalResultMs?: number }

export function useSpeechInput(
  onTranscript: (value: string) => void,
  onFinal?: (value: string) => void,
  onMetrics?: (value: SpeechInputMetrics) => void,
  adapter: VoiceInputAdapter = getConfiguredFaroVoiceAdapters().input ?? webVoiceInputAdapter,
) {
  const ref = useRef<VoiceRecognition | null>(null)
  const startedAt = useRef(0)
  const firstResult = useRef<number | undefined>(undefined)
  const lastFinal = useRef({ value: '', at: 0 })
  const keepContinuous = useRef(false)
  const restartTimer = useRef<number | undefined>(undefined)
  const startRef = useRef<(continuous?: boolean) => void>(() => undefined)
  const [state, setState] = useState<'idle' | 'listening' | 'processing' | 'error' | 'denied'>('idle')
  const supported = adapter.isSupported()

  const stop = useCallback(() => {
    keepContinuous.current = false
    window.clearTimeout(restartTimer.current)
    if (ref.current) {
      setState('processing')
      ref.current.stop()
    }
  }, [])

  const start = useCallback((continuous = false) => {
    if (ref.current) return
    keepContinuous.current = continuous
    const recognition = adapter.createRecognition()
    if (!recognition) {
      keepContinuous.current = false
      setState('error')
      return
    }
    ref.current = recognition
    startedAt.current = performance.now()
    firstResult.current = undefined
    recognition.lang = 'es-MX'
    recognition.interimResults = true
    recognition.continuous = continuous
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1]
      const value = result?.[0]?.transcript?.trim()
      if (!value) return
      const elapsed = performance.now() - startedAt.current
      if (firstResult.current === undefined) firstResult.current = elapsed
      onTranscript(value)
      if (!result.isFinal) return
      onMetrics?.({ provider: 'web-speech', firstResultMs: firstResult.current, finalResultMs: elapsed })
      const normalized = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
      const now = Date.now()
      if (lastFinal.current.value === normalized && now - lastFinal.current.at <= 2_000) return
      lastFinal.current = { value: normalized, at: now }
      onFinal?.(value)
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        keepContinuous.current = false
        setState('denied')
        return
      }
      if (event.error === 'no-speech' && keepContinuous.current) {
        setState('idle')
        return
      }
      if (event.error === 'aborted' && !keepContinuous.current) {
        setState('idle')
        return
      }
      keepContinuous.current = false
      setState('error')
    }
    recognition.onend = () => {
      const isCurrent = ref.current === recognition
      if (isCurrent) ref.current = null
      setState((current) => current === 'denied' || current === 'error' ? current : 'idle')
      if (!isCurrent || !keepContinuous.current) return
      window.clearTimeout(restartTimer.current)
      restartTimer.current = window.setTimeout(() => {
        if (keepContinuous.current && !ref.current) startRef.current(true)
      }, 180)
    }
    setState('listening')
    try {
      recognition.start()
    } catch {
      ref.current = null
      keepContinuous.current = false
      setState('error')
    }
  }, [adapter, onFinal, onMetrics, onTranscript])

  useEffect(() => { startRef.current = start }, [start])
  useEffect(() => () => {
    keepContinuous.current = false
    window.clearTimeout(restartTimer.current)
    ref.current?.abort()
    ref.current = null
  }, [])

  return { supported, state, start, stop }
}
