export type FinanceFastIntent =
  | 'create_expense'
  | 'create_income'
  | 'spent_today'
  | 'search_transactions'
  | 'delete_transaction'
  | 'update_transaction'
  | 'register_recurring'
  | 'unknown'

export interface FinanceFastRoute {
  skill: 'finance'
  intent: FinanceFastIntent
  confidence: number
  entities: {
    amounts: number[]
    date?: string
    ordinal?: number
    normalized: string
  }
}

export const normalizeVoiceText = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('es-MX')
  .replace(/[^a-z0-9.,$ ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

function localDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

function parseAmount(raw: string) {
  const clean = raw.replace(/\$/g, '').trim()
  const decimalComma = /^\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(clean)
  const normalized = decimalComma
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean.replace(/,/g, '')
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

export function extractFinanceAmounts(value: string) {
  const amounts: number[] = []
  for (const match of value.matchAll(/\$?\s*(\d[\d,.]*)(?:\s*(?:pesos?|mxn))?/g)) {
    const amount = parseAmount(match[1])
    if (amount !== undefined && !amounts.includes(amount)) amounts.push(amount)
  }
  return amounts
}

function ordinalFrom(value: string) {
  const words: Array<[RegExp, number]> = [
    [/\b(?:el |la )?primer[oa]?\b/, 1],
    [/\b(?:el |la )?segund[oa]\b/, 2],
    [/\b(?:el |la )?tercer[oa]?\b/, 3],
    [/\b(?:el |la )?cuart[oa]\b/, 4],
    [/\b(?:el |la )?quint[oa]\b/, 5],
  ]
  return words.find(([pattern]) => pattern.test(value))?.[1]
}

export function routeFinanceIntent(message: string): FinanceFastRoute {
  const normalized = normalizeVoiceText(message)
  const amounts = extractFinanceAmounts(normalized)
  const date = /\bayer\b/.test(normalized) ? localDate(-1)
    : /\bhoy\b/.test(normalized) ? localDate()
      : normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  const ordinal = ordinalFrom(normalized)
  const base = { skill: 'finance' as const, entities: { amounts, date, ordinal, normalized } }

  if (/\b(cuanto|cuantos|total|gastado|gaste)\b/.test(normalized)
    && /\b(hoy|este dia)\b/.test(normalized)
    && /\b(gaste|gastado|gastos?)\b/.test(normalized)) {
    return { ...base, intent: 'spent_today', confidence: .99 }
  }
  if (/\b(elimina|eliminar|borra|borrar|quita|quitar)\b/.test(normalized)
    || /\b(eliminalo|borrarlo|quitalo)\b/.test(normalized)) {
    return { ...base, intent: 'delete_transaction', confidence: .97 }
  }
  if (/\b(cambia|cambiar|actualiza|actualizar|edita|editar|corrige|mueve)\b/.test(normalized)
    || /\b(cambialo|actualizalo|editalo)\b/.test(normalized)) {
    return { ...base, intent: 'update_transaction', confidence: .94 }
  }
  if (/\b(registra|registrar|marca|marcar)\b/.test(normalized)
    && /\b(pago|cobro|recurrente|mensualidad)\b/.test(normalized)) {
    return { ...base, intent: 'register_recurring', confidence: .91 }
  }
  if (/\b(gaste|gasto|pague|pago|compra|compre|registra un gasto|registrar un gasto)\b/.test(normalized)
    && amounts.length) {
    return { ...base, intent: 'create_expense', confidence: .96 }
  }
  if (/\b(ingreso|recibi|recibe|cobre|cobro|deposito|depositaron|registra un ingreso|registrar un ingreso)\b/.test(normalized)
    && amounts.length) {
    return { ...base, intent: 'create_income', confidence: .96 }
  }
  if (/\b(busca|buscar|muestra|mostrar|lista|movimientos?|gastos?|ingresos?)\b/.test(normalized)) {
    return { ...base, intent: 'search_transactions', confidence: .82 }
  }
  return { ...base, intent: 'unknown', confidence: 0 }
}

export function normalizedIncludes(haystack: string, needle: string) {
  const normalizedNeedle = normalizeVoiceText(needle)
  return normalizedNeedle.length > 1 && normalizeVoiceText(haystack).includes(normalizedNeedle)
}
