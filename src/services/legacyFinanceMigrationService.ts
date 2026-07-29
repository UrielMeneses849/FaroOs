import type { FinanceCategory, FinanceTransactionType } from '../features/finance/financeTypes'
import { supabase } from '../lib/supabase/client'
import type { Transaction } from '../types'
import { assertFinanceUser, centsToNumeric, throwIfError } from '../repositories/financeRepositoryUtils'

async function stableLegacyId(userId: string, localId: string) {
  const source = new TextEncoder().encode(`faro-finance:${userId}:${localId}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))
  const bytes = digest.slice(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function categoryFor(transaction: Transaction, categories: FinanceCategory[]) {
  const requiredType = transaction.kind === 'income' ? 'income'
    : transaction.kind === 'saving' ? 'saving' : 'expense'
  return categories.find((item) =>
    item.type === requiredType && item.name.toLocaleLowerCase('es-MX') === transaction.category.toLocaleLowerCase('es-MX'))
    ?? categories.find((item) => item.type === requiredType)
}

/**
 * Explicit, idempotent bridge for the former Zustand/localStorage records.
 * It never removes local data and is intentionally not automatic: demo records
 * cannot be distinguished reliably from user-created records.
 */
export const legacyFinanceMigrationService = {
  async migrate(input: {
    transactions: Transaction[]
    accountId: string
    categories: FinanceCategory[]
    userId: string
  }) {
    await assertFinanceUser(input.userId)
    const rows = await Promise.all(input.transactions.map(async (transaction) => {
      const legacyId = await stableLegacyId(input.userId, transaction.id)
      const category = categoryFor(transaction, input.categories)
      if (!category) return null
      const type: FinanceTransactionType = transaction.kind === 'income'
        ? 'income' : transaction.kind === 'saving' ? 'saving' : 'expense'
      return {
        id: legacyId,
        user_id: input.userId,
        account_id: input.accountId,
        category_id: category.id,
        type,
        amount: centsToNumeric(Math.round(transaction.amount * 100)),
        transaction_date: transaction.occurredAt.slice(0, 10),
        description: transaction.description,
        status: 'completed' as const,
        legacy_transaction_id: legacyId,
        created_at: transaction.createdAt,
        updated_at: transaction.updatedAt,
      }
    }))
    const validRows = rows.filter((row) => row !== null)
    if (!validRows.length) return { migrated: 0, skipped: input.transactions.length }
    const { error } = await supabase.from('finance_transactions').upsert(validRows, {
      onConflict: 'user_id,legacy_transaction_id',
      ignoreDuplicates: true,
    })
    throwIfError(error)
    return { migrated: validRows.length, skipped: input.transactions.length - validRows.length }
  },
}
