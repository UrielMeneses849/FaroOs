import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultPage } from './VaultPage'
import type { VaultCredentialSummary, VaultListResponse } from '../features/vault/vaultTypes'

const native = vi.hoisted(() => ({ status: vi.fn(), list: vi.fn(), create: vi.fn(), lock: vi.fn() }))
vi.mock('../desktop/desktopBridge', () => ({
  isFaroDesktop: () => true,
  getDesktopVaultStatus: native.status, listDesktopVault: native.list,
  createDesktopVaultCredential: native.create, lockDesktopVault: native.lock,
  copyDesktopVaultPassword: vi.fn(), copyDesktopVaultUsername: vi.fn(), createDesktopVault: vi.fn(),
  deleteDesktopVaultCredential: vi.fn(), generateDesktopVaultPassword: vi.fn(), getDesktopVaultCredential: vi.fn(),
  openDesktopVaultUrl: vi.fn(), unlockDesktopVault: vi.fn(), updateDesktopVaultCredential: vi.fn(), updateDesktopVaultSettings: vi.fn(),
}))
vi.mock('../components/layout', () => ({ PageHeader: ({ trailing }: { trailing: React.ReactNode }) => <header>{trailing}</header> }))
const credential: VaultCredentialSummary = { id: 'fixture-id', serviceName: 'Servicio de prueba', username: 'fixture@example.test', url: '', favorite: false, tags: [], updatedAt: 1, passwordChangedAt: 1, strength: 'Fuerte', reusedWith: 0, passwordAgeDays: 0 }
const listing = (credentials: VaultCredentialSummary[] = []): VaultListResponse => ({ credentials, security: { credentialCount: credentials.length, reusedCount: 0, weakCount: 0, oldCount: 0 }, timeoutMinutes: 5, lockOnBlur: false })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.resetAllMocks()
  native.status.mockResolvedValue({ exists: true, locked: false, timeoutMinutes: 5, lockOnBlur: false })
  native.list.mockResolvedValue(listing())
  native.create.mockResolvedValue(credential)
  native.lock.mockResolvedValue({ exists: true, locked: true, timeoutMinutes: 5, lockOnBlur: false })
})
async function openForm() {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Nueva credencial' }))
  const dialog = screen.getByRole('dialog', { name: 'Nueva credencial' })
  fireEvent.change(within(dialog).getByLabelText('Servicio'), { target: { value: credential.serviceName } })
  fireEvent.change(within(dialog).getByLabelText('Usuario o correo'), { target: { value: credential.username } })
  fireEvent.change(within(dialog).getByLabelText('Contraseña'), { target: { value: 'synthetic-test-only' } })
  return { user, dialog }
}
describe('Vault: confirmación de guardado y actualización', () => {
  it('clears the search and displays the persisted credential and updated count', async () => {
    render(<VaultPage />)
    const { user, dialog } = await openForm()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar credenciales' }), { target: { value: 'otro servicio' } })
    native.create.mockImplementation(async () => { native.list.mockResolvedValue(listing([credential])); return credential })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cifrada' }))
    expect(await screen.findByText('Credencial guardada y verificada en FARO Vault.')).toBeVisible()
    expect(screen.getByText(credential.serviceName)).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Buscar credenciales' })).toHaveValue('')
    expect(within(screen.getByRole('region', { name: 'Resumen de seguridad de Vault' })).getByText('1')).toBeVisible()
  })
  it('does not let an older refresh erase the newly saved credential', async () => {
    render(<VaultPage />)
    const { user, dialog } = await openForm()
    const old = deferred<VaultListResponse>()
    native.list.mockReturnValueOnce(old.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    native.create.mockImplementation(async () => { native.list.mockResolvedValue(listing([credential])); return credential })
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cifrada' }))
    await screen.findByText('Credencial guardada y verificada en FARO Vault.')
    await act(async () => old.resolve(listing()))
    expect(screen.getByText(credential.serviceName)).toBeVisible()
  })
  it('keeps the form and shows a write failure without claiming success', async () => {
    native.create.mockRejectedValue(new Error('No pude guardar FARO Vault.'))
    render(<VaultPage />)
    const { user, dialog } = await openForm()
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cifrada' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No pude guardar FARO Vault.')
    expect(within(dialog).getByLabelText('Servicio')).toHaveValue(credential.serviceName)
    expect(screen.queryByText('Credencial guardada y verificada en FARO Vault.')).not.toBeInTheDocument()
  })
  it('does not report success when a returned id is missing from the persisted list', async () => {
    render(<VaultPage />)
    const { user, dialog } = await openForm()
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cifrada' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no pude verificar la credencial en la lista')
    expect(native.create).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Credencial guardada y verificada en FARO Vault.')).not.toBeInTheDocument()
  })
  it('discards a list response arriving after an explicit lock', async () => {
    render(<VaultPage />)
    await screen.findByRole('button', { name: 'Nueva credencial' })
    const old = deferred<VaultListResponse>()
    native.list.mockReturnValueOnce(old.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bloquear' }))
    await screen.findByRole('button', { name: 'Desbloquear con Touch ID' })
    await act(async () => old.resolve(listing([credential])))
    expect(screen.queryByText(credential.serviceName)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desbloquear con Touch ID' })).toBeVisible()
  })
})
