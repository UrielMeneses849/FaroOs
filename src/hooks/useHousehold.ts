import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { householdRepository } from '../repositories/householdRepository'
import { needsRepository } from '../repositories/needsRepository'
import { emptyHousehold, householdSchema, migrateLegacy, type Household } from '../features/needs/household'

type Snapshot = { owner: string; revision: number; state: Household }
const key = (id: string) => `faro.needs.household.v1.${id}`
function cached(id: string): Snapshot | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key(id)) ?? 'null')
    if (value?.owner === id && Number.isInteger(value.revision)) return { ...value, state: householdSchema.parse(value.state) }
  } catch { /* An invalid cache never replaces the remote source. */ }
}
function remember(snapshot: Snapshot) {
  try { localStorage.setItem(key(snapshot.owner), JSON.stringify(snapshot)) } catch { /* Remote persistence already succeeded. */ }
}
export function useHousehold() {
  const { user } = useAuth()
  const owner = user?.id
  const ownerRef = useRef(owner)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const current = useRef<Snapshot | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const request = useRef(0)
  const reload = useCallback(async () => {
    const ticket = ++request.current
    if (!owner) { current.current = undefined; setSnapshot(undefined); setLoading(false); return }
    setLoading(true); setError('')
    const valid = () => ownerRef.current === owner && ticket === request.current
    try {
      const remote = await householdRepository.load(owner)
      let next: Snapshot
      if (remote) next = { owner, ...remote }
      else {
        const legacy = await needsRepository.list(owner)
        const state = { ...emptyHousehold(), products: migrateLegacy(legacy), importedLegacy: true }
        if (!valid()) return
        const revision = await householdRepository.save(state, -1)
        next = { owner, revision, state }
      }
      if (!valid()) return
      current.current = next; setSnapshot(next); remember(next); setReadOnly(false)
    } catch {
      if (!valid()) return
      const cache = cached(owner)
      current.current = cache; setSnapshot(cache); setReadOnly(true)
      setError('No fue posible cargar Necesidades. Revisa tu conexión y vuelve a intentarlo. Si hay una copia guardada, se muestra sólo para consulta.')
    } finally { if (valid()) setLoading(false) }
  }, [owner])
  useEffect(() => {
    let active = true
    ownerRef.current = owner
    queueMicrotask(() => { if (active) void reload() })
    return () => { active = false; ownerRef.current = undefined }
  }, [owner, reload])
  const change = async (update: (state: Household) => Household) => {
    if (busy.current || readOnly || !owner || !current.current || current.current.owner !== owner) throw new Error('Espera a que termine la sincronización.')
    busy.current = true; setSaving(true); setError('')
    const previous = current.current
    try {
      const nextState = householdSchema.parse(update(previous.state))
      if (ownerRef.current !== owner) throw new Error('La sesión cambió.')
      const revision = await householdRepository.save(nextState, previous.revision)
      if (ownerRef.current !== owner) return
      const next = { owner, revision, state: nextState }
      current.current = next; setSnapshot(next); remember(next)
      window.dispatchEvent(new Event('faro:household-updated'))
    } catch (reason) {
      if (ownerRef.current !== owner) throw reason
      const conflict = typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === '40001'
      if (conflict) await reload()
      const message = conflict ? 'Hubo cambios desde otro dispositivo. Ya recargamos los datos; revisa e intenta de nuevo.' : reason instanceof Error ? reason.message : 'No se pudo guardar. Tus cambios no se aplicaron; intenta de nuevo.'
      setError(message); throw new Error(message, { cause: reason })
    } finally { busy.current = false; setSaving(false) }
  }
  return { state: snapshot && snapshot.owner === owner ? snapshot.state : emptyHousehold(), loading, saving, readOnly, error, reload, change }
}
