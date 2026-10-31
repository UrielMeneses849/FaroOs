import { useCallback, useState } from 'react'
import {
  createFinanceSimulationState,
  financeSimulationStorageKey,
  parseFinanceSimulationState,
  validateFinanceSimulationItem,
  type FinanceSimulationItem,
  type FinanceSimulationState,
} from '../services/financeSimulation'

interface SimulationSnapshot {
  userId?: string
  state: FinanceSimulationState
  storageError: string | null
  blocked: boolean
}

function loadSnapshot(userId?: string): SimulationSnapshot {
  const snapshot: SimulationSnapshot = { userId, state: createFinanceSimulationState(), storageError: null, blocked: false }
  if (!userId) return snapshot
  try {
    if (typeof window === 'undefined') throw new Error('Almacenamiento no disponible.')
    const raw = window.localStorage.getItem(financeSimulationStorageKey(userId))
    if (raw !== null) snapshot.state = parseFinanceSimulationState(raw)
  } catch {
    snapshot.storageError = 'No pudimos leer la simulación guardada. Se conserva el respaldo; usa Reiniciar y limpiar para reemplazarlo.'
    snapshot.blocked = true
  }
  return snapshot
}

/** User-scoped local scenarios; this hook never writes to the finance repository. */
export function useFinanceSimulation(userId?: string) {
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => loadSnapshot(userId))
  // Adjust synchronously on account switches: no render exposes the prior
  // user's scenario, and no delayed persistence effect can cross-write it.
  if (snapshot.userId !== userId) setSnapshot(loadSnapshot(userId))

  const change = useCallback((update: (state: FinanceSimulationState) => FinanceSimulationState, reset = false) => {
    setSnapshot(previous => {
      if (previous.userId !== userId) return previous
      if (!userId) return { ...previous, storageError: 'Inicia sesión para guardar una simulación.' }
      let state: FinanceSimulationState
      try { state = update(previous.state) }
      catch (reason) { return { ...previous, storageError: reason instanceof Error ? reason.message : 'Movimiento inválido.' } }
      if (previous.blocked && !reset) return { ...previous, state }
      try {
        if (typeof window === 'undefined') throw new Error('Almacenamiento no disponible.')
        window.localStorage.setItem(financeSimulationStorageKey(userId), JSON.stringify(state))
        return { userId, state, storageError: null, blocked: false }
      } catch {
        return { userId, state, storageError: 'La simulación está disponible en esta sesión, pero no se pudo guardar. Conserva esta ventana abierta e intenta de nuevo.', blocked: false }
      }
    })
  }, [userId])

  const setEnabled = useCallback((enabled: boolean) => change(state => ({ ...state, enabled })), [change])
  const upsertItem = useCallback((item: FinanceSimulationItem) => change(state => {
    const validated = validateFinanceSimulationItem(item)
    const exists = state.items.some(candidate => candidate.id === validated.id)
    return { ...state, items: exists ? state.items.map(candidate => candidate.id === validated.id ? validated : candidate) : [...state.items, validated] }
  }), [change])
  const removeItem = useCallback((id: string) => change(state => ({ ...state, items: state.items.filter(item => item.id !== id) })), [change])
  const clear = useCallback(() => change(createFinanceSimulationState, true), [change])

  return { state: snapshot.state, setEnabled, upsertItem, removeItem, clear, storageError: snapshot.storageError }
}
