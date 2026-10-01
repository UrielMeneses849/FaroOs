import { describe, expect, it } from 'vitest'
import {
  CALENDAR_ZOOM_MAX_SLOT_HEIGHT,
  CALENDAR_ZOOM_MIN_SLOT_HEIGHT,
  calendarSlotHeightFromWheel,
  calendarZoomPercent,
  clampCalendarSlotHeight,
} from './calendarZoom'

describe('calendar timeline zoom', () => {
  it('acerca con scroll hacia arriba y aleja con scroll hacia abajo', () => {
    expect(calendarSlotHeightFromWheel(20, -40)).toBeGreaterThan(20)
    expect(calendarSlotHeightFromWheel(20, 40)).toBeLessThan(20)
  })

  it('mantiene una escala legible y estable', () => {
    expect(calendarSlotHeightFromWheel(55, -10_000)).toBe(CALENDAR_ZOOM_MAX_SLOT_HEIGHT)
    expect(calendarSlotHeightFromWheel(13, 10_000)).toBe(CALENDAR_ZOOM_MIN_SLOT_HEIGHT)
    expect(clampCalendarSlotHeight(Number.NaN)).toBe(20)
  })

  it('expresa el zoom respecto a la densidad inicial', () => {
    expect(calendarZoomPercent(30, 20)).toBe(150)
  })
})
