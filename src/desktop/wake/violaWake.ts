/*
 * Local FARO wake detector using ViolaWake's Apache-2.0 ONNX/WASM backbone.
 * The final classifier is an enrolled, user-local “Hola Faro” model; no
 * standby samples leave the process or are written to disk.
 */
import * as ort from 'onnxruntime-web'
import embeddingModelUrl from './models/embedding_model.onnx?url'
import melspecModelUrl from './models/melspectrogram.onnx?url'
import { ViolaBackbone, WAKE_SAMPLE_RATE } from './violaBackbone'

const FRAME_SIZE = WAKE_SAMPLE_RATE / 50
const EMBEDDING_DIM = 96

export interface ViolaWakeOptions {
  classifier: Uint8Array
  threshold?: number
  confirmCount?: number
  cooldownMs?: number
}

export class ViolaWakeDetector {
  private readonly threshold: number
  private readonly confirmCount: number
  private readonly cooldownMs: number
  private classifier?: ort.InferenceSession
  private classifierInput = ''
  private temporalLength = 1
  private embeddings: Float32Array[] = []
  private remainder = new Float32Array()
  private consecutive = 0
  private detectedAt = 0
  private _score = 0
  private backbone?: ViolaBackbone

  get score() { return this._score }

  constructor(private readonly options: ViolaWakeOptions) {
    this.threshold = options.threshold ?? 0.84
    this.confirmCount = options.confirmCount ?? 2
    this.cooldownMs = options.cooldownMs ?? 2_000
  }

  async load() {
    const [backbone, classifier] = await Promise.all([
      ViolaBackbone.create(melspecModelUrl, embeddingModelUrl),
      ort.InferenceSession.create(this.options.classifier, { executionProviders: ['wasm'] }),
    ])
    this.backbone = backbone
    this.classifier = classifier
    this.classifierInput = classifier.inputNames[0]
    const metadata = (classifier as unknown as { inputMetadata?: Record<string, { dimensions?: unknown[]; shape?: unknown[] }> }).inputMetadata?.[this.classifierInput]
    const shape = metadata?.dimensions ?? metadata?.shape
    if (Array.isArray(shape) && shape.length === 3 && typeof shape[1] === 'number' && shape[1] > 0) this.temporalLength = shape[1]
    if (Array.isArray(shape) && shape[shape.length - 1] !== EMBEDDING_DIM) throw new Error('El modelo Hola Faro no usa el backbone ONNX esperado.')
  }

  reset() {
    this.backbone?.reset()
    this.embeddings = []
    this.remainder = new Float32Array()
    this.consecutive = 0
    this._score = 0
  }

  async detect(input: Float32Array): Promise<boolean> {
    if (!this.backbone || !this.classifier) throw new Error('ViolaWake no está cargado.')
    const merged = this.remainder.length ? joinFrames(this.remainder, input) : input
    const available = Math.floor(merged.length / FRAME_SIZE) * FRAME_SIZE
    this.remainder = merged.slice(available)
    let detected = false
    for (let offset = 0; offset < available; offset += FRAME_SIZE) {
      const frame = merged.subarray(offset, offset + FRAME_SIZE)
      const embedding = await this.backbone.push(frame)
      if (!embedding) continue
      this.embeddings.push(embedding)
      if (this.embeddings.length > this.temporalLength) this.embeddings.shift()
      if (this.embeddings.length < this.temporalLength) continue
      const values = this.temporalLength === 1 ? this.embeddings[0] : flatten(this.embeddings)
      const dimensions = this.temporalLength === 1 ? [1, EMBEDDING_DIM] : [1, this.temporalLength, EMBEDDING_DIM]
      const result = await this.classifier.run({ [this.classifierInput]: new ort.Tensor('float32', values, dimensions) })
      this._score = Number((result[this.classifier.outputNames[0]].data as Float32Array)[0] ?? 0)
      const rms = rootMeanSquare(frame)
      if (rms < 1 / 32768 || this._score < this.threshold) { this.consecutive = 0; continue }
      this.consecutive += 1
      const now = performance.now()
      if (this.consecutive >= this.confirmCount && now - this.detectedAt >= this.cooldownMs) {
        this.consecutive = 0
        this.detectedAt = now
        detected = true
      }
    }
    return detected
  }

  dispose() {
    this.reset()
    ;(this.classifier as unknown as { release?: () => void } | undefined)?.release?.()
  }
}

function joinFrames(first: Float32Array, second: Float32Array) { const result = new Float32Array(first.length + second.length); result.set(first); result.set(second, first.length); return result }
function flatten(values: Float32Array[]) { const result = new Float32Array(values.length * EMBEDDING_DIM); values.forEach((value, index) => result.set(value, index * EMBEDDING_DIM)); return result }
function rootMeanSquare(values: Float32Array) { let total = 0; for (const value of values) total += value * value; return Math.sqrt(total / values.length) }
