export type MiniMetric = 'stateTransitions' | 'windowResizeMs' | 'renderMs' | 'hoverToPeekMs' | 'farToCollapseMs' | 'wakeToVisibleListeningMs'
const samples: Array<{ metric: MiniMetric; value: number; at: number }> = []
export function recordMiniMetric(metric: MiniMetric, value = 1) {
  samples.push({ metric, value, at: performance.now() })
  if (samples.length > 500) samples.shift()
}
export const getMiniMetrics = () => [...samples]
// Local, bounded, numeric observations only. No transcript, IDs, or audio.

let wakeStarted: number | undefined
export function markMiniWake() { wakeStarted ??= performance.now() }
export function recordMiniListeningPaint() { if (wakeStarted != null) { recordMiniMetric('wakeToVisibleListeningMs', performance.now() - wakeStarted); wakeStarted = undefined } }
