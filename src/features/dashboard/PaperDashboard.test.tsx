import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskSyncContext } from '../../providers/TaskSyncContext'
import type { FinanceData } from '../finance/financeTypes'
import type { Task } from '../../types'
import { PaperDashboard } from './PaperDashboard'

const voice = vi.hoisted(() => ({ enabled: true, open: false, visualState: 'ready', openFaroVoice: vi.fn() }))
vi.mock('../voice/FaroVoiceProvider', () => ({ useOptionalFaroVoice: () => voice }))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: () => <div data-testid="liquidity-chart" />,
  Area: () => null, CartesianGrid: () => null, Line: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}))

const finance: FinanceData = {
  accounts: [{ id: 'cash', name: 'Cuenta principal', type: 'checking', currency: 'MXN', initialBalanceCents: 1_000_000, isActive: true, createdAt: '', updatedAt: '' }],
  categories: [], transactions: [], recurring: [], recurringOccurrences: [], budgets: [], goals: [], contributions: [], budgetClosures: [], savingsFundEntries: [], goalItems: [],
  liquidityPreference: { minimumOperatingBufferCents: 150_000 }, liquiditySnapshots: [],
}
const task: Task = { id: 'task', title: 'Preparar propuesta', description: 'Revisar notas', status: 'todo', area: 'personal', priority: 'high', dueDate: '2026-10-10', createdAt: '', updatedAt: '' }
const props = {
  finance, financeLoading: false, financeError: null, refreshFinance: vi.fn(),
  calendar: { items: [], timezone: 'America/Mexico_City', omittedCount: 0 }, calendarLoading: false, calendarError: null, refreshCalendar: vi.fn(),
  tasks: [task], onCreateTask: vi.fn(), onEditTask: vi.fn(), onCompleteTask: vi.fn(), onRegisterMovement: vi.fn(), referenceDate: new Date(2026, 9, 10, 12),
}

beforeEach(() => { vi.clearAllMocks(); voice.enabled = true; voice.open = false; voice.visualState = 'ready' })

describe('Paper home connected actions and data states', () => {
  it('conecta los accesos de movimiento, creación, edición y completar a sus handlers reales', async () => {
    render(<MemoryRouter><PaperDashboard {...props} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Registrar movimiento' }))
    await userEvent.click(screen.getByRole('button', { name: 'Crear tarea' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Completar Preparar propuesta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Editar Preparar propuesta' }))
    expect(props.onRegisterMovement).toHaveBeenCalledOnce()
    expect(props.onCreateTask).toHaveBeenCalledOnce()
    expect(props.onCompleteTask).toHaveBeenCalledExactlyOnceWith(task)
    expect(props.onEditTask).toHaveBeenCalledExactlyOnceWith(task)
    expect(screen.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/backlog')
    expect(screen.getByTestId('liquidity-chart')).toBeInTheDocument()
  })

  it('muestra carga sin importes falsos ni una gráfica vacía', () => {
    render(<MemoryRouter><PaperDashboard {...props} finance={{ ...finance, accounts: [] }} financeLoading /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Tu situación financiera' })
    expect(within(panel).getByRole('status')).toHaveTextContent('Cargando tu situación financiera')
    expect(within(panel).queryByText(/\$0\.00/)).not.toBeInTheDocument()
    expect(within(panel).queryByTestId('liquidity-chart')).not.toBeInTheDocument()
  })

  it('permite recuperar el resumen al fallar la consulta', async () => {
    render(<MemoryRouter><PaperDashboard {...props} financeError="La conexión no está disponible." /></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Tu situación financiera' })
    expect(within(panel).getByRole('alert')).toHaveTextContent('La conexión no está disponible.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }))
    expect(props.refreshFinance).toHaveBeenCalledOnce()
    expect(within(panel).queryByTestId('liquidity-chart')).not.toBeInTheDocument()
  })

  it('ofrece configurar cuentas cuando todavía no hay saldo configurado', () => {
    render(<MemoryRouter><PaperDashboard {...props} finance={{ ...finance, accounts: [] }} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Configurar mis cuentas/ })).toHaveAttribute('href', '/finance')
    expect(screen.queryByTestId('liquidity-chart')).not.toBeInTheDocument()
  })

  it('abre la conversación existente y no simula enviar texto ni activar el micrófono', async () => {
    render(<MemoryRouter><PaperDashboard {...props} /></MemoryRouter>)
    expect(screen.getByText('Micrófono apagado')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Hablar con FARO' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pregúntame por tu día…' }))
    expect(voice.openFaroVoice).toHaveBeenNthCalledWith(1, { surface: 'dashboard' })
    expect(voice.openFaroVoice).toHaveBeenNthCalledWith(2, { surface: 'dashboard' })
  })

  it('muestra errores de sincronización junto a tareas locales y conserva el reintento', async () => {
    const retry = vi.fn()
    render(<MemoryRouter><TaskSyncContext.Provider value={{ state: 'error', error: 'Offline', retry }}><PaperDashboard {...props} /></TaskSyncContext.Provider></MemoryRouter>)
    const panel = screen.getByRole('region', { name: 'Pendientes de hoy' })
    expect(within(panel).getByRole('alert')).toHaveTextContent('guardado en este dispositivo')
    expect(within(panel).getByText('Preparar propuesta')).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Reintentar' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('desactiva las acciones de voz si el proveedor no la ofrece', () => {
    voice.enabled = false
    render(<MemoryRouter><PaperDashboard {...props} /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Hablar con FARO' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Pregúntame por tu día…' })).toBeDisabled()
  })
})
