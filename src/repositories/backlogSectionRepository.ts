import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { BacklogSection } from '../types'

type SectionRow = Database['public']['Tables']['backlog_sections']['Row']

const fromRow = (row: SectionRow): BacklogSection => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  color: row.color,
  sortOrder: row.sort_order,
  archivedAt: row.archived_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const friendlyError = (reason: { code?: string; message: string }) => {
  if (reason.code === '23505') return new Error('Ya existe una sección con ese nombre en el workspace.')
  return new Error(reason.message)
}

export const backlogSectionRepository = {
  async list(workspaceId: string, userId: string): Promise<BacklogSection[]> {
    const { data, error } = await supabase.from('backlog_sections').select('*')
      .eq('user_id', userId).eq('workspace_id', workspaceId).is('archived_at', null)
      .order('sort_order').order('name')
    if (error) throw friendlyError(error)
    return data.map(fromRow)
  },

  async create(input: { workspaceId: string; name: string; color: string; sortOrder: number }, userId: string) {
    const { data, error } = await supabase.from('backlog_sections').insert({
      user_id: userId,
      workspace_id: input.workspaceId,
      name: input.name.trim(),
      color: input.color,
      sort_order: input.sortOrder,
    }).select().single()
    if (error) throw friendlyError(error)
    return fromRow(data)
  },

  async update(id: string, input: { name: string; color: string; sortOrder: number }, userId: string) {
    const { data, error } = await supabase.from('backlog_sections').update({
      name: input.name.trim(), color: input.color, sort_order: input.sortOrder,
    }).eq('id', id).eq('user_id', userId).select().single()
    if (error) throw friendlyError(error)
    return fromRow(data)
  },

  async remove(id: string, userId: string) {
    const { error } = await supabase.from('backlog_sections').delete()
      .eq('id', id).eq('user_id', userId)
    if (error) throw friendlyError(error)
  },
}
