import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAll: vi.fn(), user: { id: 'user-1', is_anonymous: true } }))
vi.mock('./auth', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../repositories/calendarRepository', () => ({ calendarRepository: { getAll: mocks.getAll } }))
vi.mock('../store', () => ({ useFaroStore: (selector: (state: {tasks:never[];projects:never[];goals:never[]}) => unknown) => selector({ tasks: [], projects: [], goals: [] }) }))

import { useCalendarData } from './useCalendarData'

describe('useCalendarData refresh reactivo', () => {
  beforeEach(() => {
    mocks.getAll.mockReset().mockResolvedValue({ items: [], timezone: 'America/Mexico_City', omittedCount: 0 })
  })

  it('recarga los datos al recibir una mutación confirmada por Voice', async () => {
    renderHook(() => useCalendarData())
    await waitFor(() => expect(mocks.getAll).toHaveBeenCalled())
    const initialCalls = mocks.getAll.mock.calls.length
    act(() => window.dispatchEvent(new CustomEvent('faro:calendar-updated', { detail: { toolName: 'createCalendarEvent' } })))
    await waitFor(() => expect(mocks.getAll.mock.calls.length).toBeGreaterThan(initialCalls))
  })
})
