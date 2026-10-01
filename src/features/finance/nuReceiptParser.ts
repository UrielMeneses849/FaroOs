import { parseMexicanAmount } from '../needs/receiptParser'

export interface ParsedNuReceipt {
  amountCents?: number
  date?: string
  recipient?: string
  concept?: string
  suggestedName: string
}

const money = /(?:\$\s*|MXN\s*)([\d.,\s]+[.,]\d{2})\b|\b([\d.,]+[.,]\d{2})\s*(?:MXN|pesos)\b/i
const monthNames: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
}

function safeName(value?: string) {
  return value?.replace(/\s+/g, ' ').replace(/\b(?:CLABE|cuenta|entidad|folio|referencia|estatus)\b.*$/i, '').trim().slice(0, 100) || undefined
}

function findField(lines: string[], label: RegExp) {
  const index = lines.findIndex((line) => label.test(line))
  if (index < 0) return undefined
  const inline = lines[index].replace(label, '').replace(/^\s*[:|–-]\s*/, '').trim()
  return inline || lines[index + 1]
}

function receiptDate(text: string) {
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/)
  if (numeric) {
    const [, day, month, year] = numeric
    const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    if (!Number.isNaN(new Date(`${value}T12:00:00`).getTime())) return value
  }
  const written = text.toLocaleLowerCase('es-MX').match(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(?:de\s+)?(20\d{2})\b/)
  if (!written) return undefined
  const value = `${written[3]}-${monthNames[written[2]]}-${written[1].padStart(2, '0')}`
  return Number.isNaN(new Date(`${value}T12:00:00`).getTime()) ? undefined : value
}

/** Conservative extraction: never interpret a CLABE, account or folio as money. */
export function parseNuReceipt(text: string): ParsedNuReceipt {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  const labelled = lines.findIndex((line) => /\b(?:monto|importe|total\s+(?:enviado|pagado)|cantidad)\b/i.test(line))
  const candidates = labelled >= 0 ? [lines[labelled], lines[labelled + 1], ...lines] : lines
  const amountCents = candidates.filter(Boolean).map((line) => {
    const match = line.match(money)
    return match ? parseMexicanAmount(match[1] || match[2]) : undefined
  }).find((amount) => amount != null && amount > 0 && amount <= 100_000_000)
  const recipient = safeName(findField(lines, /^\s*(?:nombre|beneficiari[oa]|destinatari[oa])\b/i))
  const concept = safeName(findField(lines, /^\s*concepto\b/i))
  const suggestedName = concept && !/^(?:transferencia|pago|spei)$/i.test(concept)
    ? concept
    : recipient ? `Transferencia a ${recipient}` : 'Gasto con Nu'
  return { amountCents, date: receiptDate(text), recipient, concept, suggestedName }
}
