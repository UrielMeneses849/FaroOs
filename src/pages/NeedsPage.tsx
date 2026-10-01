import {
  BellRing, Cat, Check, ChevronDown, CircleCheck, CirclePlus, ClipboardList,
  FileText, FolderCog, Home, Leaf, PackagePlus, Pencil, Pill, Plus, ShoppingBag,
  RefreshCw, ShoppingCart, Trash2, Undo2, UtensilsCrossed,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { useNeeds } from '../hooks/useNeeds'
import {
  needFrequencyLabels, needPriorityLabels, needShoppingGroupLabels, needTiming, needTimingLabel,
  learnedPriceCents, normalizeNeedName,
  type NeedCategory, type NeedFrequency, type NeedItem, type NeedPriceReceiptDraft, type NeedPriority, type NeedShoppingGroup, type NeedsCategory,
} from '../features/needs/needsTypes'
import { parseSupermarketReceipt } from '../features/needs/receiptParser'
import '../features/needs/needs.css'

type GroupFilter = 'all' | NeedShoppingGroup

const shoppingGroups: NeedShoppingGroup[] = ['supermarket', 'pharmacy', 'cat', 'home', 'other']

const shoppingGroupIcons: Record<NeedShoppingGroup, ReactNode> = {
  supermarket: <ShoppingCart size={18} />, pharmacy: <Pill size={18} />, cat: <Cat size={18} />,
  home: <Home size={18} />, other: <PackagePlus size={18} />,
}

const categoryForGroup: Record<NeedShoppingGroup, NeedCategory> = {
  supermarket: 'home', pharmacy: 'personal', cat: 'cat', home: 'home', other: 'other',
}

type Meal = { id: string; name: string; detail: string; ingredients: Array<[string, string]> }

// Cada columna es una alternativa para el mismo hueco del plan. Así se puede
// cambiar una comida sin alterar el resto de la semana.
const mealOptions: Meal[][] = [
  [
    { id: 'pollo-brocoli', name: 'Bowl de pollo y brócoli', detail: 'Pollo a la plancha, arroz integral y brócoli.', ingredients: [['Pechuga de pollo', '1 kg'], ['Arroz integral', '1 bolsa'], ['Brócoli', '2 cabezas']] },
    { id: 'pollo-garbanzos', name: 'Ensalada de pollo y garbanzos', detail: 'Pollo, garbanzos, hojas verdes, pepino y limón.', ingredients: [['Pechuga de pollo', '1 kg'], ['Garbanzos', '2 latas'], ['Espinaca', '1 bolsa'], ['Pepino', '2 piezas'], ['Limón', '1 kg']] },
  ],
  [
    { id: 'tacos-atun', name: 'Tacos de atún fresco', detail: 'Atún, tortilla de maíz, aguacate, col y pico de gallo.', ingredients: [['Atún en agua', '4 latas'], ['Tortillas de maíz', '1 paquete'], ['Aguacate', '4 piezas'], ['Col morada o blanca', '1 pieza'], ['Jitomate', '1 kg'], ['Limón', '1 kg']] },
    { id: 'tostadas-frijol', name: 'Tostadas de frijol y aguacate', detail: 'Frijoles, tostadas horneadas, aguacate, col y jitomate.', ingredients: [['Frijoles cocidos', '2 latas'], ['Tostadas horneadas', '1 paquete'], ['Aguacate', '4 piezas'], ['Col morada o blanca', '1 pieza'], ['Jitomate', '1 kg']] },
  ],
  [
    { id: 'lentejas', name: 'Ensalada tibia de lentejas', detail: 'Lentejas, pepino, jitomate, espinaca y limón.', ingredients: [['Lentejas', '500 g'], ['Pepino', '2 piezas'], ['Jitomate', '1 kg'], ['Espinaca', '1 bolsa'], ['Limón', '1 kg']] },
    { id: 'quinoa', name: 'Ensalada de quinoa y verduras', detail: 'Quinoa, pepino, jitomate, espinaca y aguacate.', ingredients: [['Quinoa', '500 g'], ['Pepino', '2 piezas'], ['Jitomate', '1 kg'], ['Espinaca', '1 bolsa'], ['Aguacate', '4 piezas']] },
  ],
  [
    { id: 'omelette', name: 'Omelette verde', detail: 'Huevo, espinaca, champiñones y pan integral.', ingredients: [['Huevos', '1 docena'], ['Espinaca', '1 bolsa'], ['Champiñones', '1 paquete'], ['Pan integral', '1 paquete']] },
    { id: 'nopales', name: 'Huevos con nopales', detail: 'Huevo, nopales, jitomate y aguacate.', ingredients: [['Huevos', '1 docena'], ['Nopales', '1 bolsa'], ['Jitomate', '1 kg'], ['Aguacate', '4 piezas']] },
  ],
  [
    { id: 'salmon', name: 'Salmón con verduras al horno', detail: 'Salmón, calabacita, pimiento y camote.', ingredients: [['Salmón', '2 filetes'], ['Calabacita', '4 piezas'], ['Pimiento morrón', '3 piezas'], ['Camote', '3 piezas']] },
    { id: 'pescado', name: 'Pescado blanco con verduras', detail: 'Pescado blanco, brócoli, calabacita y limón.', ingredients: [['Pescado blanco', '2 filetes'], ['Brócoli', '2 cabezas'], ['Calabacita', '4 piezas'], ['Limón', '1 kg']] },
  ],
  [
    { id: 'garbanzos', name: 'Tazón de garbanzos', detail: 'Garbanzos, hojas verdes, jitomate y aguacate.', ingredients: [['Garbanzos', '2 latas'], ['Espinaca', '1 bolsa'], ['Jitomate', '1 kg'], ['Aguacate', '4 piezas']] },
    { id: 'frijoles', name: 'Bowl de frijoles y arroz', detail: 'Frijoles, arroz integral, pimiento y aguacate.', ingredients: [['Frijoles cocidos', '2 latas'], ['Arroz integral', '1 bolsa'], ['Pimiento morrón', '3 piezas'], ['Aguacate', '4 piezas']] },
  ],
  [
    { id: 'tofu', name: 'Salteado de tofu', detail: 'Tofu, zanahoria, brócoli y arroz integral.', ingredients: [['Tofu natural', '2 bloques'], ['Zanahoria', '1 bolsa'], ['Brócoli', '2 cabezas'], ['Arroz integral', '1 bolsa']] },
    { id: 'pavo', name: 'Salteado de pavo', detail: 'Pavo, zanahoria, brócoli y arroz integral.', ingredients: [['Pavo molido', '500 g'], ['Zanahoria', '1 bolsa'], ['Brócoli', '2 cabezas'], ['Arroz integral', '1 bolsa']] },
  ],
  [
    { id: 'yogur', name: 'Yogur con avena y fruta', detail: 'Yogur griego natural, avena, fruta y nueces.', ingredients: [['Yogur griego natural', '1 bote'], ['Avena', '1 bolsa'], ['Fruta de temporada', '1 kg'], ['Nueces o semillas', '1 bolsa']] },
    { id: 'avena-nocturna', name: 'Avena nocturna con fruta', detail: 'Avena, yogur, fruta y chía preparada desde la noche.', ingredients: [['Avena', '1 bolsa'], ['Yogur griego natural', '1 bote'], ['Fruta de temporada', '1 kg'], ['Semillas de chía', '1 bolsa']] },
  ],
]

const mealPlanNote = 'Lista base · comidas ligeras'
const mealPlanSelectionKey = 'faro.needs.meal-plan.selection.v1'
const mealPlanUndoKey = 'faro.needs.meal-plan.undo.v1'

const savedJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : fallback
  } catch { return fallback }
}

