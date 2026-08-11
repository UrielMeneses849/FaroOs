export type VoiceTimingMap = Record<string, number>

export class ServerVoiceTrace {
  readonly startedAt = performance.now()
  readonly timings: VoiceTimingMap = {}

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try { return await operation() }
    finally { this.timings[`${name}Ms`] = performance.now() - start }
  }

  measureSync<T>(name: string, operation: () => T): T {
    const start = performance.now()
    try { return operation() }
    finally { this.timings[`${name}Ms`] = performance.now() - start }
  }

  finish() {
    this.timings.serverTotalMs = performance.now() - this.startedAt
    return Object.fromEntries(Object.entries(this.timings).map(([key, value]) => [key, Math.round(value * 100) / 100]))
  }
}
