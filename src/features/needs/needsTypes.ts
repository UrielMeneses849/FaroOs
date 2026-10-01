import { addDays, addMonths, differenceInCalendarDays, format, parseISO, startOfToday } from 'date-fns'

export type NeedCategory = 'home' | 'personal' | 'cat' | 'big_purchase' | 'other'
export type NeedPriority = 'essential' | 'soon' | 'planned'
export type NeedFrequency = 'as_needed' | 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'annual' | 'one_time'
export type NeedShoppingGroup = 'supermarket' | 'pharmacy' | 'cat' | 'home' | 'other'

export interface NeedsCategory {
  id: string
  name: string
  shoppingGroup: NeedShoppingGroup
  createdAt: string
  updatedAt: string
}

export interface NeedItem {
  id: string
  name: string
  category: NeedCategory
  categoryId?: string
  shoppingGroup: NeedShoppingGroup
  priority: NeedPriority
  frequency: NeedFrequency
  isOnShoppingList: boolean
  nextNeededOn?: string
  quantity?: string
  estimatedAmountCents?: number
  notes?: string
  isActive: boolean
  lastCompletedAt?: string
  createdAt: string
  updatedAt: string
}

export interface NeedPriceObservation {
  id: string
  receiptId: string
  needItemId?: string
  canonicalName: string
  sourceName: string
  presentation?: string
  amountCents: number
  observedOn: string
  storeName?: string
  createdAt: string
}

export interface NeedPriceReceiptLineDraft {
  sourceName: string
  canonicalName: string
  needItemId?: string
  presentation?: string
  amountCents: number
  remember: boolean
}

export interface NeedPriceReceiptDraft {
  storeName?: string
  purchasedOn: string
  sourceFileName?: string
  lines: NeedPriceReceiptLineDraft[]
}

export type NeedDraft = Omit<NeedItem, 'id' | 'createdAt' | 'updatedAt' | 'lastCompletedAt'>

export const needCategoryLabels: Record<NeedCategory, string> = {
  home: 'Hogar',
  personal: 'Personal',
  cat: 'Mi gata',
  big_purchase: 'Compra grande',
  other: 'Otro',
}

export const needPriorityLabels: Record<NeedPriority, string> = {
  essential: 'Esencial',
  soon: 'Pronto',
  planned: 'Planificado',
}

export const needFrequencyLabels: Record<NeedFrequency, string> = {
  as_needed: 'Cuando haga falta',
  weekly: 'Cada semana',
  biweekly: 'Cada 2 semanas',
  monthly: 'Cada mes',
  bimonthly: 'Cada 2 meses',
  quarterly: 'Cada 3 meses',
  semiannual: 'Cada 6 meses',
  annual: 'Cada año',
  one_time: 'Sólo una vez',
}

export const needShoppingGroupLabels: Record<NeedShoppingGroup, string> = {
  supermarket: 'Supermercado',
  pharmacy: 'Farmacia',
  cat: 'Mi gata',
  home: 'Hogar',
  other: 'Otro',
}

export type NeedTiming = 'overdue' | 'today' | 'soon' | 'later' | 'unscheduled'

export function nextNeedDate(from: string, frequency: NeedFrequency) {
  const date = parseISO(from)
  const next = frequency === 'weekly' ? addDays(date, 7)
    : frequency === 'biweekly' ? addDays(date, 14)
      : frequency === 'monthly' ? addMonths(date, 1)
        : frequency === 'bimonthly' ? addMonths(date, 2)
          : frequency === 'quarterly' ? addMonths(date, 3)
            : frequency === 'semiannual' ? addMonths(date, 6)
              : frequency === 'annual' ? addMonths(date, 12)
                : undefined
  return next ? format(next, 'yyyy-MM-dd') : undefined
}

export function needTiming(nextNeededOn?: string, today = startOfToday()): NeedTiming {
  if (!nextNeededOn) return 'unscheduled'
  const offset = differenceInCalendarDays(parseISO(nextNeededOn), today)
  if (offset < 0) return 'overdue'
  if (offset === 0) return 'today'
  if (offset <= 7) return 'soon'
  return 'later'
}

export function needTimingLabel(nextNeededOn?: string, today = startOfToday()) {
  if (!nextNeededOn) return 'Sin fecha'
  const offset = differenceInCalendarDays(parseISO(nextNeededOn), today)
  if (offset < -1) return `Vencido hace ${Math.abs(offset)} días`
  if (offset === -1) return 'Venció ayer'
  if (offset === 0) return 'Toca hoy'
  if (offset === 1) return 'Toca mañana'
  if (offset <= 7) return `En ${offset} días`
  return `El ${format(parseISO(nextNeededOn), "d 'de' MMM")}`
}

export function sortNeeds(items: NeedItem[]) {
  const timingWeight: Record<NeedTiming, number> = { overdue: 0, today: 1, soon: 2, later: 3, unscheduled: 4 }
  const priorityWeight: Record<NeedPriority, number> = { essential: 0, soon: 1, planned: 2 }
  return [...items].sort((left, right) =>
    timingWeight[needTiming(left.nextNeededOn)] - timingWeight[needTiming(right.nextNeededOn)]
    || (left.nextNeededOn ?? '9999-12-31').localeCompare(right.nextNeededOn ?? '9999-12-31')
    || priorityWeight[left.priority] - priorityWeight[right.priority]
    || left.name.localeCompare(right.name, 'es'),
  )
}

export const normalizeNeedName = (value: string) => value.trim().toLocaleLowerCase('es-MX')

/** Median is less jumpy than the last ticket when a store runs a promotion. */
export function learnedPriceCents(name: string, observations: NeedPriceObservation[]) {
  const matching = observations
    .filter((observation) => normalizeNeedName(observation.canonicalName) === normalizeNeedName(name))
    .slice(0, 5)
    .map((observation) => observation.amountCents)
    .sort((left, right) => left - right)
  if (!matching.length) return undefined
  const middle = Math.floor(matching.length / 2)
  return matching.length % 2 ? matching[middle] : Math.round((matching[middle - 1] + matching[middle]) / 2)
}
