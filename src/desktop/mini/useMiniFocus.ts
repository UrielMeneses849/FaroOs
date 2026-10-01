import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getComputerConfig } from '../desktopBridge'
import { advanceTimedConcentration } from '../../features/computer/computerController'
import { focusRemainingSeconds } from '../../features/computer/focusLifecycle'
import type { ComputerConfig } from '../../features/computer/computerTypes'

export function useMiniFocus() {
  const [config, setConfig] = useState<ComputerConfig>()
  const advancing = useRef(false)
  useEffect(() => {
    let alive = true
    let off: (() => void) | undefined
    let received = false
    void listen<ComputerConfig>('faro://computer-config', ({ payload }) => { if (alive) { received = true; setConfig(payload) } })
      .then((dispose) => { if (alive) off = dispose; else dispose() }).catch(() => {})
    void getComputerConfig().then((next) => { if (alive && !received) setConfig(next) }).catch(() => {})
    return () => { alive = false; off?.() }
  }, [])
  const focus = config?.focusSession
  const active = focus?.kind === 'concentration' && ['active', 'break', 'paused'].includes(focus.status)
  useEffect(() => {
    if (!config || !active || focus?.status === 'paused') return
    let alive = true
    const advance = () => {
      if (advancing.current || focusRemainingSeconds(focus!) > 0) return
      advancing.current = true
      // Read the current native session before writing: a pause/cancel may
      // have arrived while the deadline callback was queued in WebKit.
      void getComputerConfig().then((latest) => latest ? advanceTimedConcentration(latest) : undefined)
        .then((next) => { if (alive && next) setConfig(next) })
        .catch((error) => console.error('FARO concentration transition failed; retrying', error))
        .finally(() => { advancing.current = false })
    }
    const timer = window.setTimeout(advance, Math.min(2_147_000_000, Math.max(0, focusRemainingSeconds(focus!) * 1000 + 50)))
    const retry = window.setInterval(advance, 1000)
    window.addEventListener('focus', advance)
    document.addEventListener('visibilitychange', advance)
    return () => { alive = false; clearTimeout(timer); clearInterval(retry); window.removeEventListener('focus', advance); document.removeEventListener('visibilitychange', advance) }
  }, [active, config, focus])
  return { config, setConfig, active, focus }
}
