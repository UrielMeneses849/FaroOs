import { supabase } from '../lib/supabase/client'
import { normalizeTimeZone } from '../lib/calendarDates'
import { normalizeCalendarRows } from '../services/calendarService'

function calendarEntriesTableIsMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || error.message?.includes('calendar_entries') === true
}

export const calendarRepository = {
  async getAll(userId: string) {
    const [tasksResult, projectsResult, goalsResult, entriesResult, profileResult] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', userId),
      supabase.from('projects').select('*').eq('user_id', userId),
      supabase.from('goals').select('*').eq('user_id', userId),
      supabase.from('calendar_entries').select('*').eq('user_id', userId),
      supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
    ])
    if (tasksResult.error) throw tasksResult.error
    if (projectsResult.error) throw projectsResult.error
    if (goalsResult.error) throw goalsResult.error
    // Calendar entries were introduced after the original calendar. Keep tasks,
    // projects and goals usable while a deployment is waiting for this migration.
    if (entriesResult.error && !calendarEntriesTableIsMissing(entriesResult.error)) throw entriesResult.error
    if (profileResult.error) throw profileResult.error
    const normalized = normalizeCalendarRows({
      tasks: tasksResult.data,
      projects: projectsResult.data,
      goals: goalsResult.data,
      entries: entriesResult.data ?? [],
    })
    return {
      ...normalized,
      timezone: normalizeTimeZone(profileResult.data?.timezone),
    }
  },
}
