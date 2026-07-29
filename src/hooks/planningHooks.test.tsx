import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { GoalSyncContext } from '../providers/GoalSyncContext'
import { ProjectSyncContext } from '../providers/ProjectSyncContext'
import { useGoals } from './useGoals'
import { useProjects } from './useProjects'

const wrapper = ({ children }: { children: ReactNode }) => <GoalSyncContext.Provider value={{ state: 'ready', error: null, retry: () => undefined }}><ProjectSyncContext.Provider value={{ state: 'ready', error: null, retry: () => undefined }}>{children}</ProjectSyncContext.Provider></GoalSyncContext.Provider>

describe('hooks de planificación estables', () => {
  it('conserva el snapshot de Goals cuando el store no cambia', () => {
    const { result, rerender } = renderHook(() => useGoals(), { wrapper })
    const snapshot = result.current.data
    rerender()
    expect(result.current.data).toBe(snapshot)
  })

  it('conserva el snapshot de Projects cuando el store no cambia', () => {
    const { result, rerender } = renderHook(() => useProjects(), { wrapper })
    const snapshot = result.current.data
    rerender()
    expect(result.current.data).toBe(snapshot)
  })
})
