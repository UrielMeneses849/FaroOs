import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarData } from '../features/calendar/calendarTypes'
import { useFaroStore } from '../store'
import type { Workspace } from '../types'
import { CalendarPage } from './CalendarPage'

const mocks = vi.hoisted(() => ({
  loading: false,
  data: { items: [], timezone: 'America/Mexico_City', omittedCount: 0 } as CalendarData,
  workspaces: [] as Workspace[],
  refresh: vi.fn().mockResolvedValue(undefined),
  persist: vi.fn().mockResolvedValue(undefined),
  google: {
    connection: { connected: false, status: 'disconnected' }, calendars: [], loading: false, error: null,
    connect: vi.fn(), list: vi.fn(), selectMany: vi.fn(), sync: vi.fn(), disconnect: vi.fn(),
  },
}))
vi.mock('../hooks/auth', () => ({ useAuth: () => ({ user: undefined }) }))
vi.mock('../hooks/useCalendarData', () => ({ useCalendarData: () => ({ data: mocks.data, loading: mocks.loading, error: null, forceRefresh: mocks.refresh, google: mocks.google }) }))
vi.mock('../hooks/useWorkspaces', () => ({ useWorkspaces: () => ({ data: mocks.workspaces }) }))
vi.mock('../repositories/taskRepository', () => ({ taskRepository: { updateSchedule: mocks.persist } }))
vi.mock('../repositories/calendarEntryRepository', () => ({ calendarEntryRepository: { updateSchedule: mocks.persist, remove: mocks.persist } }))
vi.mock('../features/calendar/CalendarEntryDialog', () => ({ CalendarEntryDialog: ({ open, startsAt, estimatedMinutes, workspaceId, initialKind, onClose }: { open: boolean; startsAt: string; estimatedMinutes?: number; workspaceId?: string; initialKind?: string; onClose: (saved?: boolean) => void }) => open ? <div role="dialog" aria-label="Nueva entrada"><output aria-label="Inicio">{startsAt}</output><output aria-label="Tipo de entrada">{initialKind}</output><output aria-label="Duración">{estimatedMinutes}</output><output aria-label="Workspace">{workspaceId}</output><button onClick={() => onClose(false)}>Cerrar entrada</button></div> : null }))
vi.mock('@fullcalendar/react', () => ({ default: () => <div aria-label="Lienzo del calendario" /> }))

const workspaces = (): Workspace[] => [
  { id: 'work', name: 'BIMSA', type: 'employment', isActive: true, sortOrder: 0, createdAt: '', updatedAt: '' },
  { id: 'personal', name: 'Personal', type: 'personal', isActive: true, sortOrder: 1, createdAt: '', updatedAt: '' },
]
type TestEntry = string | { pathname: string; search?: string; hash?: string; state?: unknown }
function RouteTools() {
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType()
  return <><output aria-label="Ubicación del router">{JSON.stringify({ ...location, navigationType })}</output>
    <button onClick={() => navigate({ pathname: location.pathname, search: '?quick=event&from=mini', hash: '#agenda' }, { state: { source: 'mini' } })}>Acceso evento</button>
    <button onClick={() => navigate({ pathname: location.pathname, search: '?view=list', hash: '#agenda' })}>Quitar acceso</button>
  </>
}
function TestRouter({ entry = '/calendar' }: { entry?: TestEntry }) { return <MemoryRouter initialEntries={[entry]}><CalendarPage /><RouteTools /></MemoryRouter> }
const show = (entry?: TestEntry) => render(<TestRouter entry={entry} />)
const routerLocation = () => JSON.parse(screen.getByLabelText('Ubicación del router').textContent || '{}')

beforeEach(() => {
  mocks.loading = false; mocks.workspaces = workspaces(); mocks.refresh.mockClear(); mocks.persist.mockClear()
  mocks.data = { items: [], timezone: 'America/Mexico_City', omittedCount: 0 }
  useFaroStore.setState({ tasks: [], projects: [], goals: [] })
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})

