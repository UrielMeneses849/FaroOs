import { describe, expect, it } from 'vitest'
import { allNavigationItems, navigationGroups } from './navigation'

describe('navegación enfocada', () => {
  it('mantiene ocultos los módulos pausados', () => {
    expect(allNavigationItems.map((item) => item.path)).not.toEqual(expect.arrayContaining([
      '/sprints', '/nexvora', '/portfolio', '/sales', '/content', '/learning', '/travel',
    ]))
  })

  it('coloca las secciones más usadas al inicio y sin duplicados', () => {
    expect(navigationGroups[0]).toMatchObject({
      label: 'Prioridad',
      items: [
        { path: '/dashboard' },
        { path: '/today' },
        { path: '/backlog' },
        { path: '/calendar' },
        { path: '/finance' },
        { path: '/health' },
        { path: '/journal' },
      ],
    })
    expect(new Set(allNavigationItems.map((item) => item.path)).size).toBe(allNavigationItems.length)
  })
})
