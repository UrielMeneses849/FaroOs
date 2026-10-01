/**
 * Portable runtime boundary. Desktop can configure these values before loading
 * the React application; the web build keeps working with browser defaults.
 */
export const FARO_RUNTIME_SURFACES = ['lab', 'web', 'desktop', 'mobile'] as const
export type FaroRuntimeSurface = typeof FARO_RUNTIME_SURFACES[number]

export interface FaroSessionStorage {
  getItem: (key: string) => string | null | Promise<string | null>
  setItem: (key: string, value: string) => void | Promise<void>
  removeItem: (key: string) => void | Promise<void>
}

export interface FaroNavigationAdapter {
  navigate(path: string): void
}

type FaroRuntimeGlobals = typeof globalThis & {
  __TAURI_INTERNALS__?: unknown
  __TAURI__?: unknown
  __FARO_RUNTIME_SURFACE__?: FaroRuntimeSurface
  __FARO_DESKTOP_SESSION_STORAGE__?: FaroSessionStorage
}

let configuredSurface: FaroRuntimeSurface | undefined
let configuredSessionStorage: FaroSessionStorage | undefined
let configuredNavigation: FaroNavigationAdapter | undefined
const memoryStorage = new Map<string, string>()

const memorySessionStorage: FaroSessionStorage = {
  getItem: (key) => memoryStorage.get(key) ?? null,
  setItem: (key, value) => { memoryStorage.set(key, value) },
  removeItem: (key) => { memoryStorage.delete(key) },
}

function browserSessionStorage(): FaroSessionStorage {
  try {
    if (typeof globalThis.localStorage === 'undefined') return memorySessionStorage
    return globalThis.localStorage
  } catch {
    return memorySessionStorage
  }
}

export function isFaroTauriRuntime() {
  const scope = globalThis as FaroRuntimeGlobals
  // WebKit can expose the injected bridge a tick after page code starts, while
  // the native origin is already authoritative. This keeps Desktop from
  // accidentally creating its first Supabase client as a browser client.
  return Boolean(
    scope.__TAURI_INTERNALS__
      || scope.__TAURI__
      || globalThis.location?.protocol === 'tauri:',
  )
}

export function configureFaroRuntime(options: { surface?: FaroRuntimeSurface; sessionStorage?: FaroSessionStorage; navigation?: FaroNavigationAdapter } = {}) {
  if (options.surface) configuredSurface = options.surface
  if (options.sessionStorage) configuredSessionStorage = options.sessionStorage
  if (options.navigation) configuredNavigation = options.navigation
}

export function getFaroRuntimeSurface(pageSurface?: string): FaroRuntimeSurface {
  if (pageSurface === 'lab') return 'lab'
  const scope = globalThis as FaroRuntimeGlobals
  return configuredSurface ?? scope.__FARO_RUNTIME_SURFACE__ ?? (isFaroTauriRuntime() ? 'desktop' : 'web')
}

/**
 * Supabase accepts asynchronous storage too, which lets a future Tauri
 * Stronghold/Store adapter replace WebView localStorage without a backend fork.
 */
export function getFaroSessionStorage(): FaroSessionStorage {
  const scope = globalThis as FaroRuntimeGlobals
  return configuredSessionStorage ?? scope.__FARO_DESKTOP_SESSION_STORAGE__ ?? browserSessionStorage()
}

export function getFaroNavigationAdapter() {
  return configuredNavigation
}

export function resetFaroRuntimeForTests() {
  configuredSurface = undefined
  configuredSessionStorage = undefined
  configuredNavigation = undefined
  memoryStorage.clear()
}
