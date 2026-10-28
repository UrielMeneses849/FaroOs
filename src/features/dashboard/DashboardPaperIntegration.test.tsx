import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFaroStore } from '../../store'
import { DashboardPage } from './DashboardPage'

vi.mock('../../hooks/useFinance', () => ({ useFinance: () => ({ data: {
  accounts: [], categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [],
  budgetClosures: [], savingsFundEntries: [], goalItems: [], liquidityPreference: { minimumOperatingBufferCents: 150_000 }, liquiditySnapshots: [],
}, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../hooks/useCalendarData', () => ({ useCalendarData: () => ({ data: { items: [], timezone: 'America/Mexico_City', omittedCount: 0 }, loading: false, error: null, refresh: vi.fn() }) }))
vi.mock('../../hooks/useWorkspaces', () => ({ useWorkspaces: () => ({ data: [] }) }))
vi.mock('../../hooks/useHealthRecords', () => ({ useHealthRecords: () => ({ logs: [], save: vi.fn() }) }))
vi.mock('../storage/supabaseCapacity', () => ({ getSupabaseDatabaseCapacity: () => new Promise(() => {}) }))
vi.mock('../../desktop/desktopBridge', () => ({ isFaroDesktop: () => false, getDesktopStorageCapacity: vi.fn() }))
vi.mock('../finance/ExpenseCategoryDonut', () => ({ ExpenseCategoryDonut: () => <div>Distribución de gastos</div> }))
vi.mock('../voice/FaroVoiceProvider', () => ({ useOptionalFaroVoice: () => null }))
vi.mock('../planning/PlanningDialogs', () => ({ TaskFormDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="Crear tarea"><button onClick={onClose}>Cerrar tarea</button></div> }))

let desktop = true
let listeners: Array<() => void> = []
function LocationProbe() { const location = useLocation(); return <output aria-label="Ruta actual">{location.pathname}{location.search}</output> }

beforeEach(() => {
  desktop = true
  listeners = []
  useFaroStore.setState({ tasks: [] })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    media: query, get matches() { return desktop },
    addEventListener: (_name: string, handler: () => void) => listeners.push(handler),
    removeEventListener: (_name: string, handler: () => void) => { listeners = listeners.filter((listener) => listener !== handler) },
  })))
})
afterEach(() => vi.unstubAllGlobals())

describe('Paper home coexistence with mobile', () => {
  it('conserva la vista móvil cuando la API matchMedia no está disponible', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Mi día' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Capturar con FARO' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tu día, en perspectiva.' })).not.toBeInTheDocument()
  })

  it('usa el flujo de movimientos y el formulario existente de tareas desde el home desktop', async () => {
    render(<MemoryRouter><DashboardPage /><LocationProbe /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Tu día, en perspectiva.' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Crear tarea' }))
    expect(screen.getByRole('dialog', { name: 'Crear tarea' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar tarea' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Registrar movimiento' })[0])
    expect(screen.getByRole('status', { name: 'Ruta actual' })).toHaveTextContent('/finance?quick=movement')
    expect(sessionStorage.getItem('faro-finance-panel')).toBe('transactions')
  })

  it('retira Paper al pasar a móvil y conserva el Dashboard y sus accesos existentes', () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Tu día, en perspectiva.' })).toBeInTheDocument()
    act(() => { desktop = false; listeners.forEach((listener) => listener()) })
    expect(screen.queryByRole('heading', { name: 'Tu día, en perspectiva.' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mi día' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Capturar con FARO' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Más de tu día/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver finanzas' })).toBeInTheDocument()
  })

  it('mantiene disponibles los paneles adicionales sin ocupar el primer plano del home', async () => {
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const toggle = screen.getByRole('button', { name: /Más de tu día/ })
    const panels = document.getElementById('dashboard-supporting-panels')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panels).toHaveAttribute('data-paper-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(panels).toHaveAttribute('data-paper-expanded', 'true')
    expect(screen.getByText('Estado de workspaces')).toBeInTheDocument()
    expect(screen.getByText('Último peso')).toBeInTheDocument()
  })
})
