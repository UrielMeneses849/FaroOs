import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeVoiceAudio } from './voiceAudioMeter'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('Existing-stream audio observer', () => {
  it('computes a real level and releases its observer without stopping Voice tracks', () => {
    vi.useFakeTimers()
    const close = vi.fn().mockResolvedValue(undefined)
    const disconnect = vi.fn()
    const stopTrack = vi.fn()
    const stream = { active: true, getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
    class AudioContextMock {
      close = close
      resume = vi.fn().mockResolvedValue(undefined)
      createAnalyser = () => ({ fftSize: 256, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(144) })
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect }))
    }
    vi.stubGlobal('AudioContext', AudioContextMock)
    const publish = vi.fn()
    const stop = observeVoiceAudio(stream, publish)
    vi.advanceTimersByTime(80)
    expect(publish).toHaveBeenCalledWith(.625)
    stop(); stop(); vi.advanceTimersByTime(1000)
    expect(publish).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledOnce(); expect(disconnect).toHaveBeenCalledOnce(); expect(stopTrack).not.toHaveBeenCalled()
  })
  it('fails closed when Web Audio is unavailable without throwing into Voice', () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(() => observeVoiceAudio({} as MediaStream, vi.fn())()).not.toThrow()
  })
})
