import { useEffect, useState } from 'react'
import { CalendarDays, Home, Bookmark, ShoppingCart, ChevronRight, Plus, Check, Package, SlidersHorizontal, Heart, Utensils, Droplets, Cat, Sparkles, User, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button, Modal } from '../components/common'
import { useHousehold } from '../hooks/useHousehold'
import { blankProduct, closePurchase, consume, departments, pesos, shoppingSaturday, starterProducts, suggestedQuantity, type Product, type PurchaseLine } from '../features/needs/household'
import { ProductEditor } from '../features/needs/ProductEditor'
import '../features/needs/household.css'

type Tab = 'week' | 'stock' | 'later'
type CartLine = { id: string; quantity: string; price: string; checked: boolean }
const categoryIcons = { food: Utensils, care: Droplets, home: Home, pet: Cat, personal: User, life: Sparkles, other: Package }
function productImage(name: string) {
  const normalized = name.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const asset = /arroz/.test(normalized) ? 'rice' : /huevo/.test(normalized) ? 'eggs' : /shampoo|champu/.test(normalized) ? 'shampoo' : /desodorante/.test(normalized) ? 'deodorant' : undefined
  return asset ? `${import.meta.env.BASE_URL}needs/${asset}.jpg` : undefined
}

export function NeedsPage() {
  const { state, loading, saving, readOnly, error, reload, change } = useHousehold()
  const [tab, setTab] = useState<Tab>('week')
  const [department, setDepartment] = useState('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product>()
  const [week, setWeek] = useState(() => shoppingSaturday())
  const [cart, setCart] = useState<CartLine[]>()
  const [cartWeek, setCartWeek] = useState(week)
  const [purchaseId, setPurchaseId] = useState('')
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')
  const [using, setUsing] = useState<Product>()
  const [used, setUsed] = useState('')
  const [feedback, setFeedback] = useState('')
  const [history, setHistory] = useState(false)
  const [showStarter, setShowStarter] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setWeek(shoppingSaturday()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const locked = saving || readOnly || loading
  const run = async (task: () => Promise<void>, message?: string) => {
    try { await task(); if (message) setFeedback(message) } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo guardar.') }
  }
  const updateProduct = (p: Product) => change(s => ({ ...s, products: s.products.some(item => item.id === p.id) ? s.products.map(item => item.id === p.id ? p : item) : [...s.products, p] }))
  const shopping = state.products.filter(p => suggestedQuantity(p, week) > 0)
  const estimate = shopping.reduce((sum, p) => sum + Math.round(suggestedQuantity(p, week) * (p.priceCents ?? 0)), 0)
  const missingPrices = shopping.filter(p => p.priceCents === undefined).length
  const spent = state.purchases.filter(p => p.week === week).reduce((sum, p) => sum + p.totalCents, 0)
  const budget = state.budgets[week] ?? state.budgetCents
  const remaining = budget === null ? null : budget - spent - estimate
  const progress = budget ? Math.min(100, (spent + estimate) / budget * 100) : budget === 0 && spent + estimate > 0 ? 100 : 0
  const titleDate = format(parseISO(week), "EEEE d MMM", { locale: es })
  const visible = state.products.filter(p => (tab === 'later' ? p.kind === 'wish' : p.kind === 'stock') && (department === 'all' || p.department === department) && p.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))
  const openCart = () => {
    setCart(shopping.map(p => ({ id: p.id, quantity: String(suggestedQuantity(p, week)), price: p.priceCents === undefined ? '' : String(p.priceCents / 100), checked: true })))
    setCartWeek(week); setPurchaseId(crypto.randomUUID()); setFeedback('')
  }
  const cartPatch = (id: string, patch: Partial<CartLine>) => setCart(lines => lines?.map(l => l.id === id ? { ...l, ...patch } : l))
  const cartTotal = (cart ?? []).filter(l => l.checked).reduce((sum, l) => sum + Math.round(Number(l.quantity) * Number(l.price) * 100), 0)
  const cartValid = !!cart?.some(l => l.checked) && cart.filter(l => l.checked).every(l => l.quantity.trim() !== '' && Number.isFinite(Number(l.quantity)) && Number(l.quantity) > 0 && l.price.trim() !== '' && Number.isFinite(Number(l.price)) && Number(l.price) >= 0)
  const checkout = async () => {
    if (!cartValid || !cart || cartWeek !== shoppingSaturday()) { setFeedback('Revisa cantidades, precios y la fecha de la compra.'); return }
    const lines: PurchaseLine[] = cart.filter(l => l.checked).map(l => {
      const p = state.products.find(p => p.id === l.id)!
      return { id: p.id, name: p.name, department: p.department, treat: p.treat, quantity: Number(l.quantity), unit: p.purchaseUnit, priceCents: Math.round(Number(l.price) * 100) }
    })
    await change(s => closePurchase(s, lines, cartWeek, purchaseId))
    setCart(undefined); setFeedback('Compra guardada. Las existencias y el gasto de la semana ya están actualizados.')
  }
  const savePlan = async () => {
    if (!cart || cartWeek !== shoppingSaturday()) throw new Error('La semana cambió; vuelve a abrir la lista.')
    if (cart.some(l => l.quantity.trim() === '' || !Number.isFinite(Number(l.quantity)) || Number(l.quantity) < 0 || (l.price !== '' && (!Number.isFinite(Number(l.price)) || Number(l.price) < 0)))) throw new Error('Revisa cantidades y precios; no pueden ser negativos.')
    await change(s => ({ ...s, products: s.products.map(p => {
      const line = cart.find(l => l.id === p.id)
      return line ? { ...p, priceCents: line.price === '' ? undefined : Math.round(Number(line.price) * 100), plannedWeek: cartWeek, plannedQuantity: line.checked ? Number(line.quantity) : 0 } : p
    }) }))
    setCart(undefined); setFeedback('Lista guardada. El inventario todavía no cambia.')
  }
  return <main className="household-page">
    <header className="household-header"><div><span className="household-eyebrow">TU CASA, EN ORDEN</span><h1>Necesidades</h1></div><Button variant="ghost" disabled={locked} aria-label="Añadir producto" icon={<Plus size={20} />} onClick={() => setEditing({ ...blankProduct(), kind: tab === 'later' ? 'wish' : 'stock' })}>Añadir</Button></header>
    <nav className="household-tabs" aria-label="Vistas de necesidades">{([{ id: 'week', label: 'Semana', icon: CalendarDays }, { id: 'stock', label: 'En casa', icon: Home }, { id: 'later', label: 'Después', icon: Bookmark }] as const).map(({ id, label, icon: Icon }) => <button type="button" key={id} aria-current={tab === id ? 'page' : undefined} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setDepartment('all'); setSearch('') }}><Icon size={20} />{label}</button>)}</nav>
    {error && <div className="household-notice" role="alert"><p>{error}</p><Button variant="secondary" disabled={saving || loading} onClick={() => void reload()}>Reintentar</Button></div>}
    {feedback && <div className="household-feedback" role="status"><span>{feedback}</span><button aria-label="Cerrar aviso" onClick={() => setFeedback('')}>Cerrar</button></div>}
    {loading ? <p className="household-loading" role="status">Cargando tu casa…</p> : <>
      {tab === 'week' && <div className="household-week">
        <section className="household-week-main">
          <div className="household-heading"><h2>El sábado, resuelto.</h2><p>Próxima compra · <time dateTime={week}>{titleDate}</time></p></div>
          <section className="household-budget" aria-label="Presupuesto semanal">
            <strong>{pesos(estimate)}<span> {missingPrices ? 'estimado parcial' : 'estimado'}</span></strong>
            <p>{budget === null ? 'Define tu presupuesto semanal' : `Presupuesto ${pesos(budget)}`} <button type="button" aria-label="Editar presupuesto" disabled={locked} onClick={() => { setBudgetInput(budget === null ? '' : String(budget / 100)); setBudgetOpen(true) }}><Pencil size={16} /></button></p>
            {budget !== null && <><progress aria-label="Presupuesto comprometido" max="100" value={progress} /><p className={remaining !== null && remaining < 0 ? 'household-over' : 'household-available'}>{remaining !== null && remaining < 0 ? `Excede por ${pesos(-remaining)}` : `Disponibles ${pesos(remaining ?? 0)}`}</p></>}
            <small>Ya comprado: {pesos(spent)} · Por comprar: {pesos(estimate)}</small>
            {missingPrices > 0 && <p className="household-warning">Falta precio en {missingPrices} {missingPrices === 1 ? 'producto' : 'productos'}. El total está incompleto.</p>}
          </section>
          <div className="household-primary"><Button disabled={locked || !shopping.length} icon={<ShoppingCart size={19} />} onClick={openCart}>Revisar lista del sábado</Button><Button variant="secondary" onClick={() => setTab('stock')}>Abrir inventario</Button></div>
          <section className="household-summary"><h3>Esto hace falta <small>{shopping.length} {shopping.length === 1 ? 'producto' : 'productos'}</small></h3>
            {shopping.length === 0 ? <p>{state.products.length ? 'Todo cubierto por ahora. Revisa tus existencias antes de salir.' : 'Empecemos por tus básicos. Añade tus productos o prepara la lista inicial.'}</p> : <>
              {([...Object.keys(departments), 'treats'] as const).map(id => {
                const items = shopping.filter(p => id === 'treats' ? p.treat : !p.treat && p.department === id)
                if (!items.length) return null
                const Icon = id === 'treats' ? Heart : categoryIcons[id as Product['department']]
                const total = items.reduce((sum, p) => sum + Math.round(suggestedQuantity(p, week) * (p.priceCents ?? 0)), 0)
                return <button type="button" className="household-summary-row" key={id} disabled={locked} onClick={openCart}><span className="household-icon"><Icon size={25} /></span><span><b>{id === 'treats' ? 'Gustos' : departments[id as Product['department']]}</b><small>{items.length} {items.length === 1 ? 'producto' : 'productos'} · {pesos(total)}{items.some(p => p.priceCents === undefined) ? ' + sin precio' : ''}</small></span><ChevronRight size={20} /></button>
              })}
            </>}
          </section>
        </section>
        <aside className="household-week-aside"><h3>Antes de salir</h3><div className="household-tip"><Check size={25} /><div><b>Revisa lo que queda en casa</b><p>Compra lo que falta para tu objetivo. Los básicos marcados como semanales se incluyen cada sábado.</p></div></div><p>El resumen se actualiza con tus existencias. El viernes y el sábado úsalo como reporte de reposición.</p><Button variant="ghost" disabled={locked} onClick={() => setShowStarter(true)}>Preparar mis básicos</Button><Button variant="ghost" onClick={() => setHistory(true)}>Ver compras anteriores</Button><small>Presupuesto e historial propios de Necesidades. Comprar aquí no registra movimientos en Finanzas.</small></aside>
      </div>}
      {tab !== 'week' && <section className="household-stock">
        <div className="household-heading"><h2>{tab === 'stock' ? 'Lo que tenemos' : 'Para después'}</h2><p>{tab === 'stock' ? 'Actualiza sólo lo que cambió.' : 'Necesidades personales y cosas que harían la vida más cómoda.'}</p></div>
        <div className="household-filters"><label><span className="sr-only">Buscar producto</span><input placeholder="Buscar producto…" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span className="sr-only">Categoría</span><select value={department} onChange={e => setDepartment(e.target.value)}><option value="all">Todas las categorías</option>{Object.entries(departments).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
        <div className="household-stock-list">{visible.length ? visible.map(p => {
          const Icon = categoryIcons[p.department]
          const thumbnail = productImage(p.name)
          const needed = suggestedQuantity(p, week)
          return <article key={p.id} className="household-stock-row">{thumbnail ? <img className="household-thumbnail" src={thumbnail} alt="" width="58" height="58" loading="lazy" /> : <span className="household-icon"><Icon size={24} /></span>}<div className="household-product"><div className="household-product-title"><h3>{p.name}</h3>{p.treat && <span className="household-treat">Gusto</span>}</div>{tab === 'later' && <small>{departments[p.department]}</small>}
            {tab === 'stock' && (p.mode === 'quantity' ? <><p>{p.stock} {p.unit} disponibles · Meta {p.target} {p.unit}</p>{needed > 0 && <span className="household-low">Reponer {needed} {p.purchaseUnit}</span>}</> : <div className="household-status" role="group" aria-label={`Existencias de ${p.name}`}>{([{ value: 'available', label: 'Tengo' }, { value: 'low', label: 'Queda poco' }, { value: 'empty', label: 'Se acabó' }] as const).map(status => <button type="button" key={status.value} aria-pressed={p.status === status.value} className={p.status === status.value ? `selected ${status.value}` : ''} disabled={locked} onClick={() => void run(() => updateProduct({ ...p, status: status.value }))}>{status.label}</button>)}</div>)}
            {tab === 'later' && <><p>{p.priceCents === undefined ? 'Sin precio todavía' : `${pesos(p.priceCents)} / ${p.purchaseUnit}`}</p>{p.notes && <p className="household-note">{p.notes}</p>}<Button variant="secondary" size="sm" disabled={locked} onClick={() => void run(() => updateProduct({ ...p, kind: 'stock', plannedWeek: week, plannedQuantity: 1 }), 'Añadido a la lista del sábado.')}>Pasar a esta semana</Button></>}
          </div><div className="household-row-actions">{p.mode === 'quantity' && tab === 'stock' && <Button variant="secondary" size="sm" disabled={locked || p.stock <= 0} onClick={() => { setUsing(p); setUsed('') }}>Usé…</Button>}<button type="button" aria-label={`Editar ${p.name}`} disabled={locked} onClick={() => setEditing(p)}><SlidersHorizontal size={18} /></button></div></article>
        }) : <div className="household-empty"><Package size={32} /><h3>{search || department !== 'all' ? 'No hay coincidencias' : tab === 'later' ? 'Dale espacio a lo que viene' : 'Tu inventario empieza aquí'}</h3><p>{search || department !== 'all' ? 'Prueba otro nombre o categoría.' : 'Añade productos con cantidades o estados, como te resulte más cómodo.'}</p></div>}</div>
        <div className="household-primary">{tab === 'stock' && <Button disabled={locked || !shopping.length} icon={<ShoppingCart size={18} />} onClick={openCart}>Registrar compra</Button>}<Button disabled={locked} variant={tab === 'stock' ? 'secondary' : 'primary'} icon={<Plus size={18} />} onClick={() => setEditing({ ...blankProduct(), kind: tab === 'later' ? 'wish' : 'stock' })}>Añadir producto</Button></div>
        {tab === 'stock' && <p className="household-footnote">Lo que falta se propone para el sábado. Cambia cantidades y existencias desde Editar.</p>}
      </section>}
    </>}
    {editing && <ProductEditor key={editing.id} product={editing} busy={saving} onClose={() => setEditing(undefined)} onSave={updateProduct} onDelete={state.products.some(p => p.id === editing.id) ? () => change(s => ({ ...s, products: s.products.filter(p => p.id !== editing.id) })) : undefined} />}
    <Modal open={budgetOpen} title="Presupuesto de Necesidades" onClose={() => { if (!saving) setBudgetOpen(false) }}><form className="household-form" onSubmit={e => { e.preventDefault(); void run(async () => {
      if (!budgetInput.trim() || !Number.isFinite(Number(budgetInput)) || Number(budgetInput) < 0) throw new Error('Indica un presupuesto válido.')
      const cents = Math.round(Number(budgetInput) * 100)
      await change(s => ({ ...s, budgetCents: cents, budgets: { ...s.budgets, [week]: cents } })); setBudgetOpen(false)
    }, 'Presupuesto actualizado.') }}><label>Presupuesto semanal (MXN)<input required type="number" min="0" step="0.01" value={budgetInput} onChange={e => setBudgetInput(e.target.value)} /></label><p>Se usará esta semana y como presupuesto inicial de las siguientes. Las compras anteriores conservan su historial. No modifica Finanzas.</p><Button loading={saving} type="submit">Guardar presupuesto</Button></form></Modal>
    <Modal open={!!using} title={using ? `Registrar uso · ${using.name}` : 'Registrar uso'} onClose={() => { if (!saving) setUsing(undefined) }}><form className="household-form" onSubmit={e => { e.preventDefault(); if (using) void run(async () => { await change(s => ({ ...s, products: s.products.map(p => p.id === using.id ? consume(p, Number(used)) : p) })); setUsing(undefined) }, 'Consumo registrado.') }}><label>Cantidad usada ({using?.unit})<input required type="number" min="0.000001" max={using?.stock} step="any" value={used} onChange={e => setUsed(e.target.value)} /></label><p>Disponibles: {using?.stock} {using?.unit}. Sólo se descuenta del inventario.</p><Button loading={saving} type="submit">Registrar consumo</Button></form></Modal>
    <Modal open={!!cart} title="Lista del sábado" onClose={() => { if (!saving) setCart(undefined) }} panelClassName="household-cart-modal"><div className="household-form household-cart"><p>Compra para el {format(parseISO(cartWeek), 'd MMM', { locale: es })}. Ajusta cantidades y precio por unidad. Al cerrar se suman únicamente los productos marcados.</p><fieldset disabled={locked}>{cart?.map(line => { const p = state.products.find(p => p.id === line.id); if (!p) return null; return <div className="household-cart-row" key={p.id}><label className="household-check"><input type="checkbox" aria-label={`Comprar ${p.name}`} checked={line.checked} onChange={e => cartPatch(p.id, { checked: e.target.checked })} /><b>{p.name}</b>{p.treat && <span className="household-treat">Gusto</span>}</label><div className="household-form-grid"><label>Cantidad ({p.purchaseUnit})<input aria-label={`Cantidad de ${p.name}`} type="number" min="0" step="any" value={line.quantity} onChange={e => cartPatch(p.id, { quantity: e.target.value })} /></label><label>Precio / {p.purchaseUnit} (MXN)<input aria-label={`Precio de ${p.name}`} type="number" min="0" step="0.01" placeholder="Sin precio" value={line.price} onChange={e => cartPatch(p.id, { price: e.target.value })} /></label></div><small>{p.mode === 'quantity' ? `En casa: ${p.stock} ${p.unit} · Cada ${p.purchaseUnit}: ${p.packSize} ${p.unit}` : departments[p.department]}</small><span className="household-line-total">{line.price.trim() === '' ? 'Precio pendiente' : pesos(Math.round(Number(line.quantity) * Number(line.price) * 100))}</span></div> })}</fieldset><div className="household-cart-footer"><strong>Total seleccionado: {pesos(Number.isFinite(cartTotal) ? cartTotal : 0)}</strong>{!cartValid && <p>Para cerrar, marca al menos un producto y completa su cantidad y precio. Puedes guardar la lista con precios pendientes.</p>}<Button loading={saving} disabled={locked || !cartValid || cartWeek !== week} onClick={() => void run(checkout)}>Cerrar compra y sumar al inventario</Button><Button variant="secondary" disabled={locked} onClick={() => void run(savePlan)}>Guardar lista sin comprar</Button></div></div></Modal>
    <Modal open={showStarter} title="Preparar tus básicos" onClose={() => { if (!saving) setShowStarter(false) }}><div className="household-form"><p>Arroz, pechuga, muslos, res, carne molida, frijoles, atún, aceite, huevo, aguacate, cebolla, ajo y pimiento morrón.</p><p>Se añaden sin precios y con existencias en cero. Revisa las cantidades objetivo antes de comprar. No se duplican nombres existentes.</p><Button disabled={locked} loading={saving} onClick={() => void run(async () => { await change(s => ({ ...s, products: [...s.products, ...starterProducts().filter(p => !s.products.some(existing => existing.name.trim().toLocaleLowerCase('es') === p.name.toLocaleLowerCase('es')))] })); setShowStarter(false); setTab('stock') }, 'Básicos preparados. Ajusta lo que ya tienes en casa.')}>Añadir básicos para revisar</Button></div></Modal>
    <Modal open={history} title="Compras anteriores" onClose={() => setHistory(false)}><div className="household-history">{state.purchases.length ? state.purchases.map(purchase => <details key={purchase.id}><summary><time>{format(parseISO(purchase.at), 'd MMM yyyy · HH:mm', { locale: es })}</time><strong>{pesos(purchase.totalCents)}</strong></summary><p>Semana del sábado {format(parseISO(purchase.week), 'd MMM', { locale: es })} · Comida: {pesos(purchase.lines.filter(l => l.department === 'food' && !l.treat).reduce((sum, l) => sum + Math.round(l.quantity * l.priceCents), 0))} · Gustos: {pesos(purchase.lines.filter(l => l.treat).reduce((sum, l) => sum + Math.round(l.quantity * l.priceCents), 0))}</p>{purchase.lines.map(line => <p key={line.id}>{line.name} · {line.quantity} {line.unit} · {pesos(Math.round(line.quantity * line.priceCents))}</p>)}</details>) : <p>Todavía no hay compras cerradas.</p>}</div></Modal>
  </main>
}
