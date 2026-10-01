import { supabase } from '../lib/supabase/client'

export type HealthLabDocument = { id: string; studyDate: string; studyKind: 'insulin_resistance' | 'blood_chemistry' | 'other'; fileName: string; storagePath: string; notes?: string; createdAt: string; url?: string }
// This table is deployed ahead of the generated Supabase client types.
// Keep the temporary escape hatch local until the next schema type refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawClient = { from: (table: string) => any }
const db = supabase as unknown as RawClient
const kindLabel: Record<HealthLabDocument['studyKind'], string> = { insulin_resistance: 'Resistencia a la insulina', blood_chemistry: 'Química sanguínea', other: 'Otro estudio' }
export { kindLabel }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map = (row: any): HealthLabDocument => ({ id: row.id, studyDate: row.study_date, studyKind: row.study_kind, fileName: row.file_name, storagePath: row.storage_path, notes: row.notes ?? undefined, createdAt: row.created_at })
export const healthLabService = {
  async list(userId: string) {
    const { data, error } = await db.from('health_lab_documents').select('*').eq('user_id', userId).order('study_date', { ascending: false })
    if (error) throw error
    const records: HealthLabDocument[] = (data ?? []).map(map)
    return Promise.all(records.map(async (record: HealthLabDocument) => {
      const { data: signed } = await supabase.storage.from('health-labs').createSignedUrl(record.storagePath, 60 * 10)
      return { ...record, url: signed?.signedUrl }
    }))
  },
  async upload(userId: string, input: { file: File; studyDate: string; studyKind: HealthLabDocument['studyKind']; notes?: string }) {
    const cleanName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${userId}/${crypto.randomUUID()}-${cleanName}`
    const { error: uploadError } = await supabase.storage.from('health-labs').upload(storagePath, input.file, { upsert: false })
    if (uploadError) throw uploadError
    const { data, error } = await db.from('health_lab_documents').insert({ user_id: userId, study_date: input.studyDate, study_kind: input.studyKind, file_name: input.file.name, storage_path: storagePath, notes: input.notes || null }).select().single()
    if (error) { await supabase.storage.from('health-labs').remove([storagePath]); throw error }
    return map(data)
  },
  async remove(id: string, storagePath: string, userId: string) {
    const { error } = await db.from('health_lab_documents').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    await supabase.storage.from('health-labs').remove([storagePath])
  },
}
