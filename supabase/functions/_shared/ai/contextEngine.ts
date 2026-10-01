export type FaroContextPlan = {
  finance: boolean
  backlog: boolean
  calendar: boolean
  compact: boolean
}

/**
 * Chooses domain context before any query is made. It deliberately avoids a
 * whole-FARO snapshot: unknown requests receive a compact cross-domain set.
 */
export function buildFaroContextPlan(input: { module: 'finance' | 'calendar' | 'backlog' | 'unknown'; tier: string }): FaroContextPlan {
  if (input.module === 'finance') return { finance: true, backlog: false, calendar: false, compact: input.tier !== 'premium' }
  if (input.module === 'backlog') return { finance: false, backlog: true, calendar: false, compact: input.tier !== 'premium' }
  if (input.module === 'calendar') return { finance: false, backlog: false, calendar: true, compact: input.tier !== 'premium' }
  return { finance: true, backlog: true, calendar: true, compact: true }
}
