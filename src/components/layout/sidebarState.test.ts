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
  it('uses an always-visible sidebar by default and tolerates invalid local storage', () => {
    expect(readSidebarPreferences(createMemoryStorage())).toEqual(defaultSidebarPreferences)
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': '{invalid json' }))).toEqual(defaultSidebarPreferences)
    expect(readSidebarPreferences(createMemoryStorage({ 'faro.sidebar.v2': JSON.stringify({ collapsed: true, openGroups: { personal: true } }) }))).toEqual({ openGroups: { personal: true } })
  })

  it('normalizes old persisted state to one expanded accordion', () => {
    const storage = createMemoryStorage()
    const preferences = { openGroups: { personal: true, device: false } }

    writeSidebarPreferences(preferences, storage)

    expect(readSidebarPreferences(storage)).toEqual({ openGroups: { personal: true } })
  })
})
