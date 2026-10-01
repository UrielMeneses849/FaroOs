import { invoke } from '@tauri-apps/api/core'
import type { FaroMiniState } from './MiniStateMachine'

export function presentationKey(state: FaroMiniState, response = '') { return `${state}:${state === 'speaking' && response.length > 70}` }
/** Serialize native changes and keep only the latest target while one is in flight. */
export class MiniWindowController {
  private desired = ''
  private applied = ''
  private running = false
  private disposed = false
  constructor(private send: (state: string, long: boolean) => Promise<unknown> = (state, long) => invoke('mini_present', { state, long }), private onError: () => void = () => {}) {}
  present(state: FaroMiniState, response = '') { this.desired = presentationKey(state, response); void this.flush() }
  private async flush() {
    if (this.running || this.disposed || this.applied === this.desired) return
    this.running = true
    try {
      while (!this.disposed && this.applied !== this.desired) {
        const key = this.desired
        const [state, long] = key.split(':')
        await this.send(state, long === 'true')
        this.applied = key
      }
    } catch { this.onError() }
    finally { this.running = false }
  }
  dispose() { this.disposed = true }
}
