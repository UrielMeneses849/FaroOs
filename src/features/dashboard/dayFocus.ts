export const DAY_FOCUS_SECONDS = 25 * 60
export interface DayFocus {
  state: 'idle' | 'running' | 'paused' | 'finished'
  remaining: number
  deadline?: number
}
export const idleDayFocus = (): DayFocus => ({ state: 'idle', remaining: DAY_FOCUS_SECONDS })
export const focusKey = (ownerId: string) => `faro:day-focus:v1:${ownerId}`
export function focusSeconds(session: DayFocus, now = Date.now()) {
  return session.state === 'running' ? Math.max(0, Math.min(DAY_FOCUS_SECONDS, Math.ceil((session.deadline! - now) / 1000))) : session.remaining
}
export function decodeDayFocus(raw: string | null, now = Date.now()): DayFocus {
  try {
    const value = JSON.parse(raw ?? 'null') as DayFocus | null
    if (!value || !['idle', 'running', 'paused', 'finished'].includes(value.state)
      || !Number.isSafeInteger(value.remaining) || value.remaining < 0 || value.remaining > DAY_FOCUS_SECONDS
      || (value.state === 'running' && (!Number.isFinite(value.deadline) || value.deadline! > now + DAY_FOCUS_SECONDS * 1000))) return idleDayFocus()
    if (value.state === 'running' && focusSeconds(value, now) === 0) return { state: 'finished', remaining: 0 }
    if (value.state === 'idle') return idleDayFocus()
    if (value.state === 'finished') return { state: 'finished', remaining: 0 }
    return { state: value.state, remaining: value.remaining, deadline: value.state === 'running' ? value.deadline : undefined }
  } catch { return idleDayFocus() }
}
export function pauseDayFocus(session: DayFocus, now = Date.now()): DayFocus {
  const remaining = focusSeconds(session, now)
  return remaining ? { state: 'paused', remaining } : { state: 'finished', remaining: 0 }
}
export function resumeDayFocus(session: DayFocus, now = Date.now()): DayFocus {
  const remaining = session.state === 'paused' ? session.remaining : DAY_FOCUS_SECONDS
  return { state: 'running', remaining, deadline: now + remaining * 1000 }
}
