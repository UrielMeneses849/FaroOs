import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FinanceCategoryManager, FundEntryEditor, ReservedContributionEditor } from './FinanceRecordDialogs'

const entry = { id: 'entry', fundId: 'fund', amountCents: 50000, entryDate: '2026-10-20', description: 'Reserva', createdAt: '' }
describe('Finance record editing', () => {
  it('updates a fund entry with the same identity and keeps its sign', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<FundEntryEditor initial={{ ...entry, amountCents: -50000 }} fundId="fund" balanceCents={100000} onClose={() => {}} onSave={save} />)
    fireEvent.change(screen.getByLabelText('Importe MXN'), { target: { value: '250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar movimiento' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry', fundId: 'fund', amountCents: -25000 })))
  })
  it('blocks edits that would spend a fund contribution already withdrawn', () => {
    const save = vi.fn()
    render(<FundEntryEditor initial={entry} fundId="fund" balanceCents={10000} onClose={() => {}} onSave={save} />)
    fireEvent.change(screen.getByLabelText('Importe MXN'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar movimiento' }))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('saldo suficiente')
  })
  it('keeps a reserved contribution attached to its goal when edited', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<ReservedContributionEditor initial={{ id: 'contribution', goalId: 'goal', amountCents: 10000, contributionDate: '2026-10-20', createdAt: '' }} goalName="Viaje" onClose={() => {}} onSave={save} />)
    fireEvent.change(screen.getByLabelText('Importe MXN'), { target: { value: '175' } })
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar aportación' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'contribution', goalId: 'goal', amountCents: 17500 })))
  })
  it('requires confirmation for a personal category and exposes no system delete', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    render(<FinanceCategoryManager categories={[{ id: 'system', name: 'Plan', type: 'expense', isDefault: true, isActive: true }, { id: 'personal', name: 'Viajes', type: 'expense', isDefault: false, isActive: true }]} onClose={() => {}} onSave={vi.fn()} onDelete={remove} />)
    expect(within(screen.getByText('Plan').closest('article')!).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(within(screen.getByText('Viajes').closest('article')!).getByRole('button', { name: 'Eliminar' }))
    const confirmation = within(screen.getByRole('dialog', { name: 'Eliminar categoría' }))
    fireEvent.click(confirmation.getByRole('button', { name: 'Cancelar' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByText('Viajes').closest('article')!).getByRole('button', { name: 'Eliminar' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Eliminar categoría' })).getByRole('button', { name: 'Eliminar categoría' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'personal' })))
  })
})
