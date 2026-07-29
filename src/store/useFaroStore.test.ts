import { describe, expect, it } from 'vitest'
import { useFaroStore } from './useFaroStore'

describe('flujos del backlog', () => {
  it('convierte una idea en tarea conservando identidad y creación', () => {
    const idea = useFaroStore.getState().ideas[0]
    useFaroStore.getState().convertIdea(idea.id, 'task')
    const task = useFaroStore.getState().tasks.find((item) => item.id === idea.id)
    expect(task).toMatchObject({ id: idea.id, title: idea.title, createdAt: idea.createdAt, status: 'todo' })
    expect(useFaroStore.getState().ideas.find((item) => item.id === idea.id)).toBeUndefined()
  })

  it('convierte una idea en proyecto conservando relaciones válidas', () => {
    const idea = useFaroStore.getState().ideas[1]
    useFaroStore.getState().convertIdea(idea.id, 'project')
    expect(useFaroStore.getState().projects.find((item) => item.id === idea.id)).toMatchObject({
      title: idea.title, createdAt: idea.createdAt, status: 'idea',
    })
  })

  it('rehidrata cambios persistidos después de una recarga simulada', async () => {
    const idea = useFaroStore.getState().ideas[0]
    useFaroStore.getState().updateIdea(idea.id, { title: 'Idea persistida' })
    const serialized = localStorage.getItem('faro-os-data') ?? '{}'
    const persisted = JSON.parse(serialized)
    expect(persisted.state.ideas.some((item: { title: string }) => item.title === 'Idea persistida')).toBe(true)
    expect(persisted.version).toBe(5)
    useFaroStore.getState().updateIdea(idea.id, { title: 'Estado temporal' })
    localStorage.setItem('faro-os-data', serialized)
    await useFaroStore.persist.rehydrate()
    expect(useFaroStore.getState().ideas.find((item) => item.id === idea.id)?.title).toBe('Idea persistida')
  })

  it('protege las tareas al eliminar su proyecto', () => {
    const project = useFaroStore.getState().projects.find((item) => useFaroStore.getState().tasks.some((task) => task.projectId === item.id))
    expect(project).toBeDefined()
    const task = useFaroStore.getState().tasks.find((item) => item.projectId === project?.id)
    useFaroStore.getState().deleteProject(project!.id)
    expect(useFaroStore.getState().tasks.find((item) => item.id === task?.id)).toMatchObject({ projectId: undefined })
  })
})
