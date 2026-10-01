import { describe, expect, it } from 'vitest'
import {
  allNavigationItems,
  futureNavigationSurfaces,
  navigationGroupForPath,
  navigationGroups,
  navigationItemIsActive,
} from './navigation'

describe('Sidebar V2 navigation', () => {
  it('only exposes routes that are available to the user', () => {
    expect(allNavigationItems.map((item) => item.route)).not.toEqual(expect.arrayContaining([
      '/sprints', '/nexvora', '/portfolio', '/sales', '/content', '/learning', '/travel', '/lab',
    ]))
    expect(new Set(allNavigationItems.map((item) => item.route)).size).toBe(allNavigationItems.length)
  })

  it('keeps the requested information architecture declarative', () => {
    expect(navigationGroups.map((group) => ({
      id: group.id,
      label: group.label,
      routes: group.children.map((item) => item.route),
    }))).toEqual([
      { id: 'inicio', label: 'Inicio', routes: ['/dashboard'] },
      { id: 'personal', label: 'Personal', routes: ['/finance', '/health', '/journal', '/needs', '/vault'] },
      { id: 'organization', label: 'Organización', routes: ['/backlog', '/calendar'] },
      { id: 'device', label: 'Dispositivo', routes: ['/storage'] },
      { id: 'faro', label: 'FARO', routes: ['/finops', '/improvements'] },
    ])
    expect(futureNavigationSurfaces.map((surface) => surface.id)).toEqual([
      'concentration', 'automations', 'system', 'voice', 'laboratory', 'nodes',
    ])
  })

  it('maps Vault and the active routes to their correct group', () => {
    const vault = allNavigationItems.find((item) => item.id === 'vault')
    expect(vault).toBeDefined()
    expect(vault?.desktopOnly).toBe(true)
    expect(navigationItemIsActive(vault!, '/vault')).toBe(true)
    expect(navigationGroupForPath('/vault')?.id).toBe('personal')
    expect(navigationGroupForPath('/finance')?.id).toBe('personal')
    expect(navigationGroupForPath('/calendar')?.id).toBe('organization')
  })

  it('keeps Hoy contextual rather than adding another primary link', () => {
    expect(allNavigationItems.map((item) => item.route)).not.toContain('/today')
  })
})
