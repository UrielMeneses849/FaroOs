import { describe, expect, it } from 'vitest'
import {
  calendarEnd,
  inclusiveAllDayEnd,
  isDateOnly,
  isValidTimeZone,
  localDateTimeToTimestamp,
  normalizeDateOnly,
  normalizeTimeZone,
  normalizeTimestamp,
  safeParseDate,
  safeToISOString,
  timestampToWallTime,
  timestampToLocalParts,
} from './calendarDates'

describe('fechas centrales de calendario', () => {
  it('conserva fecha y hora locales al convertir hacia Supabase y volver', () => {
    const timestamp = localDateTimeToTimestamp('2026-07-27', '10:00')
    expect(timestamp).toBe('2026-07-27T16:00:00.000Z')
    expect(timestampToLocalParts(timestamp)).toEqual({ date: '2026-07-27', time: '10:00' })
    expect(timestampToWallTime(timestamp)).toBe('2026-07-27T10:00:00')
  })

  it('distingue días completos y calcula finales exclusivos', () => {
    expect(isDateOnly('2026-07-27')).toBe(true)
    expect(inclusiveAllDayEnd('2026-07-27')).toBe('2026-07-28')
    expect(calendarEnd('2026-07-27')).toBeUndefined()
    expect(calendarEnd('2026-07-27T10:00:00.000Z', 60)).toBe('2026-07-27T11:00:00.000Z')
  })

  it.each([
    null,
    undefined,
    '',
    'Invalid Date',
    '24/07/2026',
    '2026-99-99',
    new Date(Number.NaN),
  ])('rechaza sin lanzar el valor inválido %s', (value) => {
    expect(safeParseDate(value)).toBeNull()
    expect(safeToISOString(value)).toBeNull()
  })

  it('acepta fechas locales estrictas, timestamps ISO y objetos Date válidos', () => {
    expect(normalizeDateOnly('2026-07-24')).toBe('2026-07-24')
    expect(normalizeTimestamp('2026-07-24T16:30:00.000Z')).toBe('2026-07-24T16:30:00.000Z')
    expect(safeToISOString(new Date('2026-07-24T16:30:00.000Z'))).toBe('2026-07-24T16:30:00.000Z')
  })

  it('valida la zona horaria y usa un fallback seguro', () => {
    expect(isValidTimeZone('America/Mexico_City')).toBe(true)
    expect(isValidTimeZone('Planeta/Faro')).toBe(false)
    const fallback = normalizeTimeZone('Planeta/Faro')
    expect(isValidTimeZone(fallback)).toBe(true)
    expect(fallback).not.toBe('Planeta/Faro')
  })
})
