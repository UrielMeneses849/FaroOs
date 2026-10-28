import { describe, expect, it } from 'vitest'
import { DAY_FOCUS_SECONDS, decodeDayFocus, focusKey, focusSeconds, idleDayFocus, pauseDayFocus, resumeDayFocus } from './dayFocus'
const start = 1_800_000_000_000
describe('PWA focus clock', () => {
  it('uses wall time after a suspended tab rather than counting interval ticks', () => {
    const running = resumeDayFocus(idleDayFocus(), start)
    expect(focusSeconds(running, start + 12 * 60_000)).toBe(13 * 60)
    expect(focusSeconds(running, start + 40 * 60_000)).toBe(0)
  })
  it('pauses and resumes only the remaining time', () => {
    const paused = pauseDayFocus(resumeDayFocus(idleDayFocus(), start), start + 60_000)
    expect(paused).toEqual({ state: 'paused', remaining: 1440 })
    const resumed = resumeDayFocus(paused, start + 5 * 60_000)
    expect(focusSeconds(resumed, start + 6 * 60_000)).toBe(1380)
  })
  it('restores a running session on reload and finishes one that expired while closed', () => {
    const raw = JSON.stringify(resumeDayFocus(idleDayFocus(), start))
    expect(focusSeconds(decodeDayFocus(raw, start + 60_000), start + 60_000)).toBe(1440)
    expect(decodeDayFocus(raw, start + 26 * 60_000)).toEqual({ state: 'finished', remaining: 0 })
  })
  it('rejects corrupt, unsupported and implausible device state', () => {
    for (const raw of ['broken', '{}', '{"state":"running","remaining":1500}', JSON.stringify({ state: 'paused', remaining: -4 }), JSON.stringify({ state: 'running', remaining: DAY_FOCUS_SECONDS, deadline: start + 60 * 60_000 })]) expect(decodeDayFocus(raw, start)).toEqual(idleDayFocus())
  })
  it('separates each user’s local timer and restarts a finished session', () => {
    expect(focusKey('a')).not.toBe(focusKey('b'))
    expect(focusSeconds(resumeDayFocus({ state: 'finished', remaining: 0 }, start), start)).toBe(1500)
  })
})
