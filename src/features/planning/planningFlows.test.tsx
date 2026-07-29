import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addDays, format } from 'date-fns'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { demoData } from '../../data/mockData'
import { calculateProjectProgress } from '../../lib/taskMetrics'
import { useFaroStore } from '../../store'
import { TaskLine } from './TaskLine'

describe('relaciones y foco diario', () => {
  it('relaciona objetivo y proyecto en ambos sentidos', () => {
    const goal = useFaroStore.getState().goals[0]
    const timestamp = new Date().toISOString()
    useFaroStore.getState().createProject({ id: 'project-linked', title: 'Proyecto vinculado', area: 'personal', status: 'active', priority: 'high', goalId: goal.id, createdAt: timestamp, updatedAt: timestamp })
    expect(useFaroStore.getState().projects.find((project) => project.id === 'project-linked')?.goalId).toBe(goal.id)
    expect(useFaroStore.getState().goals.find((item) => item.id === goal.id)?.projectIds).toContain('project-linked')
  })

  it('relaciona proyecto y tarea y actualiza progreso al completar', () => {
    const project = useFaroStore.getState().projects[0]
    const timestamp = new Date().toISOString()
    useFaroStore.getState().createTask({ id: 'only-task', title: 'Tarea conectada', area: project.area, status: 'todo', priority: 'high', projectId: project.id, createdAt: timestamp, updatedAt: timestamp })
    useFaroStore.setState({ tasks: useFaroStore.getState().tasks.filter((task) => task.id === 'only-task' || task.projectId !== project.id) })
    expect(calculateProjectProgress(useFaroStore.getState().tasks, project.id)).toBe(0)
    useFaroStore.getState().updateTask('only-task', { status: 'done' })
    expect(calculateProjectProgress(useFaroStore.getState().tasks, project.id)).toBe(100)
  })

  it('completa y pospone una tarea desde su fila', async () => {
    const user = userEvent.setup()
    const task = demoData.tasks[0]
    render(<MemoryRouter><TaskLine task={task} /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: `Completar ${task.title}` }))
    expect(useFaroStore.getState().tasks.find((item) => item.id === task.id)?.status).toBe('done')
    await user.click(screen.getByRole('button', { name: 'Mañana' }))
    expect(useFaroStore.getState().tasks.find((item) => item.id === task.id)?.dueDate).toBe(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  })
})
