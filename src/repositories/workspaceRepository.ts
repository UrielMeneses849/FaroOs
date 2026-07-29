import { supabase } from '../lib/supabase/client'
import type { Database } from '../types/database.types'
import type { Workspace } from '../types'

type WorkspaceRow = Database['public']['Tables']['workspaces']['Row']
type WorkspaceInsert = Database['public']['Tables']['workspaces']['Insert']
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update']

export const defaultWorkspaces = [
  { name: 'Personal', type: 'personal', color: '#2457ff' },
  { name: 'BBVA', type: 'employment', color: '#1973e8' },
  { name: 'BIMSA', type: 'client', color: '#35c78a' },
  { name: 'Nexvora', type: 'business', color: '#6d8aff' },
  { name: 'Portfolio', type: 'personal', color: '#a970ff' },
] as const

const fromRow = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  type: row.type,
  color: row.color ?? undefined,
  icon: row.icon ?? undefined,
  isActive: row.is_active,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export const workspaceRepository = {
  async getAll(userId: string) {
    const { data, error } = await supabase.from('workspaces').select('*')
      .eq('user_id', userId).order('sort_order')
    if (error) throw error
    return data.map(fromRow)
  },
  async getActive(userId: string) {
    const { data, error } = await supabase.from('workspaces').select('*')
      .eq('user_id', userId).eq('is_active', true).order('sort_order')
    if (error) throw error
    return data.map(fromRow)
  },
  async getById(id: string, userId: string) {
    const { data, error } = await supabase.from('workspaces').select('*')
      .eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data ? fromRow(data) : null
  },
  async create(input: Omit<WorkspaceInsert, 'user_id'>, userId: string) {
    const { data, error } = await supabase.from('workspaces')
      .insert({ ...input, user_id: userId }).select().single()
    if (error) throw error
    return fromRow(data)
  },
  async update(id: string, input: WorkspaceUpdate, userId: string) {
    const { data, error } = await supabase.from('workspaces').update(input)
      .eq('id', id).eq('user_id', userId).select().single()
    if (error) throw error
    return fromRow(data)
  },
  archive(id: string, userId: string) {
    return this.update(id, { is_active: false }, userId)
  },
  restore(id: string, userId: string) {
    return this.update(id, { is_active: true }, userId)
  },
  async reorder(items: Array<{ id: string; sortOrder: number }>, userId: string) {
    await Promise.all(items.map((item) =>
      this.update(item.id, { sort_order: item.sortOrder }, userId)))
  },
  async ensureDefaults(userId: string) {
    const rows: WorkspaceInsert[] = defaultWorkspaces.map((workspace, index) => ({
      user_id: userId, name: workspace.name, type: workspace.type,
      color: workspace.color, is_active: true, sort_order: index,
    }))
    const { error } = await supabase.from('workspaces').upsert(rows, {
      onConflict: 'user_id,name', ignoreDuplicates: true,
    })
    if (error) throw error
    return this.getAll(userId)
  },
  async restoreDefaults(userId: string) {
    await this.ensureDefaults(userId)
    const { error } = await supabase.from('workspaces')
      .update({ is_active: true })
      .eq('user_id', userId)
      .in('name', defaultWorkspaces.map((workspace) => workspace.name))
    if (error) throw error
    return this.getAll(userId)
  },
}
