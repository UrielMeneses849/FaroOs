export type FinanceDuplicateProposal = {
  type: 'expense' | 'income'
  amount: number
  date: string
  accountId?: unknown
  categoryId?: unknown
  description?: unknown
  recurringTransactionId?: unknown
}

export type FinanceDuplicateCandidate = {
  id: string
  type: string
  amount: number | string
  transaction_date: string
  account_id?: string | null
  category_id?: string | null
  description: string
  recurring_transaction_id?: string | null
}

export type FinanceDuplicateMatch = {
  id: string
  description: string
  amount: number
  date: string
  score: number
  confidence: 'medium' | 'high'
}

const normalize = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const meaningfulWords = (value: unknown) => normalize(value)
  .split(' ')
  .filter((word) => word.length > 2 && !['gasto', 'ingreso', 'pago', 'compra', 'voz', 'por'].includes(word))

export function descriptionSimilarity(left: unknown, right: unknown) {
  const a = meaningfulWords(left)
  const b = meaningfulWords(right)
  if (!a.length || !b.length) return 0
  if (a.join(' ') === b.join(' ')) return 1
  const aSet = new Set(a)
  const bSet = new Set(b)
  const shared = [...aSet].filter((word) => bSet.has(word)).length
  return shared / new Set([...aSet, ...bSet]).size
}

/**
 * Amount and date are useful clues, never enough on their own.  The score is
 * intentionally explainable so a same-day $150 Recarga cannot impersonate a
 * $150 Comida de Kira transaction.
 */
export function financeDuplicateScore(proposal: FinanceDuplicateProposal, candidate: FinanceDuplicateCandidate) {
  const type = proposal.type === candidate.type ? .12 : 0
  const amount = Number(proposal.amount) === Number(candidate.amount) ? .18 : 0
  const date = proposal.date === candidate.transaction_date ? .18 : 0
  const account = proposal.accountId && proposal.accountId === candidate.account_id ? .12 : 0
  const category = proposal.categoryId && proposal.categoryId === candidate.category_id ? .20 : 0
  const description = descriptionSimilarity(proposal.description, candidate.description) * .18
  const proposalOrigin = String(proposal.recurringTransactionId ?? '')
  const candidateOrigin = String(candidate.recurring_transaction_id ?? '')
  const origin = proposalOrigin && candidateOrigin && proposalOrigin === candidateOrigin ? .02 : 0
  return Math.round((type + amount + date + account + category + description + origin) * 100) / 100
}

export function assessFinanceDuplicate(proposal: FinanceDuplicateProposal, candidates: FinanceDuplicateCandidate[]): FinanceDuplicateMatch | undefined {
  const scored = candidates
    .filter((candidate) => candidate.type === proposal.type)
    .map((candidate) => ({ candidate, score: financeDuplicateScore(proposal, candidate) }))
    .filter((entry) => entry.score >= .7)
    .sort((left, right) => right.score - left.score)
  const best = scored[0]
  if (!best) return undefined
  return {
    id: best.candidate.id,
    description: best.candidate.description,
    amount: Number(best.candidate.amount),
    date: best.candidate.transaction_date,
    score: best.score,
    confidence: best.score >= .86 ? 'high' : 'medium',
  }
}
