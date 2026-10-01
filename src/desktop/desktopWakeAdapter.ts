import type { LocalWakeEngine, LocalWakeState, WakeListeningAdapter } from '../core/voice/adapters'
import { webWakeListeningAdapter } from '../features/voice/webVoiceAdapters'
import { getDesktopWakeModel } from './desktopBridge'
import { ViolaWakeDetector } from './wake/violaWake'

const TARGET_RATE = 16_000
const MAX_PENDING_SAMPLES = TARGET_RATE * 2

class DesktopViolaWakeEngine implements LocalWakeEngine {
  private stream?: MediaStream
  private context?: AudioContext
  private source?: MediaStreamAudioSourceNode
  private processor?: ScriptProcessorNode
  private detector?: ViolaWakeDetector
  private pending = new Float32Array()
  private processing = false
  private _listening = false
  private lastLevelAt = 0
  private startedAt = 0
  private handlers?: Parameters<LocalWakeEngine['start']>[0]

  isListening() { return this._listening }

  async isAvailable() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return false
    const model = await getDesktopWakeModel()
    return Boolean(model?.length)
  }

  async start(handlers: Parameters<LocalWakeEngine['start']>[0]) {
    await this.stop()
    this.handlers = handlers
    handlers.onState?.('loading')
    const classifier = await getDesktopWakeModel()
    if (!classifier?.length) {
      handlers.onState?.('unavailable')
      return
    }
    try {
      this.detector = new ViolaWakeDetector({ classifier: new Uint8Array(classifier) })
      await this.detector.load()
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.context = new AudioContext()
      this.source = this.context.createMediaStreamSource(this.stream)
      this.processor = this.context.createScriptProcessor(2048, 1, 1)
      this.processor.onaudioprocess = (event) => this.receive(event.inputBuffer.getChannelData(0), this.context?.sampleRate ?? TARGET_RATE)
      this.source.connect(this.processor)
      this.processor.connect(this.context.destination)
      this.startedAt = performance.now()
      this._listening = true
      handlers.onState?.('standby')
    } catch (error) {
      await this.stop()
      handlers.onState?.('error')
      throw error
    }
  }

  async stop() {
    this._listening = false
    this.processor?.disconnect()
    this.source?.disconnect()
    this.processor = undefined
    this.source = undefined
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    const context = this.context
    this.context = undefined
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
    this.detector?.dispose()
    this.detector = undefined
    this.pending = new Float32Array()
    this.processing = false
  }

  private receive(input: Float32Array, sourceRate: number) {
    if (!this._listening) return
    const frame = resampleMono(input, sourceRate, TARGET_RATE)
    const now = performance.now()
    if (now - this.lastLevelAt > 100) {
      this.lastLevelAt = now
      this.handlers?.onLevel?.(Math.min(1, rootMeanSquare(frame) * 8))
    }
    this.pending = append(this.pending, frame)
    if (this.pending.length > MAX_PENDING_SAMPLES) this.pending = this.pending.slice(-MAX_PENDING_SAMPLES)
    if (!this.processing) void this.process()
  }

  private async process() {
    this.processing = true
    try {
      while (this._listening && this.pending.length >= 320 && this.detector) {
        const frame = this.pending.slice(0, 320)
        this.pending = this.pending.slice(320)
        if (await this.detector.detect(frame)) {
          this._listening = false
          this.handlers?.onState?.('detected')
          this.handlers?.onDetected({ score: this.detector.score, latencyMs: performance.now() - this.startedAt })
          await this.stop()
          break
        }
      }
    } catch {
      this.handlers?.onState?.('error')
      await this.stop()
    } finally { this.processing = false }
  }
}

function append(first: Float32Array, second: Float32Array) { const next = new Float32Array(first.length + second.length); next.set(first); next.set(second, first.length); return next }
function rootMeanSquare(values: Float32Array) { let total = 0; for (const value of values) total += value * value; return Math.sqrt(total / Math.max(values.length, 1)) }
function resampleMono(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input.slice()
  const length = Math.max(1, Math.round(input.length * targetRate / sourceRate))
  const output = new Float32Array(length)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < length; index += 1) {
    const at = index * ratio
    const before = Math.floor(at)
    const after = Math.min(before + 1, input.length - 1)
    output[index] = input[before] * (1 - (at - before)) + input[after] * (at - before)
  }
  return output
}

export const desktopWakeListeningAdapter: WakeListeningAdapter = {
  ...webWakeListeningAdapter,
  id: 'desktop-viola-wake',
  localWake: new DesktopViolaWakeEngine(),
}

export type { LocalWakeState }
