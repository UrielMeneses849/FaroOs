import { describe, expect, it } from 'vitest'
import { defaultSidebarPreferences, readSidebarPreferences, writeSidebarPreferences } from './sidebarState'

function createMemoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('sidebar preferences', () => {
  it('uses an expanded sidebar by default and tolerates invalid local storage', () => {
    expect(readSidebarPreferences(createMemoryStorage())).toEqual(defaultSidebarPreferences)
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': '{invalid json' }))).toEqual(defaultSidebarPreferences)
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': JSON.stringify({ collapsed: true, openGroups: { personal: true } }) }))).toEqual({ collapsed: true, openGroups: { personal: true } })
  })

  it('normalizes old persisted state to one expanded accordion', () => {
    const storage = createMemoryStorage()
    const preferences = { collapsed: true, openGroups: { personal: true, device: false } }

    writeSidebarPreferences(preferences, storage)

    expect(readSidebarPreferences(storage)).toEqual({ collapsed: true, openGroups: { personal: true } })
  })
  it('migrates existing preferences and ignores unknown groups and malformed collapse values', () => {
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': JSON.stringify({ openGroups: { organization: true } }) })))
      .toEqual({ collapsed: false, openGroups: { organization: true } })
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': JSON.stringify({ collapsed: 'true', openGroups: { unexpected: true, personal: true } }) })))
      .toEqual({ collapsed: false, openGroups: { personal: true } })
  })

})
