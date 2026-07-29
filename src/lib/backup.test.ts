import { describe, expect, it } from 'vitest'
import { demoData } from '../data/mockData'
import { useFaroStore } from '../store'
import { createBackup, parseBackup } from './backup'

describe('respaldos FARO', () => {
  it('exporta e importa un respaldo completo', () => {
    const backup = createBackup(demoData)
    const imported = parseBackup(JSON.stringify(backup))
    expect(imported.schemaVersion).toBe(4)
    expect(imported.data.goals).toHaveLength(demoData.goals.length)
    expect(imported.data.journalEntries[0].tags).toEqual(['faro', 'inicio'])
  })

  it('rechaza JSON inválido y esquemas incompatibles', () => {
    expect(() => parseBackup('{invalid')).toThrow('JSON válido')
    expect(() => parseBackup(JSON.stringify({ product: 'FARO OS', schemaVersion: 99, data: {} }))).toThrow('formato compatible')
  })

  it('reemplaza el estado sólo después de validarlo', () => {
    const backup = createBackup({ ...demoData, ideas: [] })
    useFaroStore.getState().replaceData(parseBackup(JSON.stringify(backup)).data)
    expect(useFaroStore.getState().ideas).toHaveLength(0)
    expect(useFaroStore.getState().goals).toHaveLength(demoData.goals.length)
  })

  it('recupera de localStorage corrupto sin perder el estado en memoria', async () => {
    const goalCount = useFaroStore.getState().goals.length
    localStorage.setItem('faro-os-data', 'no-es-json')
    await expect(useFaroStore.persist.rehydrate()).resolves.toBeUndefined()
    expect(useFaroStore.getState().goals).toHaveLength(goalCount)
    expect(localStorage.getItem('faro-os-data')).toBeNull()
  })
})
