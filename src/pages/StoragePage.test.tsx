import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageFolderBrowser, StorageOverview } from '../features/storage/storageTypes'
import { StoragePage } from './StoragePage'

const native = vi.hoisted(() => ({ scan: vi.fn(), browse: vi.fn(), trash: vi.fn(), archive: vi.fn(), capacity: vi.fn() }))
vi.mock('../desktop/desktopBridge', () => ({
  isFaroDesktop: () => true,
  browseDesktopStorageFolder: native.browse,
  moveDesktopStorageToTrash: native.trash,
  getDesktopArchiveOverview: native.archive,
  getDesktopStorageCapacity: native.capacity,
}))
vi.mock('../features/storage/storageScan', () => ({ readStorageScan: native.scan }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }))
vi.mock('../components/layout', () => ({ PageHeader: () => <h1>Espacio</h1> }))

const overview: StorageOverview = {
  totalBytes: 1000, usedBytes: 800, freeBytes: 200, scannedAt: 1,
  folders: [{ id: 'downloads', name: 'Descargas', path: '/fixture', bytes: 100, fileCount: 1, scanComplete: true }],
  candidates: [], screenshots: [], apps: [], appsScanLimited: false,
  trash: { bytes: 0, fileCount: 0, scanComplete: true }, scannedEntries: 1, scanLimited: false, warnings: [],
  intelligence: { classifiedBytes: 0, unexplainedBytes: 0, manageableBytes: 0, protectedBytes: 0, recoverableBytes: 0, minimumFreeBytes: 0, bytesToOperatingMargin: 0, health: 'saludable', categories: [], accumulations: [], development: [], recoveryPlan: [] },
}
const folder: StorageFolderBrowser = {
  folderId: 'downloads', rootName: 'Descargas', path: '/fixture', scannedEntries: 1, scanComplete: true, canManage: true, canManageFolders: true,
  entries: [{ id: 'fixture-file', name: 'Ejemplo.zip', path: '/fixture/Ejemplo.zip', bytes: 100, modifiedAt: 1, ageDays: 30, kind: 'zip', isDirectory: false, canMoveToTrash: true, fileCount: 1, scanComplete: true }],
}
beforeEach(() => {
  vi.clearAllMocks()
  native.scan.mockResolvedValue(overview)
  native.browse.mockResolvedValue(folder)
  native.archive.mockResolvedValue(undefined)
  native.capacity.mockResolvedValue(undefined)
  native.trash.mockResolvedValue({ movedCount: 1, reclaimedBytes: 100, failed: [], warnings: [] })
})

describe('Espacio: explorador y análisis', () => {
  it('confirma desde el explorador y recupera el scroll después del movimiento simulado', async () => {
    const user = userEvent.setup()
    render(<StoragePage />)
    await user.click(await screen.findByRole('button', { name: /Descargas/ }))
    const browser = await screen.findByRole('dialog', { name: 'Explorar Descargas' })
    await user.click(within(browser).getByRole('button', { name: 'Papelera' }))
    const confirm = screen.getByRole('dialog', { name: /¿Mover 1 elemento/ })
    expect(Number(confirm.parentElement!.style.zIndex)).toBeGreaterThan(Number(browser.parentElement!.style.zIndex))
    await user.click(within(confirm).getByRole('button', { name: 'Mover a Papelera' }))
    await waitFor(() => expect(native.trash).toHaveBeenCalledExactlyOnceWith(['fixture-file']))
    await waitFor(() => expect(document.body.style.overflow).toBe(''))
    expect(native.scan).toHaveBeenLastCalledWith(true)
  })

  it('volver de Finder no reanaliza el disco ni cierra el explorador', async () => {
    const user = userEvent.setup()
    render(<StoragePage />)
    await user.click(await screen.findByRole('button', { name: /Descargas/ }))
    await screen.findByRole('dialog', { name: 'Explorar Descargas' })
    fireEvent.blur(window)
    fireEvent.focus(window)
    await waitFor(() => expect(native.capacity).toHaveBeenCalledOnce())
    expect(native.scan).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Explorar Descargas' })).toBeInTheDocument()
  })

  it('cerrar una carpeta en carga impide que su respuesta tardía reabra el modal', async () => {
    const user = userEvent.setup()
    let resolve!: (value: StorageFolderBrowser) => void
    native.browse.mockReturnValue(new Promise<StorageFolderBrowser>((done) => { resolve = done }))
    render(<StoragePage />)
    await user.click(await screen.findByRole('button', { name: /Descargas/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Abriendo carpeta' })
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar modal' }))
    await act(async () => resolve(folder))
    expect(screen.queryByRole('dialog', { name: 'Explorar Descargas' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })
})
