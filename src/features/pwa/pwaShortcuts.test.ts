import { describe, expect, it } from 'vitest'
import { createPwaShortcuts } from './pwaShortcuts'

describe('phone launcher shortcuts', () => {
  it('prioritizes movement, task and today for launchers with three available slots', () => {
    const shortcuts = createPwaShortcuts('/FaroOs/')
    expect(shortcuts.slice(0, 3).map(item => [item.name, item.url])).toEqual([
      ['Registrar movimiento', '/FaroOs/finance?quick=movement'],
      ['Nueva tarea', '/FaroOs/backlog?quick=task'],
      ['Mi día', '/FaroOs/today'],
    ])
    expect(shortcuts[3].url).toBe('/FaroOs/dashboard?quick=voice')
    expect(shortcuts.slice(4).map(item => item.url)).toEqual(['/FaroOs/needs', '/FaroOs/calendar?quick=event'])
  })
  it.each(['/', '/FaroOs/', '/FaroOs'])('keeps every destination and icon inside the deployed scope %s', scope => {
    const root = scope.endsWith('/') ? scope : `${scope}/`
    const base = new URL(root, 'https://faro.example')
    for (const shortcut of createPwaShortcuts(scope)) {
      const destination = new URL(shortcut.url, base)
      expect(destination.origin).toBe(base.origin)
      expect(destination.pathname.startsWith(base.pathname)).toBe(true)
      expect(shortcut.icons[0]).toEqual({ src: `${root}pwa-icons/faro-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' })
    }
  })
})
