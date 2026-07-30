import { describe, expect, it } from 'vitest'
import { allNavigationItems, navigationGroups } from './navigation'

describe('navegación de crecimiento', () => {
  it('expone Viajes en /travel y retira Europa de la navegación principal', () => {
    expect(allNavigationItems).toContainEqual(expect.objectContaining({ path: '/travel', label: 'Viajes' }))
    expect(allNavigationItems.map((item) => String(item.path))).not.toContain('/europe')
  })

  it('mantiene accesibles Ventas, Contenido y Portfolio', () => {
    expect(allNavigationItems.map((item) => item.path)).toEqual(expect.arrayContaining([
      '/sales', '/content', '/portfolio',
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
