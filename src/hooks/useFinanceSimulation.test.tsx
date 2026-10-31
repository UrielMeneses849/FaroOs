import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFinanceSimulationState, financeSimulationStorageKey, type FinanceSimulationItem } from '../services/financeSimulation'
import { useFinanceSimulation } from './useFinanceSimulation'

const idea: FinanceSimulationItem = { id: 'watch', kind: 'expense', description: 'Reloj', accountId: 'bank', date: '2026-11-20', amountCents: 500_000 }

describe('useFinanceSimulation', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('persists ideas, retains them when switched off, and reloads them after a remount', () => {
    const first = renderHook(() => useFinanceSimulation('one'))
    act(() => first.result.current.upsertItem(idea))
    act(() => first.result.current.setEnabled(true))
    act(() => first.result.current.setEnabled(false))
    expect(first.result.current.state.items).toEqual([idea])
    first.unmount()
    const second = renderHook(() => useFinanceSimulation('one'))
    expect(second.result.current.state).toEqual({ version: 1, enabled: false, items: [idea] })
    expect(second.result.current.storageError).toBeNull()
  })

  it('edits and deletes ideas and explicitly clears both the scenario and enabled switch', () => {
    const { result } = renderHook(() => useFinanceSimulation('one'))
    act(() => result.current.upsertItem(idea))
    act(() => result.current.upsertItem({ ...idea, amountCents: 100 }))
    expect(result.current.state.items).toEqual([{ ...idea, amountCents: 100 }])
    act(() => result.current.removeItem(idea.id))
    expect(result.current.state.items).toEqual([])
    act(() => result.current.upsertItem(idea))
    act(() => result.current.setEnabled(true))
    act(() => result.current.clear())
    expect(result.current.state).toEqual(createFinanceSimulationState())
    expect(JSON.parse(window.localStorage.getItem(financeSimulationStorageKey('one'))!)).toEqual(createFinanceSimulationState())
  })

  it('isolates account switches and ignores callbacks retained from an old user', () => {
    const { result, rerender } = renderHook(({ userId }) => useFinanceSimulation(userId), { initialProps: { userId: 'one' as string | undefined } })
    act(() => result.current.upsertItem(idea))
    act(() => result.current.setEnabled(true))
    const staleAdd = result.current.upsertItem
    rerender({ userId: 'two' })
    expect(result.current.state).toEqual(createFinanceSimulationState())
    act(() => staleAdd({ ...idea, id: 'stale' }))
    expect(result.current.state.items).toEqual([])
    expect(window.localStorage.getItem(financeSimulationStorageKey('two'))).toBeNull()
    act(() => result.current.upsertItem({ ...idea, id: 'other-user' }))
    rerender({ userId: undefined })
    expect(result.current.state).toEqual(createFinanceSimulationState())
    rerender({ userId: 'one' })
    expect(result.current.state.items).toEqual([idea])
    expect(result.current.state.enabled).toBe(true)
  })

  it('keeps unreadable stored data intact until explicit reset and reports its recovery state', () => {
    const key = financeSimulationStorageKey('one')
    window.localStorage.setItem(key, 'unreadable-backup')
    const { result } = renderHook(() => useFinanceSimulation('one'))
    expect(result.current.storageError).toContain('respaldo')
    act(() => result.current.upsertItem(idea))
    expect(result.current.state.items).toEqual([idea])
    expect(window.localStorage.getItem(key)).toBe('unreadable-backup')
    act(() => result.current.clear())
    expect(result.current.storageError).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(key)!)).toEqual(createFinanceSimulationState())
  })

  it('retains the live draft and reports write failures, then retries with the entire draft', () => {
    const { result } = renderHook(() => useFinanceSimulation('one'))
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    act(() => result.current.upsertItem(idea))
    expect(result.current.state.items).toEqual([idea])
    expect(result.current.storageError).toContain('no se pudo guardar')
    storageWrite.mockRestore()
    act(() => result.current.setEnabled(true))
    expect(result.current.storageError).toBeNull()
    expect(JSON.parse(window.localStorage.getItem(financeSimulationStorageKey('one'))!).items).toEqual([idea])
  })

  it('reports unavailable reads without throwing or replacing the saved scenario', () => {
    const key = financeSimulationStorageKey('one')
    window.localStorage.setItem(key, JSON.stringify({ version: 1, enabled: true, items: [idea] }))
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage disabled') })
    const { result } = renderHook(() => useFinanceSimulation('one'))
    expect(result.current.state).toEqual(createFinanceSimulationState())
    expect(result.current.storageError).not.toBeNull()
    read.mockRestore()
    expect(JSON.parse(window.localStorage.getItem(key)!).items).toEqual([idea])
  })

  it('rejects invalid updates while preserving the previous saved state', () => {
    const { result } = renderHook(() => useFinanceSimulation('one'))
    act(() => result.current.upsertItem(idea))
    const saved = window.localStorage.getItem(financeSimulationStorageKey('one'))
    act(() => result.current.upsertItem({ ...idea, amountCents: -1 }))
    expect(result.current.state.items).toEqual([idea])
    expect(result.current.storageError).toContain('inválido')
    expect(window.localStorage.getItem(financeSimulationStorageKey('one'))).toBe(saved)
  })
})
