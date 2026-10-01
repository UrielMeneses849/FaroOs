import { routeCalendarIntent } from '../calendarFastPath.ts'
import { routeBacklogIntent } from '../backlogFastPath.ts'
import { normalizeVoiceText, routeFinanceIntent } from '../financeFastPath.ts'
import { AI_TIER, tierForLegacyRoute, type AITier } from '../../ai/config.ts'
import { routeFaroAI } from '../../ai/router.ts'

export const FARO_SKILLS = ['finance', 'calendar', 'backlog'] as const
export type FaroSkill = typeof FARO_SKILLS[number]
export type FaroRouterSkill = FaroSkill | 'unknown'
export type FaroModelRoute = 'deterministic' | 'cheap_model' | 'smart_model' | 'reasoning_model'

export type FaroRoutingInput = {
  transcript: string
  surface: string
  sessionId?: string | null
  skillHint?: FaroRouterSkill
  shortContext?: { lastSkill?: string; pendingClarification?: { intent?: string } }
  modelTarget?: { provider: string; model: string }
}

export type FaroRouteDecision = {
  skill: FaroRouterSkill
  intent: string
  route: FaroModelRoute
  confidence: number
  provider: string | null
  model: string | null
  reason: string
  tierRequested?: AITier
  tierUsed?: AITier
  escalated?: boolean
  fallbackReason?: string | null
}

const reasoningPattern = /\b(analiza|analisis|explica por que|estrategia|mejor hueco|considerando|prioridades|presupuesto|impactando|compara|recomienda)\b/
const multiEntityPattern = /\b(varios|todas|todos|entre .* y |opciones|alternativas|comparar|ademas)\b/
const correctionPattern = /\b(realmente|mejor fueron|corrige|correccion|lo de .+ fueron|cambialo|actualizalo|editalo)\b/

function candidateSkill(input: FaroRoutingInput, finance: ReturnType<typeof routeFinanceIntent>, calendar: ReturnType<typeof routeCalendarIntent>, backlog: ReturnType<typeof routeBacklogIntent>): FaroRouterSkill {
  const normalized = normalizeVoiceText(input.transcript)
  const mentionsTask = /\b(tarea|tareas|backlog|pendiente|pendientes|programada|programado)\b/.test(normalized)
  // A scheduled task still belongs to Backlog. Calendar owns availability and
  // visual projection, but never becomes a second task domain.
  if (backlog.intent !== 'unknown' && (calendar.intent === 'unknown' || mentionsTask)) return 'backlog'
  if (finance.intent !== 'unknown' && calendar.intent === 'unknown') return 'finance'
  if (calendar.intent !== 'unknown' && finance.intent === 'unknown') return 'calendar'
  if (/\b(agenda|calendario|evento|reunion|cita|disponibilidad|hueco)\b/.test(normalized)) return 'calendar'
  if (mentionsTask) return 'backlog'
  if (/\b(gasto|ingreso|cuenta|movimiento|presupuesto|pague|gaste|cobre)\b/.test(normalized)) return 'finance'
  if (input.skillHint && FARO_SKILLS.includes(input.skillHint as FaroSkill)) return input.skillHint as FaroSkill
  if (input.shortContext?.lastSkill === 'finance' || input.shortContext?.lastSkill === 'calendar' || input.shortContext?.lastSkill === 'backlog') return input.shortContext.lastSkill as FaroSkill
  return 'unknown'
}

/**
 * Deliberately pure and deterministic. It never calls a model to decide whether
 * a model is needed; the returned route is also the cost-observability contract.
 */
