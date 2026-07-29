import { describe, expect, it } from 'vitest'
import { useFaroStore } from './useFaroStore'

const base = { createdAt: '2026-07-23T12:00:00.000Z', updatedAt: '2026-07-23T12:00:00.000Z' }

describe('registros personales', () => {
  it('registra estudio', () => {
    useFaroStore.getState().createStudySession({ ...base, id: 'study-new', area: 'learning', topic: 'Responses API', skill: 'OpenAI API', durationMinutes: 40, occurredAt: base.createdAt })
    expect(useFaroStore.getState().studySessions.at(-1)).toMatchObject({ topic: 'Responses API', durationMinutes: 40 })
  })

  it('registra una transacción sin datos bancarios', () => {
    useFaroStore.getState().createTransaction({ ...base, id: 'tx-new', area: 'finance', description: 'Libro', category: 'Aprendizaje', amount: 500, kind: 'expense', occurredAt: '2026-07-23' })
    expect(useFaroStore.getState().transactions.at(-1)).toMatchObject({ description: 'Libro', amount: 500 })
  })

  it('registra salud y tratamiento por separado', () => {
    useFaroStore.getState().createHealthLog({ ...base, id: 'health-new', area: 'health', occurredAt: '2026-07-23', mood: 8, energy: 7, anxiety: 3, sleepHours: 7.5 })
    useFaroStore.getState().createTreatmentLog({ ...base, id: 'treatment-new', area: 'health', treatment: 'isotretinoin', occurredAt: '2026-07-23', medicationTaken: true, dosage: 'Dosis indicada' })
    expect(useFaroStore.getState().healthLogs.at(-1)?.mood).toBe(8)
    expect(useFaroStore.getState().treatmentLogs.at(-1)).toMatchObject({ medicationTaken: true, dosage: 'Dosis indicada' })
  })

  it('crea una entrada de diario', () => {
    useFaroStore.getState().createJournalEntry({ ...base, id: 'journal-new', area: 'personal', title: 'Hoy', content: 'Construí algo importante.', occurredAt: base.createdAt, mood: 8, gratitude: 'Tiempo', lesson: 'Avanzar despacio', tags: ['faro'] })
    expect(useFaroStore.getState().journalEntries.at(-1)).toMatchObject({ title: 'Hoy', tags: ['faro'] })
  })
})
