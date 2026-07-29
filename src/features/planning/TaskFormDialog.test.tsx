import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TaskFormDialog } from './PlanningDialogs'

vi.mock('../../hooks/useWorkspaces', () => ({
  useWorkspaces: () => ({
    data: [{ id: 'workspace-personal', name: 'Personal', type: 'personal', isActive: true, sortOrder: 0, createdAt: '', updatedAt: '' }],
    loading: false,
  }),
}))

describe('modal compacto de tareas', () => {
  it('oculta campos secundarios y muestra bloqueo solo cuando aplica', async () => {
    const user = userEvent.setup()
    render(<TaskFormDialog open workspaceId="workspace-personal" onClose={() => undefined} />)
    expect(screen.queryByText('Stakeholder')).not.toBeInTheDocument()
    expect(screen.queryByText('Esperando a')).not.toBeInTheDocument()
    expect(screen.queryByText('Área')).not.toBeInTheDocument()
    expect(screen.queryByText('Objetivo')).not.toBeInTheDocument()
    expect(screen.queryByText('Proyecto')).not.toBeInTheDocument()
    expect(screen.queryByText('Notas')).not.toBeInTheDocument()
    expect(screen.queryByText('Motivo de bloqueo')).not.toBeInTheDocument()
    expect(screen.queryByText('Pausada hasta')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Estado' }))
    await user.click(screen.getByRole('menuitem', { name: /bloqueada/i }))
    expect(screen.getByText('Motivo de bloqueo')).toBeInTheDocument()
  })
})