describe('Calendar quick entries follow router navigation', () => {
  it('opens an event and consumes only quick with router replace', async () => {
    show({ pathname: '/calendar', search: '?view=week&quick=event&tag=one&tag=two', hash: '#agenda', state: { source: 'pwa', selected: 3 } })
    const dialog = within(await screen.findByRole('dialog', { name: 'Nueva entrada' }))
    expect(dialog.getByLabelText('Tipo de entrada')).toHaveTextContent('event')
    expect(dialog.getByLabelText('Duración')).toHaveTextContent('30')
    expect(dialog.getByLabelText('Workspace')).toHaveTextContent('personal')
    expect(Number.isFinite(new Date(dialog.getByLabelText('Inicio').textContent || '').getTime())).toBe(true)
    await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/calendar', search: '?view=week&tag=one&tag=two', hash: '#agenda', state: { source: 'pwa', selected: 3 }, navigationType: 'REPLACE' }))
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('reopens a new event on repeated shortcuts to the same mounted Calendar', async () => {
    const user = userEvent.setup()
    show()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getByRole('button', { name: 'Acceso evento' }))
      const dialog = await screen.findByRole('dialog', { name: 'Nueva entrada' })
      await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/calendar', search: '?from=mini', hash: '#agenda', state: { source: 'mini' }, navigationType: 'REPLACE' }))
      await user.click(within(dialog).getByRole('button', { name: 'Cerrar entrada' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nueva entrada' })).not.toBeInTheDocument())
    }
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('waits for loading and active workspaces before consuming the event', async () => {
    mocks.loading = true; mocks.workspaces = []
    const view = show('/calendar?quick=event&from=pwa')
    expect(routerLocation().search).toBe('?quick=event&from=pwa')
    expect(screen.queryByRole('dialog', { name: 'Nueva entrada' })).not.toBeInTheDocument()
    mocks.loading = false
    view.rerender(<TestRouter entry='/calendar?quick=event&from=pwa' />)
    expect(routerLocation().search).toBe('?quick=event&from=pwa')
    expect(screen.queryByRole('dialog', { name: 'Nueva entrada' })).not.toBeInTheDocument()
    mocks.workspaces = workspaces()
    view.rerender(<TestRouter entry='/calendar?quick=event&from=pwa' />)
    await screen.findByRole('dialog', { name: 'Nueva entrada' })
    await waitFor(() => expect(routerLocation().search).toBe('?from=pwa'))
  })
  it('does not open a stale pending event after the router removes its query', () => {
    mocks.loading = true
    const view = show('/calendar?quick=event')
    fireEvent.click(screen.getByRole('button', { name: 'Quitar acceso' }))
    mocks.loading = false
    view.rerender(<TestRouter entry='/calendar?quick=event' />)
    expect(routerLocation().search).toBe('?view=list')
    expect(screen.queryByRole('dialog', { name: 'Nueva entrada' })).not.toBeInTheDocument()
  })
  it('preserves the Lab route when the real Calendar is embedded there', async () => {
    show({ pathname: '/lab', search: '?quick=event&experiment=1', hash: '#calendar', state: { lab: true } })
    await screen.findByRole('dialog', { name: 'Nueva entrada' })
    await waitFor(() => expect(routerLocation()).toMatchObject({ pathname: '/lab', search: '?experiment=1', hash: '#calendar', state: { lab: true }, navigationType: 'REPLACE' }))
  })
  it('ignores unrelated quick actions and handles an event under StrictMode', async () => {
    const view = show('/lab?quick=movement')
    expect(screen.queryByRole('dialog', { name: 'Nueva entrada' })).not.toBeInTheDocument()
    expect(routerLocation().search).toBe('?quick=movement')
    view.unmount()
    render(<StrictMode><TestRouter entry='/calendar?quick=event' /></StrictMode>)
    await screen.findByRole('dialog', { name: 'Nueva entrada' })
    await waitFor(() => expect(routerLocation().search).toBe(''))
  })
})
