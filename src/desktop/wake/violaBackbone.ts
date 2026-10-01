/*
 * Local OpenWakeWord-compatible feature backbone for FARO Desktop.
 *
 * Derived from ViolaWake's WASM implementation (Apache-2.0, 2026
 * ViolaWake Contributors), adapted for FARO's user-enrolled classifier.
 * It intentionally keeps only a small in-memory audio ring buffer.
 */
import * as ort from 'onnxruntime-web'

export const WAKE_SAMPLE_RATE = 16_000
const MEL_FRAMES_PER_EMBEDDING = 76
const MEL_STRIDE = 8
const EMBEDDING_DIM = 96
const OWW_CHUNK_SAMPLES = 1_280
const MELSPEC_CONTEXT_SAMPLES = 480
const MAX_RAW_SAMPLES = WAKE_SAMPLE_RATE * 10
const MAX_MELSPEC_FRAMES = 970

class RingBuffer {
  private readonly buffer: Int16Array
  private writeAt = 0
  private count = 0

  constructor(private readonly capacity: number) { this.buffer = new Int16Array(capacity) }

  extend(samples: Int16Array) {
    if (!samples.length) return
    if (samples.length >= this.capacity) {
      this.buffer.set(samples.subarray(samples.length - this.capacity))
      this.writeAt = 0
      this.count = this.capacity
      return
    }
    const end = this.writeAt + samples.length
    if (end <= this.capacity) this.buffer.set(samples, this.writeAt)
    else {
      const first = this.capacity - this.writeAt
      this.buffer.set(samples.subarray(0, first), this.writeAt)
      this.buffer.set(samples.subarray(first), 0)
    }
    this.writeAt = end % this.capacity
    this.count = Math.min(this.count + samples.length, this.capacity)
  }

  tail(size: number) {
    const length = Math.min(size, this.count)
    if (!length) return new Int16Array()
    const start = (this.writeAt - length + this.capacity) % this.capacity
    if (start + length <= this.capacity) return this.buffer.slice(start, start + length)
    const result = new Int16Array(length)
    const first = this.capacity - start
    result.set(this.buffer.subarray(start), 0)
    result.set(this.buffer.subarray(0, this.writeAt), first)
    return result
  }
}

export class ViolaBackbone {
  private readonly melInput: string
  private readonly embeddingInput: string
  private raw = new RingBuffer(MAX_RAW_SAMPLES)
  private mels = new Float32Array(MAX_MELSPEC_FRAMES * 32).fill(1)
  private melRows = MEL_FRAMES_PER_EMBEDDING
  private accumulated = 0
  private remainder = new Int16Array()

  private constructor(private readonly melSession: ort.InferenceSession, private readonly embeddingSession: ort.InferenceSession) {
    this.melInput = melSession.inputNames[0]
    this.embeddingInput = embeddingSession.inputNames[0]
  }

  static async create(melspecUrl: string, embeddingUrl: string) {
    const options: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] }
    const [mel, embedding] = await Promise.all([
      ort.InferenceSession.create(melspecUrl, options),
      ort.InferenceSession.create(embeddingUrl, options),
    ])
    return new ViolaBackbone(mel, embedding)
  }

  reset() {
    this.raw = new RingBuffer(MAX_RAW_SAMPLES)
    this.mels = new Float32Array(MAX_MELSPEC_FRAMES * 32).fill(1)
    this.melRows = MEL_FRAMES_PER_EMBEDDING
    this.accumulated = 0
    this.remainder = new Int16Array()
  }

  async push(samples: Float32Array): Promise<Float32Array | null> {
    let pcm = new Int16Array(samples.length)
    for (let index = 0; index < samples.length; index += 1) pcm[index] = Math.trunc(Math.max(-1, Math.min(1, samples[index])) * 32767)
    if (this.remainder.length) {
      const merged = new Int16Array(this.remainder.length + pcm.length)
      merged.set(this.remainder)
      merged.set(pcm, this.remainder.length)
      pcm = merged
      this.remainder = new Int16Array()
    }
    const remainderLength = (this.accumulated + pcm.length) % OWW_CHUNK_SAMPLES
    const full = remainderLength ? pcm.subarray(0, pcm.length - remainderLength) : pcm
    if (remainderLength) this.remainder = pcm.slice(pcm.length - remainderLength)
    this.raw.extend(full)
    this.accumulated += full.length
    if (this.accumulated < OWW_CHUNK_SAMPLES || this.accumulated % OWW_CHUNK_SAMPLES) return null

    const input = this.raw.tail(this.accumulated + MELSPEC_CONTEXT_SAMPLES)
    const melInput = Float32Array.from(input)
    const melOutput = await this.melSession.run({ [this.melInput]: new ort.Tensor('float32', melInput, [1, melInput.length]) })
    const rawMels = melOutput[this.melSession.outputNames[0]].data as Float32Array
    const normalized = new Float32Array(rawMels.length)
    for (let index = 0; index < rawMels.length; index += 1) normalized[index] = rawMels[index] / 10 + 2
    const newRows = normalized.length / 32
    const totalRows = this.melRows + newRows
    const nextRows = Math.min(totalRows, MAX_MELSPEC_FRAMES)
    const next = new Float32Array(nextRows * 32)
    const oldRowsToKeep = Math.max(0, Math.min(this.melRows, nextRows - newRows))
    if (oldRowsToKeep) next.set(this.mels.subarray((this.melRows - oldRowsToKeep) * 32, this.melRows * 32))
    if (newRows >= nextRows) next.set(normalized.subarray((newRows - nextRows) * 32))
    else next.set(normalized, oldRowsToKeep * 32)
    this.mels = next
    this.melRows = nextRows
    this.accumulated = 0
    if (this.melRows < MEL_FRAMES_PER_EMBEDDING) return null
    const start = Math.max(0, this.melRows - MEL_FRAMES_PER_EMBEDDING - MEL_STRIDE * 0)
    const window = this.mels.slice(start * 32, (start + MEL_FRAMES_PER_EMBEDDING) * 32)
    const output = await this.embeddingSession.run({ [this.embeddingInput]: new ort.Tensor('float32', window, [1, MEL_FRAMES_PER_EMBEDDING, 32, 1]) })
    return (output[this.embeddingSession.outputNames[0]].data as Float32Array).slice(0, EMBEDDING_DIM)
  }
}
