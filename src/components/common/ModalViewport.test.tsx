import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

function setupViewport(height = 800, offsetTop = 0) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop })
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const request = vi.fn((callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id })
  const cancel = vi.fn((id: number) => { frames.delete(id) })
  vi.stubGlobal('visualViewport', viewport)
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const flush = () => { const pending = [...frames.values()]; frames.clear(); act(() => pending.forEach((callback) => callback(0))) }
  return { viewport, request, cancel, flush }
}

afterEach(() => { vi.unstubAllGlobals(); document.body.style.overflow = '' })

describe('Modal inside the visible viewport', () => {
  it('fits initial bounds and coalesces keyboard resize and pan into one frame', () => {
    const { viewport, request, flush } = setupViewport()
    render(<Modal open title="Movimiento" onClose={() => {}}><input aria-label="Importe" /><button>Guardar</button></Modal>)
    const panel = screen.getByRole('dialog', { name: 'Movimiento' })
    const backdrop = panel.parentElement!
    expect(backdrop.style.height).toBe('800px')
    expect(backdrop.style.top).toBe('0px')
    expect(panel.style.maxHeight).toBe('100%')
    request.mockClear()
    viewport.height = 420; viewport.offsetTop = 180
    act(() => { viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll')) })
    expect(request).toHaveBeenCalledTimes(1)
    expect(backdrop.style.height).toBe('800px')
    flush()
    expect(backdrop.style.height).toBe('420px')
    expect(backdrop.style.top).toBe('180px')
    expect(backdrop.style.bottom).toBe('auto')
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument()
  })

  it('cancels a pending frame and removes viewport subscriptions on unmount', () => {
    const { viewport, request, cancel } = setupViewport()
    const { unmount } = render(<Modal open title="Tarea" onClose={() => {}}><input aria-label="Título" /></Modal>)
    request.mockClear()
    act(() => viewport.dispatchEvent(new Event('resize')))
    const pending = request.mock.results[0].value as number
    unmount()
    expect(cancel).toHaveBeenCalledWith(pending)
    request.mockClear()
    viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'))
    expect(request).not.toHaveBeenCalled()
    expect(document.body.style.overflow).toBe('')
  })

  it('restores viewport styles, page scrolling and opener focus after Escape', async () => {
    const { viewport, request, flush } = setupViewport(420, 180)
    function Example() {
      const [open, setOpen] = useState(false)
      return <><button onClick={() => setOpen(true)}>Nueva tarea</button><Modal open={open} title="Tarea" onClose={() => setOpen(false)}><input aria-label="Título" /><button>Guardar</button></Modal></>
    }
    document.body.style.overflow = 'auto'
    render(<Example />)
    await userEvent.click(screen.getByRole('button', { name: 'Nueva tarea' }))
    const panel = screen.getByRole('dialog', { name: 'Tarea' })
    const backdrop = panel.parentElement!
    expect(backdrop.style.height).toBe('420px')
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
    expect(backdrop.style.height).toBe('')
    expect(backdrop.style.top).toBe('')
    expect(backdrop.style.bottom).toBe('')
    expect(panel.style.maxHeight).toBe('')
    expect(screen.getByRole('button', { name: 'Nueva tarea' })).toHaveFocus()
    request.mockClear()
    viewport.dispatchEvent(new Event('resize')); flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('leaves CSS sizing untouched when VisualViewport is unavailable', () => {
    vi.stubGlobal('visualViewport', undefined)
    render(<Modal open title="Sin API" onClose={() => {}}>Contenido del formulario</Modal>)
    const panel = screen.getByRole('dialog', { name: 'Sin API' })
    expect(panel.style.maxHeight).toBe('')
    expect(panel.parentElement!.style.height).toBe('')
    expect(panel.parentElement!.style.top).toBe('')
  })
})
