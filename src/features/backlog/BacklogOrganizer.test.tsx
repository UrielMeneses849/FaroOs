import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BacklogSection, Task } from '../../types'
import { BacklogOrganizer } from './BacklogOrganizer'

const sections: BacklogSection[] = [
  { id: 'map', workspaceId: 'bimsa', name: 'Mapa', color: '#5b8cff', sortOrder: 0, createdAt: '', updatedAt: '' },
  { id: 'explorer', workspaceId: 'bimsa', name: 'Explorer', color: '#71d6b1', sortOrder: 1, createdAt: '', updatedAt: '' },
  { id: 'login', workspaceId: 'bimsa', name: 'Login', color: '#c49aff', sortOrder: 2, createdAt: '', updatedAt: '' },
]
const tasks: Task[] = [
  { id: 'task-1', title: 'Ajustar ficha', workspaceId: 'bimsa', sectionId: 'explorer', status: 'doing', area: 'personal', priority: 'medium', createdAt: '', updatedAt: '' },
  { id: 'task-2', title: 'Clasificar pendiente', workspaceId: 'bimsa', status: 'todo', area: 'personal', priority: 'medium', createdAt: '', updatedAt: '' },
]

describe('organizador del backlog', () => {
  it('usa las cards como filtro y manda las secciones vacías al final', async () => {
    const onSectionFilter = vi.fn()
    const onManageSections = vi.fn()
    render(<BacklogOrganizer tasks={tasks} sections={sections} workspaceName="BIMSA" sectionFilter="all" onSectionFilter={onSectionFilter} onManageSections={onManageSections} />)

    expect(screen.queryByPlaceholderText(/buscar tarea/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    const cards = within(screen.getByLabelText('Avance por sección')).getAllByRole('button')
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Explorer'),
      expect.stringContaining('Sin sección'),
      expect.stringContaining('Mapa'),
      expect.stringContaining('Login'),
    ])

    await userEvent.click(cards[0])
    expect(onSectionFilter).toHaveBeenCalledWith('explorer')
    await userEvent.click(screen.getByRole('button', { name: /nueva sección/i }))
    expect(onManageSections).toHaveBeenCalledOnce()
  })
})
