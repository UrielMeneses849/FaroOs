import { supabase } from '../lib/supabase/client'
import type { CalendarEntry } from '../types'
import type { Database } from '../types/database.types'

type Row = Database['public']['Tables']['calendar_entries']['Row']

export function calendarEntryFromRow(row: Row): CalendarEntry {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    kind: row.kind as CalendarEntry['kind'],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    allDay: row.all_day,
    workspaceId: row.workspace_id ?? undefined,
    linkedTaskId: row.linked_task_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const calendarEntryRepository = {
  async list(userId: string): Promise<CalendarEntry[]> {
    const { data, error } = await supabase.from('calendar_entries').select('*')
      .eq('user_id', userId).order('starts_at')
    if (error) throw error
    return data.map(calendarEntryFromRow)
  },
  async create(entry: Omit<CalendarEntry, 'id' | 'createdAt' | 'updatedAt'>, userId: string) {
    const { data, error } = await supabase.from('calendar_entries').insert({
      user_id: userId,
      title: entry.title.trim(),
      description: entry.description?.trim() || null,
      kind: entry.kind,
      starts_at: entry.startsAt,
      ends_at: entry.endsAt,
      all_day: entry.allDay,
      workspace_id: entry.workspaceId ?? null,
      linked_task_id: entry.linkedTaskId ?? null,
    }).select().single()
    if (error) throw error
    return calendarEntryFromRow(data)
  },
  async update(entry: CalendarEntry, userId: string) {
    const { data, error } = await supabase.from('calendar_entries').update({
      title: entry.title.trim(), description: entry.description?.trim() || null,
      kind: entry.kind, starts_at: entry.startsAt, ends_at: entry.endsAt,
      all_day: entry.allDay, workspace_id: entry.workspaceId ?? null,
      linked_task_id: entry.linkedTaskId ?? null, updated_at: new Date().toISOString(),
    }).eq('id', entry.id).eq('user_id', userId).select().single()
    if (error) throw error
    return calendarEntryFromRow(data)
  },
  async updateSchedule(id: string, startsAt: string, endsAt: string, userId: string) {
    const { error } = await supabase.from('calendar_entries').update({
      starts_at: startsAt, ends_at: endsAt, updated_at: new Date().toISOString(),
    }).eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
  async remove(id: string, userId: string) {
    const { error } = await supabase.from('calendar_entries').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
}
