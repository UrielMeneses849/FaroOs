import type { NavigationGroup } from '../../app/navigation'

const STORAGE_KEY = 'faro.sidebar.v2'

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem'>

export interface SidebarPreferences {
  openGroups: Partial<Record<NavigationGroup['id'], boolean>>
}

export const defaultSidebarPreferences: SidebarPreferences = {
  openGroups: {},
}

function storageForSidebar(): BrowserStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function isValidPreferences(value: unknown): value is SidebarPreferences {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SidebarPreferences>
  return typeof candidate.openGroups === 'object' && candidate.openGroups !== null
}

export function readSidebarPreferences(storage = storageForSidebar()): SidebarPreferences {
  if (!storage) return defaultSidebarPreferences
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '')
    if (!isValidPreferences(parsed)) return defaultSidebarPreferences
    // V2 is an accordion: normalize old persisted state that allowed several
    // expanded groups before this rule existed.
    const firstOpenGroup = Object.entries(parsed.openGroups).find(([, open]) => Boolean(open))?.[0] as NavigationGroup['id'] | undefined
    return { openGroups: firstOpenGroup ? { [firstOpenGroup]: true } : {} }
  } catch {
    return defaultSidebarPreferences
  }
}

export function writeSidebarPreferences(preferences: SidebarPreferences, storage = storageForSidebar()) {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // A blocked browser storage must not block navigation.
  }
}
