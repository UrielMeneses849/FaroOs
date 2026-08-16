import { supabase } from '../lib/supabase/client'

export async function assertFinanceUser(userId: string) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session || data.session.user.id !== userId) {
    throw new Error('La sesión financiera no es válida.')
  }
}

export function centsToNumeric(cents: number) {
  if (!Number.isSafeInteger(cents)) throw new Error('El importe no es válido.')
  return cents / 100
}

export function numericToCents(value: number) {
  const cents = Math.round(Number(value) * 100)
  if (!Number.isSafeInteger(cents)) throw new Error('El importe almacenado no es válido.')
  return cents
}

export function throwIfError(error: { code?: string; message: string } | null) {
  if (!error) return
  if (error.code === '23505' || /duplicate key value|unique constraint/i.test(error.message)) {
    throw new Error('Ya existe un registro para estos datos. Actualízalo e inténtalo de nuevo.')
  }
  throw new Error(error.message)
}
