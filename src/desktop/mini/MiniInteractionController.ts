import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { MiniStateMachine, CursorZone } from './MiniStateMachine'
import { recordMiniMetric } from './MiniMetrics'

interface PointerSnapshot { zone: CursorZone; pressed: boolean; dragging: boolean; menuOpen: boolean }
export interface MiniPreferences { autoCollapse: boolean; reducedMotion: boolean }
export async function attachMiniInteractions(machine: MiniStateMachine, action: (name: string) => void, alive: () => boolean) {
  const disposers: Array<() => void> = []
  const add = async <T,>(event: string, handler: (payload: T) => void) => {
    const off = await listen<T>(event, ({ payload }) => { if (alive()) handler(payload) })
    if (!alive()) off(); else disposers.push(off)
  }
  const updatePointer = (p: PointerSnapshot) => {
    if (!alive()) return
    machine.lock('pointerPressed', p.pressed); machine.lock('dragging', p.dragging); machine.lock('menuOpen', p.menuOpen); machine.setZone(p.zone)
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('miniDebug')) console.debug('[mini geometry]', p)
  }
  try {
    const results = await Promise.allSettled([
      add<PointerSnapshot>('faro://mini-pointer', updatePointer),
      add<string>('faro://mini-action', action),
      add<boolean>('faro://mini-menu', (open) => machine.lock('menuOpen', open)),
      add<null>('faro://mini-blur', () => { machine.lock('controlFocused', false); machine.lock('pointerPressed', false) }),
      add<number>('faro://mini-resize-metric', (ms) => recordMiniMetric('windowResizeMs', ms)),
      add<MiniPreferences>('faro://mini-preferences', (p) => machine.preferences(p.autoCollapse, p.reducedMotion)),
    ])
    if (alive()) updatePointer(await invoke<PointerSnapshot>('mini_window_info'))
    if (results.some((result) => result.status === 'rejected')) throw new Error('Mini subscription failed')
  } catch { disposers.forEach((off) => off()); throw new Error('No pude conectar los controles de Mini.') }
  return () => disposers.forEach((off) => off())
}
export const openMiniMenu = async (machine: MiniStateMachine) => {
  machine.lock('menuOpen', true)
  try { await invoke('mini_context_menu') } finally { machine.lock('menuOpen', false) }
}
export const beginMiniDrag = async (machine: MiniStateMachine) => {
  machine.lock('dragging', true)
  try { await invoke('mini_start_drag') } catch { machine.lock('dragging', false) }
  // Native observes global mouse-up even when the pointer leaves this WebView.
}
