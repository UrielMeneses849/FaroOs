import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { JournalEntry } from '../types'

type Row = Database['public']['Tables']['journal_entries']['Row']
type Insert = Database['public']['Tables']['journal_entries']['Insert']

const fromRow = (row: Row): JournalEntry => ({
  id: row.id, area: (row.area ?? 'personal') as JournalEntry['area'],
  title: row.title ?? 'Sin título', content: row.content, occurredAt: row.entry_date,
  mood: row.mood ?? undefined, gratitude: row.gratitude ?? undefined,
  lesson: row.lesson ?? undefined, tags: row.tags ?? [],
  createdAt: row.created_at, updatedAt: row.updated_at,
  archivedAt: row.archived_at ?? undefined,
})

const toRow = (entry: JournalEntry, userId: string): Insert => ({
  id: entry.id, user_id: userId, area: entry.area, title: entry.title,
  content: entry.content, entry_date: entry.occurredAt.slice(0, 10),
  mood: entry.mood, gratitude: entry.gratitude, lesson: entry.lesson,
  tags: entry.tags, created_at: entry.createdAt, updated_at: entry.updatedAt,
  archived_at: entry.archivedAt,
})

export const journalRepository = {
  async list(userId: string) {
    const { data, error } = await supabase.from('journal_entries').select('*')
      .eq('user_id', userId).is('archived_at', null).order('entry_date', { ascending: false })
    if (error) throw error
    return data.map(fromRow)
  },
  async save(entry: JournalEntry, userId: string) {
    const { data, error } = await supabase.from('journal_entries').upsert(toRow(entry, userId))
      .select().single()
    if (error) throw error
    return fromRow(data)
  },
  async remove(id: string, userId: string) {
    const { error } = await supabase.from('journal_entries').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
  },
} as const
