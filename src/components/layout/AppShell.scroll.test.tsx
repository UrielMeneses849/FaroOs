import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'

vi.mock('../../hooks/auth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))
vi.mock('../../features/capture/QuickCaptureDialog', () => ({ QuickCaptureDialog: () => null }))

describe('route scroll ownership', () => {
  it.each([false, true])('resets the correct pane on navigation (mobile: %s)', async (mobile) => {
    const previousMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    const previousElementScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    const previousDocumentScroll = Object.getOwnPropertyDescriptor(document.documentElement, 'scrollTo')
    const previousScrollingElement = Object.getOwnPropertyDescriptor(document, 'scrollingElement')
    const paneScroll = vi.fn()
    const documentScroll = vi.fn()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
      matches: query === '(max-width: 760px)' && mobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) })
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: paneScroll })
    Object.defineProperty(document.documentElement, 'scrollTo', { configurable: true, value: documentScroll })
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement })
    const view = render(<MemoryRouter initialEntries={['/backlog']}><Routes><Route element={<AppShell />}><Route path="*" element={<h1>Contenido</h1>} /></Route></Routes></MemoryRouter>)
    try {
      const main = screen.getByRole('main')
      paneScroll.mockClear()
      documentScroll.mockClear()
      await userEvent.setup().click(within(screen.getByRole('navigation', { name: 'Navegación móvil' })).getByRole('link', { name: 'Finanzas' }))
      const expected = { top: 0, left: 0, behavior: 'auto' }
      if (mobile) {
        expect(documentScroll).toHaveBeenCalledExactlyOnceWith(expected)
        expect(paneScroll).not.toHaveBeenCalled()
      } else {
        expect(paneScroll).toHaveBeenCalledExactlyOnceWith(expected)
        expect(paneScroll.mock.contexts).toEqual([main])
        expect(documentScroll).not.toHaveBeenCalled()
      }
    } finally {
      view.unmount()
      const restore = (target: object, key: string, descriptor: PropertyDescriptor | undefined) => {
        if (descriptor) Object.defineProperty(target, key, descriptor)
        else Reflect.deleteProperty(target, key)
      }
      restore(window, 'matchMedia', previousMatchMedia)
      restore(HTMLElement.prototype, 'scrollTo', previousElementScroll)
      restore(document.documentElement, 'scrollTo', previousDocumentScroll)
      restore(document, 'scrollingElement', previousScrollingElement)
    }
  })
})