const uniqueMealIngredients = (meals: Meal[]) => {
  const ingredients = new Map<string, [string, string]>()
  meals.flatMap((meal) => meal.ingredients).forEach(([name, quantity]) => {
    if (!ingredients.has(normalized(name))) ingredients.set(normalized(name), [name, quantity])
  })
  return [...ingredients.values()]
}

const money = (cents?: number) => cents == null ? undefined : new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(cents / 100)

const blankNeed = (shoppingGroup: NeedShoppingGroup = 'supermarket', isOnShoppingList = true): NeedItem => {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(), name: '', category: categoryForGroup[shoppingGroup], shoppingGroup,
    priority: 'soon', frequency: 'as_needed', isOnShoppingList, isActive: true,
    createdAt: now, updatedAt: now,
  }
}

const normalized = (value: string) => value.trim().toLocaleLowerCase('es-MX')

export function NeedsPage() {
  const { items, categories, priceObservations, loading, error, refresh, save, addToShoppingList, completeShoppingItem, remove, saveCategory, rememberReceiptPrices } = useNeeds()
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all')
  const [editing, setEditing] = useState<NeedItem>()
  const [deleting, setDeleting] = useState<NeedItem>()
  const [quickName, setQuickName] = useState('')
  const [quickGroup, setQuickGroup] = useState<NeedShoppingGroup>('supermarket')
  const [collapsedGroups, setCollapsedGroups] = useState<NeedShoppingGroup[]>([])
  const [feedback, setFeedback] = useState('')
  const [showCategories, setShowCategories] = useState(false)
  const [addingMealList, setAddingMealList] = useState(false)
  const [showReceiptImport, setShowReceiptImport] = useState(false)
  const [mealSelections, setMealSelections] = useState<Record<string, number>>(() => savedJson(mealPlanSelectionKey, {}))
  const [lastMealPlanIds, setLastMealPlanIds] = useState<string[]>(() => savedJson<string[]>(mealPlanUndoKey, []).filter((id): id is string => typeof id === 'string'))

  const visible = useMemo(() => items.filter((item) => groupFilter === 'all' || item.shoppingGroup === groupFilter), [groupFilter, items])
  const shoppingItems = visible.filter((item) => item.isOnShoppingList)
  const routines = visible.filter((item) => !item.isOnShoppingList && item.frequency !== 'one_time')
  const planned = visible.filter((item) => !item.isOnShoppingList && item.frequency === 'one_time')
  const suggestedPriceFor = (item: NeedItem) => learnedPriceCents(item.name, priceObservations)
  const estimatedPriceFor = (item: NeedItem) => item.estimatedAmountCents ?? suggestedPriceFor(item)
  const estimate = shoppingItems.reduce((sum, item) => sum + (estimatedPriceFor(item) ?? 0), 0)
  const routineCount = items.filter((item) => !item.isOnShoppingList && item.frequency !== 'one_time').length
  const selectedMeals = useMemo(() => mealOptions.map((options, index) => options[mealSelections[String(index)] ?? 0] ?? options[0]), [mealSelections])
  const hasAppliedMealPlan = items.some((item) => item.notes === mealPlanNote)
  const filteredListLabel = groupFilter === 'all' ? 'Por comprar' : `En ${needShoppingGroupLabels[groupFilter]}`

  useEffect(() => { localStorage.setItem(mealPlanSelectionKey, JSON.stringify(mealSelections)) }, [mealSelections])
  useEffect(() => { localStorage.setItem(mealPlanUndoKey, JSON.stringify(lastMealPlanIds)) }, [lastMealPlanIds])
  // Las listas creadas antes de este cambio no tenían lote local. Las asociamos
  // una vez por su marca de origen, sin tocar lo que el usuario añadió a mano.
  useEffect(() => {
    if (lastMealPlanIds.length) return
    const legacyPlanIds = items.filter((item) => item.notes === mealPlanNote).map((item) => item.id)
    if (legacyPlanIds.length) queueMicrotask(() => setLastMealPlanIds(legacyPlanIds))
  }, [items, lastMealPlanIds.length])

  const openNewRoutine = () => {
    const next = blankNeed('supermarket', false)
    setEditing({ ...next, frequency: 'monthly' })
  }

  const submitQuickAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (!quickName.trim()) return
    try {
      await save({ ...blankNeed(quickGroup), name: quickName.trim() })
      setQuickName('')
      setFeedback(`“${quickName.trim()}” ya está en tu lista de compra.`)
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo añadir a la lista.') }
  }

  const submitEditor = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing?.name.trim()) return
    try {
      await save({
        ...editing,
        category: categoryForGroup[editing.shoppingGroup],
        name: editing.name.trim(),
        notes: editing.notes?.trim() || undefined,
        quantity: editing.quantity?.trim() || undefined,
        nextNeededOn: editing.frequency === 'as_needed' ? undefined : editing.nextNeededOn,
        updatedAt: new Date().toISOString(),
      })
      setEditing(undefined)
      setFeedback('Guardado. FARO sólo lo pondrá en compra cuando tú lo necesites.')
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo guardar.') }
  }

  const buy = async (item: NeedItem) => {
    try {
      await completeShoppingItem(item)
      setFeedback(item.frequency === 'one_time'
        ? `“${item.name}” quedó resuelto.`
        : `“${item.name}” se guardó en tus rutinas para cuando vuelva a hacer falta.`)
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No pudimos actualizar el artículo.') }
  }

  const sendToShoppingList = async (item: NeedItem) => {
    try {
      await addToShoppingList(item)
      setFeedback(`“${item.name}” pasó a tu lista de compra.`)
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No pudimos añadirlo a compra.') }
  }

  const addMealIngredients = async (meals: Meal[]) => {
    let foodCategory = categories.find((category) => category.shoppingGroup === 'supermarket' && normalized(category.name) === 'comida')
    if (!foodCategory) {
      const now = new Date().toISOString()
      foodCategory = await saveCategory({ id: crypto.randomUUID(), name: 'Comida', shoppingGroup: 'supermarket', createdAt: now, updatedAt: now })
    }
    const existingNames = new Set(items.filter((item) => item.shoppingGroup === 'supermarket').map((item) => normalized(item.name)))
    const missing = uniqueMealIngredients(meals).filter(([name]) => !existingNames.has(normalized(name)))
    const saved = await Promise.all(missing.map(([name, quantity]) => save({
      ...blankNeed('supermarket'), name, quantity, categoryId: foodCategory!.id, notes: mealPlanNote,
    })))
    if (saved.length) setLastMealPlanIds(saved.map((item) => item.id))
    return saved.length
  }

  const addLightMealList = async () => {
    setAddingMealList(true)
    try {
      const added = await addMealIngredients(selectedMeals)
      setGroupFilter('supermarket')
      setFeedback(added ? `Añadí ${added} ingredientes a Supermercado, en la categoría Comida. Puedes deshacerlo con ⌘/Ctrl + Z.` : 'Tu lista ya incluye los ingredientes sugeridos.')
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No pudimos añadir la lista de comidas.') }
    finally { setAddingMealList(false) }
  }

  const changeMeal = async (slot: number) => {
    const options = mealOptions[slot]
    const nextOption = ((mealSelections[String(slot)] ?? 0) + 1) % options.length
    const nextMeal = options[nextOption]
    setMealSelections((current) => ({ ...current, [slot]: nextOption }))
    setAddingMealList(true)
    try {
      const added = await addMealIngredients([nextMeal])
      setGroupFilter('supermarket')
      setFeedback(`Ahora tienes “${nextMeal.name}”. ${added ? `Añadí ${added} ingrediente${added === 1 ? '' : 's'} nuevo${added === 1 ? '' : 's'}; ⌘/Ctrl + Z lo deshace.` : 'Sus ingredientes ya estaban en tu lista.'}`)
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No pudimos cambiar la comida.') }
    finally { setAddingMealList(false) }
  }

  const undoMealPlan = useCallback(async () => {
    const activeIds = lastMealPlanIds.filter((id) => items.some((item) => item.id === id && item.notes === mealPlanNote))
    if (!activeIds.length) return
    setAddingMealList(true)
    try {
      await Promise.all(activeIds.map((id) => remove(id)))
      setLastMealPlanIds([])
      setFeedback(`Deshice ${activeIds.length} ingrediente${activeIds.length === 1 ? '' : 's'} del último cambio. Tus artículos añadidos a mano se conservaron.`)
    } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No pudimos deshacer esa lista.') }
    finally { setAddingMealList(false) }
  }, [items, lastMealPlanIds, remove])

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!(event.metaKey || event.ctrlKey) || event.key.toLocaleLowerCase() !== 'z' || event.shiftKey || !lastMealPlanIds.length || target?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      void undoMealPlan()
    }
    window.addEventListener('keydown', handleUndo)
    return () => window.removeEventListener('keydown', handleUndo)
  }, [lastMealPlanIds.length, undoMealPlan])

  const editorCategories = categories.filter((category) => category.shoppingGroup === editing?.shoppingGroup)

  return <div className="page needs-page">
    <PageHeader
      eyebrow="RITUAL DE COMPRAS"
      title="Necesidades"
      description="Despensa y reposición para que nunca te falte lo importante."
      showDescription
      trailing={<div className="needs-page-actions"><Button variant="secondary" icon={<FileText size={15} />} onClick={() => setShowReceiptImport(true)}>Leer ticket</Button><Button variant="secondary" icon={<FolderCog size={15} />} onClick={() => setShowCategories(true)}>Categorías</Button><Button icon={<Plus size={15} />} onClick={() => setEditing(blankNeed())}>Añadir a compra</Button></div>}
    />

    <section className="needs-hero" aria-label="Resumen de tu lista">
      <span className="needs-hero__orb"><ShoppingCart size={27} /></span>
      <div><strong>Faltan <b>{shoppingItems.length}</b> cosas</strong><p>{shoppingItems.length ? filteredListLabel : groupFilter === 'all' ? 'Tu lista está al día' : `Nada pendiente en ${needShoppingGroupLabels[groupFilter]}`}</p></div>
      <div className="needs-hero__detail"><span>{routineCount} rutinas activas · {priceObservations.length} precios aprendidos</span>{estimate > 0 && <b>{money(estimate)} est.</b>}</div>
    </section>

    <section className="needs-live-list">
      <header className="needs-live-list__header">
        <div><span className="eyebrow">LISTA VIVA</span><h2>Por comprar</h2><p>Sin fechas obligatorias: agrega algo en cuanto notes que se está acabando.</p></div>
        <Button variant="secondary" size="sm" icon={<BellRing size={14} />} onClick={openNewRoutine}>Nueva rutina</Button>
      </header>

      <form className="needs-quick-add" onSubmit={submitQuickAdd}>
        <span><Plus size={22} /></span>
        <input value={quickName} onChange={(event) => setQuickName(event.target.value)} placeholder="Añadir algo que se esté acabando" aria-label="Añadir rápidamente a tu lista de compra" />
        <select value={quickGroup} onChange={(event) => setQuickGroup(event.target.value as NeedShoppingGroup)} aria-label="Lugar de compra">
          {shoppingGroups.map((group) => <option key={group} value={group}>{needShoppingGroupLabels[group]}</option>)}
        </select>
        <button type="submit" aria-label="Añadir artículo"><CirclePlus size={22} /></button>
      </form>

      <div className="needs-filter-bar" aria-label="Filtrar lista de compra">
        <button className={groupFilter === 'all' ? 'active' : ''} onClick={() => setGroupFilter('all')}>Todo</button>
        {shoppingGroups.map((group) => <button key={group} className={groupFilter === group ? 'active' : ''} onClick={() => setGroupFilter(group)}>{shoppingGroupIcons[group]}{needShoppingGroupLabels[group]}</button>)}
      </div>

      {feedback && <div className="needs-feedback" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></div>}
      {loading ? <div className="planning-skeleton">Preparando tu lista…</div>
        : error && !items.length ? <EmptyState title="No pudimos cargar tu lista" description={error} action={<Button onClick={refresh}>Reintentar</Button>} />
          : <div className="needs-list-content">
            {(groupFilter === 'all' || groupFilter === 'supermarket') && <MealPlan meals={selectedMeals} onAdd={addLightMealList} onChange={changeMeal} onUndo={undoMealPlan} undoAvailable={lastMealPlanIds.some((id) => items.some((item) => item.id === id && item.notes === mealPlanNote))} adding={addingMealList} />}
            {(groupFilter === 'all' || groupFilter === 'supermarket') && hasAppliedMealPlan && <MealIngredientGroups meals={selectedMeals} shoppingItems={items.filter((item) => item.shoppingGroup === 'supermarket' && item.isOnShoppingList)} />}
            {shoppingItems.length > 0 ? <div className="needs-shopping-groups">
              {shoppingGroups.map((group) => {
                const groupItems = shoppingItems.filter((item) => item.shoppingGroup === group)
                return groupItems.length ? <ShoppingGroup key={group} group={group} items={groupItems} categories={categories} collapsed={collapsedGroups.includes(group)} onToggle={() => setCollapsedGroups((current) => current.includes(group) ? current.filter((candidate) => candidate !== group) : [...current, group])} onBuy={buy} onEdit={setEditing} onDelete={setDeleting} suggestedPriceFor={suggestedPriceFor} /> : null
              })}
            </div> : <EmptyState title={groupFilter === 'all' ? 'Nada pendiente por comprar' : `No hay compras de ${needShoppingGroupLabels[groupFilter]}`} description="Anota algo en cuanto se esté acabando. No necesitas ponerle una fecha." action={<Button icon={<Plus size={15} />} onClick={() => setEditing(blankNeed(groupFilter === 'all' ? 'supermarket' : groupFilter))}>Añadir artículo</Button>} />}

            {(routines.length > 0 || planned.length > 0) && <section className="needs-routines">
              <header><div><span className="eyebrow">RUTINAS DE REPOSICIÓN</span><h3>Para vigilar después</h3><p>Son opcionales: sólo márcalas cuando vuelvas a necesitar algo.</p></div><Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={openNewRoutine}>Añadir</Button></header>
              <div>{routines.map((item) => <RoutineRow key={item.id} item={item} onAdd={sendToShoppingList} onEdit={setEditing} onDelete={setDeleting} />)}{planned.map((item) => <RoutineRow key={item.id} item={item} onAdd={sendToShoppingList} onEdit={setEditing} onDelete={setDeleting} />)}</div>
            </section>}
          </div>}
    </section>

    {shoppingItems.length > 0 && <aside className="needs-shopping-footer"><ShoppingBag size={18} /><span>{groupFilter === 'all' ? 'En la tienda' : needShoppingGroupLabels[groupFilter]}: <b>{shoppingItems.length} {shoppingItems.length === 1 ? 'artículo' : 'artículos'}</b>{estimate > 0 && <> · {money(estimate)} est.</>}</span><ClipboardList size={17} /></aside>}
    <aside className="needs-finance-note"><CircleCheck size={16} /><div><strong>Sin duplicar cargos</strong><p>Marcar “comprado” sólo ordena tu lista y actualiza su rutina. El gasto real se registra en Finanzas cuando pagues.</p></div></aside>

    {editing && <Modal open title={editing.isOnShoppingList ? 'Añadir a la compra' : 'Editar rutina'} onClose={() => setEditing(undefined)} panelClassName="needs-editor-modal">
      <form className="needs-editor" onSubmit={submitEditor}>
        <label className="needs-editor__main"><span>¿Qué hace falta?</span><input required autoFocus value={editing.name} placeholder="Ej. Arena para mi gata" onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        <div className="needs-editor__grid">
          <label><span>Lista</span><select value={editing.shoppingGroup} onChange={(event) => { const shoppingGroup = event.target.value as NeedShoppingGroup; const categoryId = categories.some((category) => category.id === editing.categoryId && category.shoppingGroup === shoppingGroup) ? editing.categoryId : undefined; setEditing({ ...editing, shoppingGroup, category: categoryForGroup[shoppingGroup], categoryId }) }}>{shoppingGroups.map((group) => <option key={group} value={group}>{needShoppingGroupLabels[group]}</option>)}</select></label>
          <label><span>Categoría personal</span><select value={editing.categoryId ?? ''} onChange={(event) => setEditing({ ...editing, categoryId: event.target.value || undefined })}><option value="">Sin categoría específica</option>{editorCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label><span>Prioridad</span><select value={editing.priority} onChange={(event) => setEditing({ ...editing, priority: event.target.value as NeedPriority })}>{(Object.keys(needPriorityLabels) as NeedPriority[]).map((priority) => <option key={priority} value={priority}>{needPriorityLabels[priority]}</option>)}</select></label>
          <label><span>Cantidad o presentación</span><input value={editing.quantity ?? ''} placeholder="Ej. 1 bolsa (7 kg)" onChange={(event) => setEditing({ ...editing, quantity: event.target.value })} /></label>
          <label><span>Costo estimado (MXN){editing.estimatedAmountCents == null && suggestedPriceFor(editing) != null && <i> · sugerido {money(suggestedPriceFor(editing))}</i>}</span><input type="number" inputMode="decimal" min="0" step="1" placeholder="Opcional" value={editing.estimatedAmountCents == null ? '' : editing.estimatedAmountCents / 100} onChange={(event) => { const amount = Number(event.target.value); setEditing({ ...editing, estimatedAmountCents: event.target.value === '' || !Number.isFinite(amount) ? undefined : Math.round(amount * 100) }) }} /></label>
        </div>
        <label className="needs-editor__check"><input type="checkbox" checked={editing.isOnShoppingList} onChange={(event) => setEditing({ ...editing, isOnShoppingList: event.target.checked })} /><span><b>Lo necesito comprar ahora</b><small>Aparece en “Por comprar” en tu teléfono.</small></span></label>
        <div className="needs-editor__grid needs-editor__grid--routine">
          <label><span>Recordarme después</span><select value={editing.frequency} onChange={(event) => setEditing({ ...editing, frequency: event.target.value as NeedFrequency })}>{Object.entries(needFrequencyLabels).map(([frequency, label]) => <option key={frequency} value={frequency}>{label}</option>)}</select></label>
          {editing.frequency !== 'as_needed' && <label><span>Fecha objetivo <i>opcional</i></span><input type="date" value={editing.nextNeededOn ?? ''} onChange={(event) => setEditing({ ...editing, nextNeededOn: event.target.value || undefined })} /></label>}
        </div>
        <label className="needs-editor__notes"><span>Nota</span><textarea value={editing.notes ?? ''} placeholder="Marca, tienda o detalle que no quieres olvidar…" onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
        <p className="needs-editor__hint">No necesitas fecha para algo que sólo está empezando a faltar. Esta lista no registra gastos por sí sola.</p>
        <div className="modal-actions"><Button type="button" variant="ghost" onClick={() => setEditing(undefined)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>}
    {showCategories && <CategoryManager categories={categories} onClose={() => setShowCategories(false)} onSave={saveCategory} />}
    {showReceiptImport && <ReceiptLearningModal items={items} onClose={() => setShowReceiptImport(false)} onSave={rememberReceiptPrices} onSaved={(saved) => { setShowReceiptImport(false); setFeedback(`FARO aprendió ${saved} precio${saved === 1 ? '' : 's'} de este ticket. Tus estimados ya los usarán cuando aplique.`) }} />}
    <ConfirmDialog open={Boolean(deleting)} title="Eliminar necesidad" description={`Eliminarás “${deleting?.name ?? ''}” de tus listas. Esta acción no afecta Finanzas.`} onClose={() => setDeleting(undefined)} onConfirm={async () => { if (!deleting) return; try { await remove(deleting.id); setFeedback('Artículo eliminado.'); setDeleting(undefined) } catch (reason) { setFeedback(reason instanceof Error ? reason.message : 'No se pudo eliminar.') } }} />
  </div>
}

function MealPlan({ meals, onAdd, onChange, onUndo, undoAvailable, adding }: { meals: Meal[]; onAdd: () => Promise<void>; onChange: (slot: number) => Promise<void>; onUndo: () => Promise<void>; undoAvailable: boolean; adding: boolean }) {
  return <section className="needs-meal-plan">
    <header><div><span className="eyebrow">SUPERMERCADO · PLAN LIGERO</span><h3>8 comidas para tener resuelto qué cocinar</h3><p>Ideas balanceadas con verduras, proteína y granos integrales; ajusta cantidades a tu contexto.</p></div><div className="needs-meal-plan__actions"><Button variant="secondary" size="sm" icon={<Undo2 size={14} />} disabled={!undoAvailable || adding} onClick={() => void onUndo()}>Deshacer</Button><Button size="sm" icon={<ShoppingCart size={14} />} loading={adding} onClick={() => void onAdd()}>Añadir lista base</Button></div></header>
    <div className="needs-meal-plan__meals">{meals.map((meal, slot) => <article key={meal.id}><Leaf size={15} /><div><strong>{meal.name}</strong><span>{meal.detail}</span><small>{meal.ingredients.map(([name]) => name).join(' · ')}</small><button type="button" onClick={() => void onChange(slot)} disabled={adding}><RefreshCw size={12} />Cambiar</button></div></article>)}</div>
    <footer><UtensilsCrossed size={15} /><span>Cambiar conserva tu lista actual y sólo suma los ingredientes nuevos. <b>Deshacer</b> o ⌘/Ctrl + Z retira únicamente el último lote añadido.</span></footer>
  </section>
}

function MealIngredientGroups({ meals, shoppingItems }: { meals: Meal[]; shoppingItems: NeedItem[] }) {
  const inList = new Set(shoppingItems.map((item) => normalized(item.name)))
  return <section className="needs-meal-ingredients" aria-label="Ingredientes por comida">
    <header><div><span className="eyebrow">PLAN DE COCINA</span><h3>Ingredientes, comida por comida</h3><p>Si un ingrediente aparece en varias recetas, sólo se compra una vez.</p></div><span>{uniqueMealIngredients(meals).length} artículos únicos</span></header>
    <div className="needs-meal-ingredients__grid">{meals.map((meal) => <article key={meal.id}>
      <strong>{meal.name}</strong>
      <ul>{meal.ingredients.map(([name, quantity]) => <li key={name} className={inList.has(normalized(name)) ? 'is-in-list' : ''}><i>{inList.has(normalized(name)) ? <Check size={11} /> : null}</i><span>{name}</span><small>{quantity}</small></li>)}</ul>
    </article>)}</div>
  </section>
}

function ReceiptLearningModal({ items, onClose, onSave, onSaved }: { items: NeedItem[]; onClose: () => void; onSave: (draft: NeedPriceReceiptDraft) => Promise<unknown[]>; onSaved: (count: number) => void }) {
  const [file, setFile] = useState<File>()
  const [rawText, setRawText] = useState('')
  const [storeName, setStoreName] = useState('')
  const [purchasedOn, setPurchasedOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<NeedPriceReceiptDraft['lines']>([])
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const matchNeed = (name: string) => {
    const source = normalizeNeedName(name)
    return items.find((item) => normalizeNeedName(item.name) === source)
      ?? items.find((item) => source.includes(normalizeNeedName(item.name)) || normalizeNeedName(item.name).includes(source))
  }

  const turnTextIntoLines = (text: string) => {
    const parsed = parseSupermarketReceipt(text)
    if (!parsed.lines.length) throw new Error('No encontré renglones con precio claro. Puedes pegar el texto o agregar los precios manualmente.')
    setStoreName((current) => current || parsed.storeName || '')
    setLines(parsed.lines.map((line) => {
      const match = matchNeed(line.sourceName)
      return { sourceName: line.sourceName, canonicalName: match?.name ?? line.sourceName, needItemId: match?.id, amountCents: line.amountCents, remember: true }
    }))
  }

  const readTicket = async () => {
    if (!file && !rawText.trim()) return setError('Sube una foto del ticket o pega su texto.')
    setReading(true); setError('')
    try {
      let text = rawText.trim()
      if (!text && file?.type.startsWith('text/')) text = await file.text()
      if (!text && file) {
        const { recognize } = await import('tesseract.js')
        const result = await recognize(file, 'spa')
        text = result.data.text
      }
      turnTextIntoLines(text)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos leer este ticket.') }
    finally { setReading(false) }
  }

  const updateLine = (index: number, patch: Partial<NeedPriceReceiptDraft['lines'][number]>) => setLines((current) => current.map((line, candidate) => candidate === index ? { ...line, ...patch } : line))
  const chooseNeed = (index: number, needId: string) => {
    const selected = items.find((item) => item.id === needId)
    updateLine(index, { needItemId: selected?.id, canonicalName: selected?.name ?? lines[index].canonicalName })
  }
  const addManualLine = () => setLines((current) => [...current, { sourceName: 'Artículo del ticket', canonicalName: '', amountCents: 0, remember: true }])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const selectedCount = lines.filter((line) => line.remember && line.canonicalName.trim()).length
    if (!selectedCount) return setError('Selecciona al menos un precio válido para recordar.')
    setSaving(true); setError('')
    try {
      const saved = await onSave({ storeName, purchasedOn, sourceFileName: file?.name, lines })
      onSaved(saved.length)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No pudimos guardar estos precios.') }
    finally { setSaving(false) }
  }

  return <Modal open title="Enseñar precios desde un ticket" onClose={onClose} panelClassName="needs-ticket-modal">
    <form className="needs-ticket" onSubmit={submit}>
      <div className="needs-ticket__intro"><span><FileText size={19} /></span><div><strong>La imagen se lee en este dispositivo.</strong><p>Antes de guardar, tú confirmas cada artículo. Sólo se conserva precio, tienda, fecha y nombre; nunca se registra un gasto en Finanzas.</p></div></div>
      {!lines.length ? <section className="needs-ticket__capture">
        <label className="needs-ticket__upload"><input type="file" accept="image/*,.txt,text/plain" onChange={(event) => { setFile(event.target.files?.[0]); setError('') }} /><FileText size={19} /><span>{file ? file.name : 'Subir foto o texto del ticket'}</span><small>JPG, PNG o TXT</small></label>
        <span>o pega el texto si tu tienda lo comparte por correo:</span>
        <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'LECHE ENTERA 1L  31.50\nATUN AGUA 140G  24.90'} />
        <Button type="button" loading={reading} icon={<FileText size={15} />} onClick={() => void readTicket()}>Leer y revisar</Button>
      </section> : <section className="needs-ticket__review">
        <header><div><span className="eyebrow">REVISIÓN OBLIGATORIA</span><h3>{lines.length} renglones detectados</h3></div><Button type="button" variant="ghost" size="sm" onClick={() => setLines([])}>Leer otro ticket</Button></header>
        <div className="needs-ticket__metadata"><label>Tienda<input value={storeName} placeholder="Ej. HEB, Walmart" onChange={(event) => setStoreName(event.target.value)} /></label><label>Fecha de compra<input type="date" value={purchasedOn} onChange={(event) => setPurchasedOn(event.target.value)} /></label></div>
        <div className="needs-ticket__lines">{lines.map((line, index) => <article key={`${line.sourceName}-${index}`} className={line.remember ? '' : 'is-muted'}>
          <label className="needs-ticket__remember"><input type="checkbox" checked={line.remember} onChange={(event) => updateLine(index, { remember: event.target.checked })} /><span>Recordar</span></label>
          <div><small>Como salió en el ticket</small><strong>{line.sourceName}</strong></div>
          <label><small>Necesidad / equivalencia</small><select value={line.needItemId ?? ''} onChange={(event) => chooseNeed(index, event.target.value)}><option value="">Nombre personalizado</option>{items.filter((item) => item.shoppingGroup === 'supermarket').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><small>Nombre que FARO recordará</small><input value={line.canonicalName} onChange={(event) => updateLine(index, { canonicalName: event.target.value, needItemId: undefined })} placeholder="Ej. Atún en agua" /></label>
          <label><small>Presentación</small><input value={line.presentation ?? ''} onChange={(event) => updateLine(index, { presentation: event.target.value })} placeholder="Ej. 140 g" /></label>
          <label><small>Precio pagado</small><input type="number" min="0" step="0.01" value={line.amountCents ? (line.amountCents / 100).toFixed(2) : ''} onChange={(event) => updateLine(index, { amountCents: Math.round((Number(event.target.value) || 0) * 100) })} /></label>
        </article>)}</div>
        <button type="button" className="needs-ticket__manual-line" onClick={addManualLine}><Plus size={14} />Añadir renglón manual</button>
      </section>}
      {error && <p className="needs-ticket__error">{error}</p>}
      <footer className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>{lines.length > 0 && <Button type="submit" loading={saving}>Guardar {lines.filter((line) => line.remember && line.canonicalName.trim()).length} precios</Button>}</footer>
    </form>
  </Modal>
}

function CategoryManager({ categories, onClose, onSave }: { categories: NeedsCategory[]; onClose: () => void; onSave: (category: NeedsCategory) => Promise<NeedsCategory> }) {
  const [name, setName] = useState('')
  const [shoppingGroup, setShoppingGroup] = useState<NeedShoppingGroup>('supermarket')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Escribe el nombre de la categoría.')
    const now = new Date().toISOString()
    setSaving(true); setError('')
    try {
      await onSave({ id: crypto.randomUUID(), name: name.trim(), shoppingGroup, createdAt: now, updatedAt: now })
      setName('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo crear la categoría.') }
    finally { setSaving(false) }
  }
  return <Modal open title="Tus categorías" onClose={onClose} panelClassName="needs-categories-modal"><form className="needs-category-manager" onSubmit={submit}>
    <p>Organiza tus necesidades a tu manera. Cada categoría vive dentro de una lista de compra.</p>
    <div><label>Nombre<input autoFocus value={name} maxLength={60} placeholder="Ej. Comida, Limpieza, Proteínas" onChange={(event) => setName(event.target.value)} /></label><label>Lista<select value={shoppingGroup} onChange={(event) => setShoppingGroup(event.target.value as NeedShoppingGroup)}>{shoppingGroups.map((group) => <option key={group} value={group}>{needShoppingGroupLabels[group]}</option>)}</select></label><Button type="submit" loading={saving} icon={<Plus size={14} />}>Crear</Button></div>
    {error && <small className="needs-category-manager__error">{error}</small>}
    <section>{categories.length ? categories.map((category) => <article key={category.id}><span className={`needs-shopping-group__icon needs-shopping-group__icon--${category.shoppingGroup}`}>{shoppingGroupIcons[category.shoppingGroup]}</span><div><strong>{category.name}</strong><small>{needShoppingGroupLabels[category.shoppingGroup]}</small></div></article>) : <p className="needs-category-manager__empty">Aún no tienes categorías propias.</p>}</section>
    <div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Listo</Button></div>
  </form></Modal>
}

function ShoppingGroup({ group, items, categories, collapsed, onToggle, onBuy, onEdit, onDelete, suggestedPriceFor }: { group: NeedShoppingGroup; items: NeedItem[]; categories: NeedsCategory[]; collapsed: boolean; onToggle: () => void; onBuy: (item: NeedItem) => void; onEdit: (item: NeedItem) => void; onDelete: (item: NeedItem) => void; suggestedPriceFor: (item: NeedItem) => number | undefined }) {
  return <section className="needs-shopping-group">
    <header><span className={`needs-shopping-group__icon needs-shopping-group__icon--${group}`}>{shoppingGroupIcons[group]}</span><h3>{needShoppingGroupLabels[group]}</h3><b>{items.length}</b><button aria-label={`${collapsed ? 'Mostrar' : 'Ocultar'} ${needShoppingGroupLabels[group]}`} onClick={onToggle}><ChevronDown className={collapsed ? 'is-collapsed' : ''} size={18} /></button></header>
    {!collapsed && <div>{items.map((item) => <ShoppingRow key={item.id} item={item} categoryName={categories.find((category) => category.id === item.categoryId)?.name} suggestedAmountCents={suggestedPriceFor(item)} onBuy={onBuy} onEdit={onEdit} onDelete={onDelete} />)}</div>}
  </section>
}

function ShoppingRow({ item, categoryName, suggestedAmountCents, onBuy, onEdit, onDelete }: { item: NeedItem; categoryName?: string; suggestedAmountCents?: number; onBuy: (item: NeedItem) => void; onEdit: (item: NeedItem) => void; onDelete: (item: NeedItem) => void }) {
  const estimatedAmount = item.estimatedAmountCents ?? suggestedAmountCents
  return <article className="needs-shopping-row">
    <button className="needs-shopping-row__check" onClick={() => onBuy(item)} aria-label={`Marcar ${item.name} como comprado`}><Check size={17} /></button>
    <div className="needs-shopping-row__copy"><h4>{item.name}</h4><p>{item.quantity || item.notes || 'Sin detalle'}</p>{(item.frequency === 'as_needed' || categoryName) && <span>{[categoryName, item.frequency === 'as_needed' ? 'Sin fecha · cuando falte' : undefined].filter(Boolean).join(' · ')}</span>}</div>
    {money(estimatedAmount) && <b className="needs-shopping-row__amount">{money(estimatedAmount)}<small>{item.estimatedAmountCents == null && suggestedAmountCents != null ? 'aprendido' : 'est.'}</small></b>}
    <div className="needs-shopping-row__actions"><button aria-label={`Editar ${item.name}`} onClick={() => onEdit(item)}><Pencil size={16} /></button><button aria-label={`Eliminar ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={16} /></button></div>
  </article>
}

function RoutineRow({ item, onAdd, onEdit, onDelete }: { item: NeedItem; onAdd: (item: NeedItem) => void; onEdit: (item: NeedItem) => void; onDelete: (item: NeedItem) => void }) {
  const timing = needTiming(item.nextNeededOn)
  return <article className="needs-routine-row"><span>{item.frequency === 'as_needed' ? <BellRing size={16} /> : <ChevronDown size={16} />}</span><div><h4>{item.name}</h4><p>{needFrequencyLabels[item.frequency]}{item.nextNeededOn ? ` · ${needTimingLabel(item.nextNeededOn)}` : ' · Sin fecha fija'}</p></div><button className="needs-routine-row__add" onClick={() => onAdd(item)}>{timing === 'overdue' || timing === 'today' ? 'Hace falta' : 'Añadir a compra'}</button><button aria-label={`Editar ${item.name}`} onClick={() => onEdit(item)}><Pencil size={15} /></button><button aria-label={`Eliminar ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={15} /></button></article>
}
