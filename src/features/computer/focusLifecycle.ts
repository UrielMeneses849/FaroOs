import type { FocusSession } from './computerTypes'

const phase = (session: FocusSession) => session.phase ?? 'focus'
const breakDurationSeconds = (session: FocusSession) => Math.max(0, (session.breakDurationMinutes ?? 0) * 60)

export function focusElapsedSeconds(session: FocusSession, now = new Date()) {
  const completed = session.actualDurationSeconds
  if (typeof completed === 'number') return completed
  const started = Date.parse(session.activeSince ?? session.startTime)
  if (!Number.isFinite(started)) return session.accumulatedActiveSeconds
  if (session.status === 'paused' || session.status === 'break') return session.accumulatedActiveSeconds
  return Math.max(0, session.accumulatedActiveSeconds + Math.floor((now.getTime() - started) / 1000))
}

export function focusPhaseElapsedSeconds(session: FocusSession, now = new Date()) {
  if (phase(session) === 'focus') return focusElapsedSeconds(session, now)
  if (session.status === 'break') {
    const started = Date.parse(session.activeSince ?? session.startTime)
    return Math.max(0, (session.breakElapsedSeconds ?? 0) + (Number.isFinite(started) ? Math.floor((now.getTime() - started) / 1000) : 0))
  }
  return session.breakElapsedSeconds ?? 0
}

export function focusRemainingSeconds(session: FocusSession, now = new Date()) {
  const duration = phase(session) === 'break' ? breakDurationSeconds(session) : session.plannedDurationMinutes * 60
  return Math.max(0, duration - focusPhaseElapsedSeconds(session, now))
}

export function pauseFocusSession(session: FocusSession, now = new Date()): FocusSession {
  if (session.status !== 'active' && session.status !== 'break') throw new Error('No hay una sesión activa para pausar.')
  return phase(session) === 'break'
    ? { ...session, status: 'paused', breakElapsedSeconds: focusPhaseElapsedSeconds(session, now), pausedAt: now.toISOString(), activeSince: undefined }
    : { ...session, status: 'paused', accumulatedActiveSeconds: focusElapsedSeconds(session, now), pausedAt: now.toISOString(), activeSince: undefined }
}

export function resumeFocusSession(session: FocusSession, now = new Date()): FocusSession {
  if (session.status !== 'paused') throw new Error('No hay una sesión pausada para continuar.')
  return { ...session, status: phase(session) === 'break' ? 'break' : 'active', activeSince: now.toISOString(), pausedAt: undefined }
}

export function completeFocusSession(session: FocusSession, now = new Date()): FocusSession {
  if (session.status !== 'active' && session.status !== 'break' && session.status !== 'paused') throw new Error('No hay una sesión activa para terminar.')
  return {
    ...session,
    status: 'completed',
    actualDurationSeconds: focusElapsedSeconds(session, now),
    completedAt: now.toISOString(),
    pausedAt: undefined,
  }
}

/** Returns the next phase only when a concentration timer is due. */
export function advanceConcentrationSession(session: FocusSession, now = new Date()): FocusSession | undefined {
  if (session.kind !== 'concentration' || (session.status !== 'active' && session.status !== 'break')) return undefined
  const workSeconds = session.plannedDurationMinutes * 60
  if (phase(session) === 'focus') {
    const elapsed = focusElapsedSeconds(session, now)
    if (elapsed < workSeconds) return undefined
    const overflow = elapsed - workSeconds
    const restSeconds = breakDurationSeconds(session)
    if (!restSeconds || overflow >= restSeconds) {
      return completeFocusSession({ ...session, status: 'break', accumulatedActiveSeconds: workSeconds, phase: 'break', breakElapsedSeconds: restSeconds }, now)
    }
    return {
      ...session,
      status: 'break',
      phase: 'break',
      accumulatedActiveSeconds: workSeconds,
      breakElapsedSeconds: 0,
      activeSince: new Date(now.getTime() - overflow * 1000).toISOString(),
      pausedAt: undefined,
    }
  }
  if (focusPhaseElapsedSeconds(session, now) < breakDurationSeconds(session)) return undefined
  return completeFocusSession({ ...session, breakElapsedSeconds: breakDurationSeconds(session) }, now)
}

export function formatFocusDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  return hours ? `${hours} h ${minutes} min` : `${Math.max(1, minutes)} min`
}
