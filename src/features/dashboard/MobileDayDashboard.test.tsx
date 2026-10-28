import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFaroStore } from '../../store'
import { MobileDayDashboard } from './MobileDayDashboard'
import { TaskSyncContext } from '../../providers/TaskSyncContext'
import type { FinanceData } from '../finance/financeTypes'
const mocks = vi.hoisted(() => ({ finance: undefined as FinanceData | undefined, error: null as string | null, openVoice: vi.fn(), refresh: vi.fn(), enabled: true }))
vi.mock('../../hooks/useFinance', () => ({ useFinance: () => ({ data: mocks.finance!, loading: false, error: mocks.error, refresh: mocks.refresh, user: { id: 'test-user' } }) }))
vi.mock('../../hooks/useCalendarData', () => ({ useCalendarData: () => ({ data: { items: [], timezone: 'America/Mexico_City' }, loading: false, error: null, forceRefresh: mocks.refresh }) }))
vi.mock('../voice/FaroVoiceProvider', () => ({ useOptionalFaroVoice: () => ({ enabled: mocks.enabled, openFaroVoice: mocks.openVoice }) }))
vi.mock('../planning/PlanningDialogs', () => ({ TaskFormDialog: ({ initial, onClose }: { initial?: { title: string }; onClose: () => void }) => <div role="dialog" aria-label="Editar tarea"><span>{initial?.title}</span><button onClick={onClose}>Cerrar tarea</button></div> }))
function LocationProbe() { const location = useLocation(); return <output aria-label="Ruta actual">{location.pathname}{location.search}</output> }
const renderDay = () => render(<MemoryRouter><MobileDayDashboard /><LocationProbe /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks(); mocks.error = null; mocks.enabled = true; localStorage.clear(); sessionStorage.clear()
  mocks.finance = { accounts: [{ id: 'bank', name: 'Cuenta', type: 'checking', currency: 'MXN', initialBalanceCents: 600000, isActive: true, createdAt: '', updatedAt: '' }], transactions: [], categories: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [], liquidityPreference: { minimumOperatingBufferCents: 0 }, liquiditySnapshots: [] }
  useFaroStore.setState({ tasks: [{ id: 'task', title: 'Cerrar propuesta', area: 'personal', status: 'doing', priority: 'high', createdAt: '', updatedAt: '' }], projects: [], goals: [], ideas: [] })
})
describe('Mi día', () => {
  it('completes and undoes the original task through the shared store', () => {
    renderDay()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Completar Cerrar propuesta' }))
    expect(useFaroStore.getState().tasks[0].status).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(useFaroStore.getState().tasks[0].status).toBe('doing')
  })
  it('opens the existing task editor and finance summary instead of duplicate records', () => {
    renderDay()
    fireEvent.click(screen.getByRole('button', { name: 'Editar Cerrar propuesta' }))
    expect(within(screen.getByRole('dialog')).getByText('Cerrar propuesta')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar tarea' }))
    fireEvent.click(screen.getByRole('link', { name: 'Ver finanzas' }))
    expect(screen.getByLabelText('Ruta actual')).toHaveTextContent('/finance')
    expect(sessionStorage.getItem('faro-finance-panel')).toBe('overview')
  })
  it('opens text capture without turning on voice and can explicitly open the existing voice panel', () => {
    renderDay()
    fireEvent.click(screen.getByRole('button', { name: 'Capturar con FARO' }))
    expect(screen.getByRole('dialog', { name: 'Captura rápida' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('¿Qué tienes en mente?')).toBeInTheDocument()
    expect(mocks.openVoice).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Hablar con FARO' }))
    expect(mocks.openVoice).toHaveBeenCalledWith({ surface: 'dashboard' })
  })
  it('keeps text capture usable when voice is disabled on the work device', () => {
    mocks.enabled = false; renderDay()
    fireEvent.click(screen.getByRole('button', { name: 'Capturar con FARO' }))
    expect(screen.getByRole('dialog', { name: 'Captura rápida' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hablar con FARO' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('¿Qué tienes en mente?'), { target: { value: 'Recordar la propuesta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar captura' }))
    expect(useFaroStore.getState().ideas.some(idea => idea.title === 'Recordar la propuesta')).toBe(true)
  })
  it('does not show a fabricated zero balance when the financial request fails', () => {
    mocks.finance!.accounts = []; mocks.error = 'offline'; renderDay()
    expect(screen.getByRole('alert')).toHaveTextContent('Sin lectura')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(mocks.refresh).toHaveBeenCalled()
  })
  it('surfaces task synchronization errors and allows retry', () => {
    const retry = vi.fn()
    render(<MemoryRouter><TaskSyncContext.Provider value={{ state: 'error', error: 'offline', retry }}><MobileDayDashboard /></TaskSyncContext.Provider></MemoryRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Hay cambios por sincronizar')
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(retry).toHaveBeenCalled()
  })
})
