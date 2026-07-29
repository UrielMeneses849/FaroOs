import { supabase } from '../lib/supabase/client'
import { normalizeTimeZone } from '../lib/calendarDates'
import { normalizeCalendarRows } from '../services/calendarService'

export const calendarRepository = {
  async getAll(userId: string) {
    const [tasksResult, projectsResult, goalsResult, profileResult] = await Promise.all([
      supabase.from('tasks').select('*').eq('user_id', userId),
      supabase.from('projects').select('*').eq('user_id', userId),
      supabase.from('goals').select('*').eq('user_id', userId),
      supabase.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
    ])
    if (tasksResult.error) throw tasksResult.error
    if (projectsResult.error) throw projectsResult.error
    if (goalsResult.error) throw goalsResult.error
    if (profileResult.error) throw profileResult.error
    const normalized = normalizeCalendarRows({
      tasks: tasksResult.data,
      projects: projectsResult.data,
      goals: goalsResult.data,
    })
    return {
      ...normalized,
      timezone: normalizeTimeZone(profileResult.data?.timezone),
    }
  },
}
