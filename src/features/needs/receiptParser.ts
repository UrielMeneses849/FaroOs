export interface ParsedReceiptLine {
  sourceName: string
  amountCents: number
}

export interface ParsedReceipt {
  storeName?: string
  lines: ParsedReceiptLine[]
}

const ignoredLines = /\b(?:subtotal|total|iva|impuesto|cambio|efectivo|tarjeta|debito|cr[eé]dito|pago|art[ií]culos?|ahorro|descuento|redondeo|monedero|autorizaci[oó]n|folio|rfc|fecha|hora|cajero)\b/i
const knownStores: Array<[RegExp, string]> = [
  [/\b(?:walmart|wal\s*mart)\b/i, 'Walmart'], [/\bheb\b/i, 'HEB'], [/\bsoriana\b/i, 'Soriana'],
  [/\bchedraui\b/i, 'Chedraui'], [/\b(?:bodega\s*aurrera|aurrera)\b/i, 'Bodega Aurrera'], [/\bcostco\b/i, 'Costco'],
  [/\bla\s*comer\b/i, 'La Comer'], [/\bsams?\s*club\b/i, "Sam's Club"],
]

const currencyAtEnd = /(?:\$|mxn\s*)?\s*([0-9]{1,3}(?:[,.][0-9]{3})*(?:[,.][0-9]{2})|[0-9]+[,.][0-9]{2})\s*$/i

export function parseMexicanAmount(value: string) {
  const compact = value.replace(/[^0-9,.]/g, '')
  if (!compact) return undefined
  const comma = compact.lastIndexOf(',')
  const dot = compact.lastIndexOf('.')
  const normalized = comma >= 0 && dot >= 0
    ? (comma > dot ? compact.replaceAll('.', '').replace(',', '.') : compact.replaceAll(',', ''))
    : comma >= 0 ? compact.replace(',', '.') : compact
  const amount = Number(normalized)
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : undefined
}

const tidyName = (value: string) => value
  .replace(/^[\d\s*#xX.-]+/, '')
  .replace(/\s{2,}/g, ' ')
  .replace(/[^\p{L}\p{N}&'()\-/. ]/gu, ' ')
  .trim()
  .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase('es-MX'))

/**
 * Intentionally conservative: only proposes lines containing a clear decimal
 * price. The receipt review is the source of truth, not this parser.
 */
export function parseSupermarketReceipt(text: string): ParsedReceipt {
  const cleanedLines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  const storeName = knownStores.find(([pattern]) => pattern.test(text))?.[1]
  const lines: ParsedReceiptLine[] = []

  cleanedLines.forEach((line, index) => {
    if (ignoredLines.test(line) || line.length < 4) return
    const match = line.match(currencyAtEnd)
    if (!match) return
    const amountCents = parseMexicanAmount(match[1])
    if (amountCents == null || amountCents === 0 || amountCents > 1000000) return
    let sourceName = tidyName(line.slice(0, match.index).replace(/\$?\s*$/, ''))
    // Some tickets print product and amount on consecutive lines.
    if (sourceName.length < 3 && index > 0 && !currencyAtEnd.test(cleanedLines[index - 1])) sourceName = tidyName(cleanedLines[index - 1])
    if (sourceName.length < 3 || sourceName.length > 120 || ignoredLines.test(sourceName)) return
    lines.push({ sourceName, amountCents })
  })

  const unique = new Map<string, ParsedReceiptLine>()
  lines.forEach((line) => {
    const key = `${line.sourceName.toLocaleLowerCase('es-MX')}|${line.amountCents}`
    if (!unique.has(key)) unique.set(key, line)
  })
  return { storeName, lines: [...unique.values()].slice(0, 80) }
}
