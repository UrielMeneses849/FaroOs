import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal accesible', () => {
  it('atrapa el foco, cierra con Escape y restaura el foco previo', async () => {
    const user = userEvent.setup()
    const close = vi.fn()
    render(<><button>Antes</button><Modal open title="Prueba" onClose={close}><input aria-label="Campo" /><button>Último</button></Modal></>)
    expect(screen.getByLabelText('Campo')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cerrar modal' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('Modales superpuestos', () => {
  it('pone la confirmación abierta después encima del explorador aunque aparezca antes en JSX', async () => {
    const user = userEvent.setup()
    const closeConfirm = vi.fn()
    const closeBrowser = vi.fn()
    const view = (confirm: boolean, browser: boolean) => <>
      <Modal open={confirm} title="Confirmación" onClose={closeConfirm}><button>Confirmar</button></Modal>
      <Modal open={browser} title="Explorador" onClose={closeBrowser}><input aria-label="Archivo" /></Modal>
    </>
    const { rerender, unmount } = render(view(false, true))
    rerender(view(true, true))
    const confirmation = screen.getByRole('dialog', { name: 'Confirmación' }).parentElement!
    const explorer = screen.getByRole('dialog', { name: 'Explorador' }).parentElement!
    expect(Number(confirmation.style.zIndex)).toBeGreaterThan(Number(explorer.style.zIndex))
    expect(explorer.inert).toBe(true)
    await user.keyboard('{Escape}')
    expect(closeConfirm).toHaveBeenCalledOnce()
    expect(closeBrowser).not.toHaveBeenCalled()
    rerender(view(false, true))
    expect(document.body.style.overflow).toBe('hidden')
    expect(explorer.inert).toBe(false)
    expect(screen.getByLabelText('Archivo')).toHaveFocus()
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('restaura el scroll si el explorador se cierra antes que la confirmación', () => {
    document.body.style.overflow = 'auto'
    const view = (confirm: boolean, browser: boolean) => <>
      <Modal open={confirm} title="Confirmación" onClose={() => {}}>Confirmar</Modal>
      <Modal open={browser} title="Explorador" onClose={() => {}}>Archivos</Modal>
    </>
    const { rerender, unmount } = render(view(false, true))
    rerender(view(true, true))
    rerender(view(true, false))
    expect(document.body.style.overflow).toBe('hidden')
    rerender(view(false, false))
    expect(document.body.style.overflow).toBe('auto')
    unmount()
    document.body.style.overflow = ''
  })
})
