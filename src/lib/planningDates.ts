import { addDays, format } from 'date-fns'

export type DeadlineState = 'active' | 'due-soon' | 'overdue' | 'completed'

export function getDeadlineState(
  date: string | undefined,
  completed: boolean,
  now = new Date(),
): DeadlineState {
  if (completed) return 'completed'
  if (!date) return 'active'
  const today = format(now, 'yyyy-MM-dd')
  if (date < today) return 'overdue'
  return date <= format(addDays(now, 7), 'yyyy-MM-dd') ? 'due-soon' : 'active'
}

export const isValidDateRange = (start?: string, end?: string) =>
  !start || !end || start <= end
