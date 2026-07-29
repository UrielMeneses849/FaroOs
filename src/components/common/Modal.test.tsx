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