function routeFaroModelDecision(input: FaroRoutingInput): FaroRouteDecision {
  const transcript = input.transcript.trim()
  const normalized = normalizeVoiceText(transcript)
  const finance = routeFinanceIntent(transcript)
  const calendar = routeCalendarIntent(transcript)
  const backlog = routeBacklogIntent(transcript)
  const skill = candidateSkill(input, finance, calendar, backlog)
  const selected = skill === 'finance' ? finance : skill === 'calendar' ? calendar : skill === 'backlog' ? backlog : undefined
  const pendingBacklog = skill === 'backlog'
    && Boolean(input.shortContext?.pendingClarification?.intent?.includes('backlog'))
    && /^(?:si|sí|claro|dale|correcto|ok|vale|la primera|la segunda|la tercera|una hora|dos horas|tres horas)[.! ]*$/i.test(transcript)

  if (reasoningPattern.test(normalized)) {
    return { skill, intent: selected?.intent ?? 'reasoning_query', route: 'reasoning_model', confidence: selected?.confidence ?? .72, provider: null, model: null, reason: 'explicit_reasoning_request' }
  }

  if (pendingBacklog) {
    return { skill: 'backlog', intent: input.shortContext?.pendingClarification?.intent ?? 'backlog_continuation', route: 'deterministic', confidence: .97, provider: null, model: null, reason: 'backlog_context_continuation' }
  }

  if (selected && selected.intent !== 'unknown' && selected.confidence >= .94) {
    return { skill, intent: selected.intent, route: 'deterministic', confidence: selected.confidence, provider: null, model: null, reason: `${skill}_${selected.intent}_complete` }
  }

  if (selected && selected.intent !== 'unknown') {
    const route: FaroModelRoute = correctionPattern.test(normalized) ? 'cheap_model' : multiEntityPattern.test(normalized) ? 'smart_model' : 'cheap_model'
    return { skill, intent: selected.intent, route, confidence: selected.confidence, provider: null, model: null, reason: route === 'cheap_model' ? `${skill}_${selected.intent}_light_extraction` : `${skill}_${selected.intent}_moderate_ambiguity` }
  }

  if (correctionPattern.test(normalized) && skill !== 'unknown') {
    return { skill, intent: 'contextual_correction', route: 'cheap_model', confidence: .62, provider: null, model: null, reason: `${skill}_contextual_correction` }
  }

  if (multiEntityPattern.test(normalized)) {
    return { skill, intent: 'ambiguous_query', route: 'smart_model', confidence: .45, provider: null, model: null, reason: 'multi_entity_or_ambiguous_query' }
  }

  return { skill, intent: 'unknown', route: 'cheap_model', confidence: 0, provider: null, model: null, reason: 'unknown_requires_light_classification' }
}

export function routeFaroModel(input: FaroRoutingInput): FaroRouteDecision {
  const decision = routeFaroModelDecision(input)
  const selected = routeFaroAI({
    feature: featureForDecision(decision),
    module: decision.skill,
    intent: decision.intent,
    preferredTier: tierForLegacyRoute(decision.route),
    confidence: decision.confidence,
    providers: input.modelTarget
      ? [{ id: input.modelTarget.provider, model: input.modelTarget.model, tier: AI_TIER.PREMIUM }]
      : [],
  })
  return {
    ...decision,
    provider: selected.provider,
    model: selected.model,
    tierRequested: selected.tierRequested,
    tierUsed: selected.tierUsed,
    escalated: selected.escalated,
    fallbackReason: selected.fallbackReason,
  }
}

export function fallbackFromDeterministic(decision: FaroRouteDecision): FaroRouteDecision {
  return {
    ...decision,
    route: 'cheap_model',
    confidence: Math.min(decision.confidence, .89),
    reason: `${decision.reason}_needs_contextual_extraction`,
    tierRequested: AI_TIER.CHEAP,
    tierUsed: AI_TIER.CHEAP,
    provider: null,
    model: null,
    escalated: false,
    fallbackReason: 'deterministic_handler_incomplete',
  }
}

export function featureForDecision(decision: Pick<FaroRouteDecision, 'intent' | 'route'>) {
  if (decision.route === 'reasoning_model') return decision.intent === 'reasoning_query' ? 'conversational_reasoning' : 'financial_analysis'
  if (decision.route === 'cheap_model') return 'voice_action_extraction'
  if (decision.route === 'smart_model') return 'voice_action_resolution'
  return decision.intent
}
