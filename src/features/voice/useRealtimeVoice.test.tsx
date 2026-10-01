import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeVoice } from './useRealtimeVoice'
import type { WakeListeningAdapter } from '../../core/voice/adapters'
vi.mock('../../services/voiceService', () => ({ voiceService: { createRealtimeSession: vi.fn() } }))
afterEach(() => vi.useRealTimers())
describe('Realtime microphone lifecycle', () => {
  it('times out an unanswered microphone request and releases a late stream', async () => {
    vi.useFakeTimers()
    let resolveMic!: (stream: MediaStream) => void
    const close = vi.fn()
    const stopTrack = vi.fn()
    const adapter = { isSupported: () => true, createPeerConnection: () => ({ close }), requestMicrophone: () => new Promise<MediaStream>(resolve => { resolveMic = resolve }) } as unknown as WakeListeningAdapter
    const { result } = renderHook(() => useRealtimeVoice(vi.fn(), undefined, undefined, adapter))
    let pending!: Promise<void>
    act(() => { pending = result.current.start() })
    expect(result.current.capturing).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); await pending })
    expect(result.current.error).toContain('No pude activar la voz')
    expect(result.current.connecting).toBe(false)
    expect(close).toHaveBeenCalled()
    await act(async () => { resolveMic({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream) })
    expect(stopTrack).toHaveBeenCalledOnce()
    expect(result.current.capturing).toBe(false)
  })
  it('shows actionable permission denial instead of claiming to listen', async () => {
    const adapter = { isSupported: () => true, createPeerConnection: () => ({ close: vi.fn() }), requestMicrophone: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) } as unknown as WakeListeningAdapter
    const { result } = renderHook(() => useRealtimeVoice(vi.fn(), undefined, undefined, adapter))
    await act(async () => { await result.current.start() })
    expect(result.current.error).toContain('Privacidad y seguridad')
    expect(result.current.listening).toBe(false)
  })
})
