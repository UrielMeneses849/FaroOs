import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayFocusGadget } from './DayFocusGadget'
import { focusKey } from './dayFocus'
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 27, 19, 5)) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })
describe('Focus gadget interactions', () => {
  it('runs, pauses, continues and resets from its visible controls', () => {
    render(<DayFocusGadget ownerId="a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar enfoque' }))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('timer')).toHaveTextContent('24:00')
    fireEvent.click(screen.getByRole('button', { name: 'Pausar' }))
    act(() => vi.advanceTimersByTime(90_000))
    expect(screen.getByRole('timer')).toHaveTextContent('24:00')
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('timer')).toHaveTextContent('23:59')
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))
    expect(screen.getByRole('timer')).toHaveTextContent('25 min')
  })
  it('restores from device storage on remount and handles completion after suspension', () => {
    const first = render(<DayFocusGadget ownerId="a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar enfoque' }))
    first.unmount()
    vi.setSystemTime(new Date(2026, 9, 27, 19, 31))
    render(<DayFocusGadget ownerId="a" />)
    expect(screen.getByRole('status')).toHaveTextContent('Sesión completada')
    expect(screen.getByRole('timer')).toHaveTextContent('00:00')
  })
  it('responds to another tab pausing the same timer', () => {
    render(<DayFocusGadget ownerId="a" />)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: focusKey('a'), newValue: JSON.stringify({ state: 'paused', remaining: 720 }), storageArea: localStorage })))
    expect(screen.getByRole('timer')).toHaveTextContent('12:00')
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument()
  })
  it('still works when company browser policy denies device storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<DayFocusGadget ownerId="a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar enfoque' }))
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('timer')).toHaveTextContent('24:55')
  })
})
