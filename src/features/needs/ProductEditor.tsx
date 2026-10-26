import { useState, type FormEvent } from 'react'
import { Button, Modal } from '../../components/common'
import { departments, productSchema, type Product } from './household'

export function ProductEditor({ product, busy, onClose, onSave, onDelete }: { product: Product; busy: boolean; onClose: () => void; onSave: (p: Product) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [draft, setDraft] = useState(product)
  const [price, setPrice] = useState(product.priceCents === undefined ? '' : String(product.priceCents / 100))
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const patch = (value: Partial<Product>) => setDraft(p => ({ ...p, ...value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    const result = productSchema.safeParse({ ...draft, priceCents: price === '' ? undefined : Math.round(Number(price) * 100) })
    if (!result.success) { setError('Revisa el nombre, las unidades y las cantidades. No pueden ser negativas.'); return }
    try { await onSave(result.data); onClose() } catch { setError('No se guardó. Revisa el aviso e intenta de nuevo.') }
  }
  return <Modal open title={product.name ? 'Editar producto' : 'Añadir producto'} onClose={() => { if (!busy) onClose() }}>
    <form className="household-form" onSubmit={event => void submit(event)}>
      <fieldset disabled={busy}>
        <label>Nombre<input required maxLength={120} value={draft.name} onChange={e => patch({ name: e.target.value })} /></label>
        <div className="household-form-grid">
          <label>Categoría<select value={draft.department} onChange={e => patch({ department: e.target.value as Product['department'] })}>{Object.entries(departments).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Destino<select value={draft.kind} onChange={e => patch({ kind: e.target.value as Product['kind'] })}><option value="stock">En casa / compra semanal</option><option value="wish">Después</option></select></label>
        </div>
        <label className="household-check"><input type="checkbox" checked={draft.treat} onChange={e => patch({ treat: e.target.checked })} />Es un gusto</label>
        <label>Control de inventario<select value={draft.mode} onChange={e => patch({ mode: e.target.value as Product['mode'] })}><option value="quantity">Por cantidad</option><option value="status">Tengo / queda poco / se acabó</option></select></label>
        {draft.mode === 'quantity' ? <div className="household-form-grid">
          <label>Existencias<input type="number" min="0" step="any" required value={draft.stock} onChange={e => patch({ stock: Number(e.target.value) })} /></label>
          <label>Cantidad objetivo<input type="number" min="0" step="any" required value={draft.target} onChange={e => patch({ target: Number(e.target.value) })} /></label>
          <label>Unidad de inventario<input required maxLength={30} value={draft.unit} onChange={e => patch({ unit: e.target.value })} placeholder="kg, L, pza…" /></label>
        </div> : <label>Existencias<select value={draft.status} onChange={e => patch({ status: e.target.value as Product['status'] })}><option value="available">Tengo</option><option value="low">Queda poco</option><option value="empty">Se acabó</option></select></label>}
        <div className="household-form-grid">
          <label>Unidad de compra<input required maxLength={30} value={draft.purchaseUnit} onChange={e => patch({ purchaseUnit: e.target.value })} placeholder="kg, paquete, botella…" /></label>
          <label>Precio por unidad de compra (MXN)<input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Sin precio" /></label>
          {draft.mode === 'quantity' && <label>Contenido de cada unidad ({draft.unit})<input type="number" required min="0.000001" step="any" value={draft.packSize} onChange={e => patch({ packSize: Number(e.target.value) })} /></label>}
          <label>Incremento al comprar<input type="number" required min="0.000001" step="any" value={draft.step} onChange={e => patch({ step: Number(e.target.value) })} /></label>
        </div>
        <p>Ejemplo: un paquete de huevo contiene 30 piezas. Para kg a granel usa contenido 1 e incremento 0.1; para paquetes completos, incremento 1.</p>
        <label className="household-check"><input type="checkbox" checked={draft.weekly} onChange={e => patch({ weekly: e.target.checked })} />Comprar cada sábado aunque quede</label>
        <label>{draft.weekly ? 'Cantidad semanal' : 'Cantidad a reponer si usas estados'} ({draft.purchaseUnit})<input required type="number" min="0" step="any" value={draft.weeklyQuantity} onChange={e => patch({ weeklyQuantity: Number(e.target.value) })} /></label>
        <label>Notas<textarea maxLength={2000} value={draft.notes} onChange={e => patch({ notes: e.target.value })} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="household-actions"><Button type="submit" loading={busy}>Guardar producto</Button><Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button></div>
        {onDelete && (!deleting ? <Button type="button" variant="ghost" onClick={() => setDeleting(true)}>Eliminar producto…</Button> : <div><p>Se quitará del inventario y la lista. Las compras anteriores se conservan.</p><Button type="button" variant="danger" onClick={() => void onDelete().then(onClose).catch(() => setError('No se pudo eliminar.'))}>Confirmar eliminación</Button></div>)}
      </fieldset>
    </form>
  </Modal>
}
