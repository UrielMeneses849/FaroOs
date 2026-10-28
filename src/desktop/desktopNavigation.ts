/** Exact native routes; query parameters are part of the allowlist. */
const FARO_MAIN_ROUTES = [
  '/finance',
  '/calendar',
  '/backlog',
  '/settings',
  '/today',
  '/backlog?quick=task',
  '/finance?quick=movement',
] as const

export type FaroMainRoute = typeof FARO_MAIN_ROUTES[number]

export function isFaroMainRoute(value: unknown): value is FaroMainRoute {
  return typeof value === 'string' && FARO_MAIN_ROUTES.some((route) => route === value)
}
