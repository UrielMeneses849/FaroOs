export const CALENDAR_ZOOM_MIN_SLOT_HEIGHT = 12
export const CALENDAR_ZOOM_MAX_SLOT_HEIGHT = 56
export const CALENDAR_ZOOM_DEFAULT_SLOT_HEIGHT = 20

export function clampCalendarSlotHeight(value: number) {
  if (!Number.isFinite(value)) return CALENDAR_ZOOM_DEFAULT_SLOT_HEIGHT
  return Math.min(CALENDAR_ZOOM_MAX_SLOT_HEIGHT, Math.max(CALENDAR_ZOOM_MIN_SLOT_HEIGHT, Math.round(value * 2) / 2))
}

export function calendarSlotHeightFromWheel(current: number, deltaY: number, deltaMode = 0) {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 120 : deltaY
  const boundedDelta = Math.min(60, Math.max(-60, pixels))
  return clampCalendarSlotHeight(current * Math.exp(-boundedDelta * 0.004))
}

export function calendarZoomPercent(slotHeight: number, baseline = CALENDAR_ZOOM_DEFAULT_SLOT_HEIGHT) {
  return Math.round((slotHeight / baseline) * 100)
}
