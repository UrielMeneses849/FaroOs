import {
  AlertTriangle, CheckCircle2, ChevronDown, Clipboard, Copy, Eye, EyeOff,
  ExternalLink, KeyRound, Lock, Plus, RefreshCw, Search, ShieldCheck,
  ShieldX, Star, Trash2, Unlock, WandSparkles,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, ConfirmDialog, EmptyState, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import {
  copyDesktopVaultPassword, copyDesktopVaultUsername, createDesktopVault,
  createDesktopVaultCredential, deleteDesktopVaultCredential,
  generateDesktopVaultPassword, getDesktopVaultCredential, getDesktopVaultStatus,
  isFaroDesktop, listDesktopVault, lockDesktopVault, openDesktopVaultUrl,
  unlockDesktopVault, updateDesktopVaultCredential, updateDesktopVaultSettings,
} from '../desktop/desktopBridge'
import type {
  VaultCredentialDetail, VaultCredentialInput, VaultCredentialSummary,
  VaultGeneratorOptions, VaultListResponse, VaultStatus,
} from '../features/vault/vaultTypes'
import '../features/vault/vault.css'

type CredentialForm = {
  serviceName: string
  username: string
  password: string
  url: string
  notes: string
  favorite: boolean
  tags: string
}

const emptyForm = (): CredentialForm => ({
  serviceName: '', username: '', password: '', url: '', notes: '', favorite: false, tags: '',
})

const toForm = (credential: VaultCredentialDetail): CredentialForm => ({
  serviceName: credential.serviceName,
  username: credential.username,
  password: credential.password,
  url: credential.url,
  notes: credential.notes,
  favorite: credential.favorite,
  tags: credential.tags.join(', '),
})

const formInput = (form: CredentialForm): VaultCredentialInput => ({
  serviceName: form.serviceName,
  username: form.username,
  password: form.password,
  url: form.url,
  notes: form.notes,
  favorite: form.favorite,
  tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
})

const ageLabel = (days: number) => {
  if (days < 1) return 'Actualizada hoy'
  if (days === 1) return 'Actualizada hace 1 día'
  return `Sin cambio hace ${days} días`
}

const vaultError = (reason: unknown) => reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'No pude completar esta acción de FARO Vault.'

const defaultGenerator: VaultGeneratorOptions = {
  length: 24,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  avoidAmbiguous: true,
}

const EMPTY_CREDENTIALS: VaultCredentialSummary[] = []

export function VaultPage() {
  const [status, setStatus] = useState<VaultStatus>()
  const [data, setData] = useState<VaultListResponse>()
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<CredentialForm>(emptyForm)
  const [editing, setEditing] = useState<VaultCredentialDetail>()
  const [detail, setDetail] = useState<VaultCredentialDetail>()
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [deleting, setDeleting] = useState<VaultCredentialSummary>()
  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [generator, setGenerator] = useState<VaultGeneratorOptions>(defaultGenerator)
  const lastActivity = useRef(0)
  const listRequest = useRef(0)
  const sessionGeneration = useRef(0)
  const saving = useRef(false)

  const locked = !status || status.locked
  const timeout = status?.timeoutMinutes ?? 5
  const lockOnBlur = data?.lockOnBlur ?? status?.lockOnBlur ?? false

  const clearSensitiveUi = useCallback(() => {
    listRequest.current += 1
    sessionGeneration.current += 1
    setData(undefined)
    setDetail(undefined)
    setPasswordVisible(false)
    setFormOpen(false)
    setEditing(undefined)
    setForm(emptyForm())
    setGeneratorOpen(false)
  }, [])

  const refreshStatus = useCallback(async () => {
    const next = await getDesktopVaultStatus()
    if (!next) throw new Error('FARO Vault sólo está disponible en FARO Desktop.')
    setStatus(next)
    if (!next.locked) lastActivity.current = Date.now()
    return next
  }, [])

  const loadCredentials = useCallback(async (nextQuery = '') => {
    const request = ++listRequest.current
    const next = await listDesktopVault(nextQuery)
    if (!next) throw new Error('No pude leer FARO Vault en esta sesión.')
    if (request !== listRequest.current) return next
    setData(next)
    setStatus((current) => current ? { ...current, locked: false, timeoutMinutes: next.timeoutMinutes, lockOnBlur: next.lockOnBlur } : current)
    return next
  }, [])

  useEffect(() => {
    if (!isFaroDesktop()) return
    const task = window.setTimeout(() => {
      void refreshStatus().then((next) => {
        if (!next.locked) return loadCredentials('')
        return undefined
      }).catch((reason) => setError(vaultError(reason)))
    }, 0)
    return () => { window.clearTimeout(task); listRequest.current += 1; sessionGeneration.current += 1 }
  }, [loadCredentials, refreshStatus])

  useEffect(() => {
    if (locked) return
    const timer = window.setTimeout(() => {
      if (saving.current) return
      void loadCredentials(query).catch((reason) => {
        const message = vaultError(reason)
        if (message.includes('bloqueado')) {
          clearSensitiveUi()
          void refreshStatus().catch(() => undefined)
        } else setError(message)
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [clearSensitiveUi, loadCredentials, locked, query, refreshStatus])

  useEffect(() => {
    if (locked) return
    const markActivity = () => { lastActivity.current = Date.now() }
    const lockForInactiveWindow = () => {
      if (!lockOnBlur) return
      void (async () => {
        try { await lockDesktopVault() } catch { /* A native session may have already expired. */ }
        clearSensitiveUi()
        await refreshStatus().catch(() => undefined)
        setFeedback('FARO Vault se bloqueó al quedar la sesión inactiva.')
      })()
    }
    const checkInactivity = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastActivity.current >= timeout * 60_000) {
        void (async () => {
          try { await lockDesktopVault() } catch { /* Native expiry is authoritative; do not expose a secret in errors. */ }
          clearSensitiveUi()
          await refreshStatus().catch(() => undefined)
          setFeedback('FARO Vault se bloqueó por inactividad.')
        })()
      }
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'focus']
    events.forEach((event) => window.addEventListener(event, markActivity))
    const onVisibilityChange = () => document.visibilityState === 'hidden' ? lockForInactiveWindow() : checkInactivity()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', lockForInactiveWindow)
    const interval = window.setInterval(checkInactivity, 1_000)
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity))
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', lockForInactiveWindow)
      window.clearInterval(interval)
    }
  }, [clearSensitiveUi, lockOnBlur, locked, refreshStatus, timeout])

  const authenticate = async (operation: 'create' | 'unlock') => {
    setBusy(true); setError(''); setFeedback('')
    try {
      const next = operation === 'create' ? await createDesktopVault() : await unlockDesktopVault()
      if (!next) throw new Error('No pude iniciar Touch ID.')
      setStatus(next)
      lastActivity.current = Date.now()
      await loadCredentials('')
      setFeedback(operation === 'create' ? 'FARO Vault fue creado y quedó desbloqueado.' : 'FARO Vault está desbloqueado.')
    } catch (reason) {
      setError(vaultError(reason))
    } finally { setBusy(false) }
  }

  const lockVault = async (notice = 'FARO Vault quedó bloqueado.') => {
    setBusy(true)
    try {
      const next = await lockDesktopVault()
      if (next) setStatus(next)
      clearSensitiveUi()
      setFeedback(notice)
      setError('')
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const openCreate = () => {
    setEditing(undefined)
    setForm(emptyForm())
    setPasswordVisible(false)
    setFormOpen(true)
  }

  const openEdit = async (item: VaultCredentialSummary) => {
    setBusy(true); setError('')
    try {
      const next = await getDesktopVaultCredential(item.id)
      if (!next) throw new Error('No pude abrir la credencial.')
      setEditing(next); setForm(toForm(next)); setPasswordVisible(false); setFormOpen(true)
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const openDetail = async (item: VaultCredentialSummary) => {
    setBusy(true); setError('')
    try {
      const next = await getDesktopVaultCredential(item.id)
      if (!next) throw new Error('No pude abrir la credencial.')
      setDetail(next); setPasswordVisible(false)
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const saveCredential = async () => {
    if (saving.current) return
    saving.current = true
    const generation = sessionGeneration.current
    listRequest.current += 1
    setBusy(true); setError(''); setFeedback('')
    let persisted = false
    try {
      const saved = editing
        ? await updateDesktopVaultCredential(editing.id, formInput(form))
        : await createDesktopVaultCredential(formInput(form))
      if (!saved?.id) throw new Error('No pude confirmar el guardado de la credencial.')
      persisted = true
      if (generation !== sessionGeneration.current) return
      setFormOpen(false); setEditing(undefined); setForm(emptyForm()); setPasswordVisible(false)
      setDetail(undefined)
      setQuery('')
      const refreshed = await loadCredentials('')
      if (generation !== sessionGeneration.current) return
      if (!refreshed.credentials.some((credential) => credential.id === saved.id)) {
        throw new Error('La credencial no aparece en la lectura posterior al guardado.')
      }
      lastActivity.current = Date.now()
      setFeedback(editing ? 'Credencial actualizada y verificada en FARO Vault.' : 'Credencial guardada y verificada en FARO Vault.')
    } catch (reason) {
      if (generation !== sessionGeneration.current) return
      setError(persisted
        ? 'Vault confirmó el guardado, pero no pude verificar la credencial en la lista. Pulsa Actualizar antes de volver a crearla.'
        : vaultError(reason))
    } finally { saving.current = false; setBusy(false) }
  }

  const copy = async (id: string, kind: 'username' | 'password') => {
    setError('')
    try {
      const result = kind === 'password' ? await copyDesktopVaultPassword(id) : await copyDesktopVaultUsername(id)
      setFeedback(result?.message ?? 'Copiado al portapapeles.')
      lastActivity.current = Date.now()
    } catch (reason) { setError(vaultError(reason)) }
  }

  const openUrl = async (id: string) => {
    setError('')
    try { await openDesktopVaultUrl(id); lastActivity.current = Date.now() } catch (reason) { setError(vaultError(reason)) }
  }

  const toggleFavorite = async (item: VaultCredentialSummary) => {
    try {
      await updateDesktopVaultCredential(item.id, { favorite: !item.favorite })
      await loadCredentials(query)
    } catch (reason) { setError(vaultError(reason)) }
  }

  const removeCredential = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteDesktopVaultCredential(deleting.id, 'ELIMINAR')
      setDeleting(undefined); setDetail((current) => current?.id === deleting.id ? undefined : current)
      await loadCredentials(query)
      setFeedback('Credencial eliminada de FARO Vault.')
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const makePassword = async () => {
    setBusy(true); setError('')
    try {
      const generated = await generateDesktopVaultPassword(generator)
      if (!generated) throw new Error('No pude generar una contraseña segura.')
      setForm((current) => ({ ...current, password: generated.password }))
      setPasswordVisible(true)
      setGeneratorOpen(false)
      setFeedback('Contraseña generada. Pulsa Guardar cifrada para guardar la credencial.')
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const changeTimeout = async (minutes: number) => {
    setBusy(true); setError('')
    try {
      const next = await updateDesktopVaultSettings({ autoLockMinutes: minutes })
      if (!next) throw new Error('No pude actualizar el bloqueo automático.')
      setStatus(next); lastActivity.current = Date.now(); setFeedback(`Bloqueo automático: ${minutes} min.`)
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const changeLockOnBlur = async (enabled: boolean) => {
    setBusy(true); setError('')
    try {
      const next = await updateDesktopVaultSettings({ lockOnBlur: enabled })
      if (!next) throw new Error('No pude actualizar el bloqueo por inactividad.')
      setStatus(next); await loadCredentials(query); lastActivity.current = Date.now()
      setFeedback(enabled ? 'Vault se bloqueará al cambiar de sesión.' : 'El bloqueo al perder foco quedó desactivado.')
    } catch (reason) { setError(vaultError(reason)) } finally { setBusy(false) }
  }

  const activeCredentials = data?.credentials ?? EMPTY_CREDENTIALS
  const security = data?.security
  const alertCount = (security?.reusedCount ?? 0) + (security?.weakCount ?? 0) + (security?.oldCount ?? 0)
  const favoriteCount = activeCredentials.filter((item) => item.favorite).length

  if (!isFaroDesktop()) {
    return <div className="page vault-page"><PageHeader eyebrow="FARO Vault" title="Credenciales protegidas" /><EmptyState title="Disponible sólo en FARO Desktop" description="FARO Vault guarda credenciales cifradas en este Mac y no se habilita en la versión web." /></div>
  }

  return (
    <div className="page vault-page">
      <PageHeader
        eyebrow="FARO Vault · local y cifrado"
        title="Tus accesos, bajo llave"
        description="FARO no guarda secretos en la nube ni en almacenamiento del navegador."
        showDescription
        trailing={!locked ? <Button variant="secondary" size="sm" icon={<Lock size={15} />} loading={busy} onClick={() => void lockVault()}>Bloquear</Button> : undefined}
      />

      {feedback && <div className="vault-feedback vault-feedback--success" role="status"><CheckCircle2 size={16} />{feedback}<button type="button" aria-label="Cerrar aviso" onClick={() => setFeedback('')}>×</button></div>}
      {error && <div className="vault-feedback vault-feedback--error" role="alert"><AlertTriangle size={16} />{error}<button type="button" aria-label="Cerrar error" onClick={() => setError('')}>×</button></div>}

      {locked ? (
        <section className="vault-locked panel">
          <div className="vault-locked__symbol"><KeyRound size={31} /></div>
          <span className="eyebrow">Acceso con huella</span>
          <h2>{status?.exists ? 'Desbloquea tus credenciales' : 'Crea tu FARO Vault'}</h2>
          <p>{status?.exists
            ? 'Entra solo con tu huella. La primera vez, macOS puede pedir autorizar el traslado de la llave antigua; después Vault dejará de consultar el Llavero.'
            : 'Usa tu huella para abrir Vault. El contenido y su llave se guardan localmente bajo tu usuario de macOS.'}</p>
          <Button size="lg" icon={status?.exists ? <Unlock size={17} /> : <ShieldCheck size={17} />} loading={busy} onClick={() => void authenticate(status?.exists ? 'unlock' : 'create')}>
            {status?.exists ? 'Desbloquear con Touch ID' : 'Crear FARO Vault con Touch ID'}
          </Button>
          <small>Sin contraseña maestra · sin importación · sin sincronización automática.</small>
        </section>
      ) : (
        <>
          <section className="vault-security panel" aria-label="Resumen de seguridad de Vault">
            <article><span>Credenciales</span><strong>{security?.credentialCount ?? 0}</strong><small>{favoriteCount} favoritas</small></article>
            <article className={security?.reusedCount ? 'is-alert' : ''}><span>Reutilizadas</span><strong>{security?.reusedCount ?? 0}</strong><small>{security?.reusedCount ? 'Revisa antes de cambiar' : 'Sin señales detectadas'}</small></article>
            <article className={security?.weakCount ? 'is-alert' : ''}><span>Débiles</span><strong>{security?.weakCount ?? 0}</strong><small>Reglas locales, no IA</small></article>
            <article className={security?.oldCount ? 'is-warning' : ''}><span>Más de 365 días</span><strong>{security?.oldCount ?? 0}</strong><small>{alertCount ? 'Prioriza con tu criterio' : 'Sin alertas actuales'}</small></article>
            <label className="vault-timeout"><span>Bloqueo automático</span><select value={timeout} onChange={(event) => void changeTimeout(Number(event.target.value))} disabled={busy} aria-label="Bloqueo automático"><option value={1}>1 min</option><option value={5}>5 min</option><option value={15}>15 min</option><option value={30}>30 min</option></select><small><input type="checkbox" checked={lockOnBlur} onChange={(event) => void changeLockOnBlur(event.target.checked)} disabled={busy} />Bloquear al cambiar de sesión</small></label>
          </section>

          <section className="vault-library panel">
            <header className="vault-library__header">
              <div><span className="eyebrow">Bóveda local</span><h2>Credenciales</h2><p>Busca, revisa y copia sin exponer contraseñas en la lista.</p></div>
              <Button icon={<Plus size={16} />} disabled={busy} onClick={openCreate}>Nueva credencial</Button>
            </header>
            <div className="vault-toolbar">
              <label className="vault-search"><Search size={16} /><input value={query} disabled={busy} onChange={(event) => { listRequest.current += 1; setQuery(event.target.value) }} placeholder="Buscar servicio, usuario o sitio" aria-label="Buscar credenciales" /></label>
              <Button variant="ghost" size="sm" icon={<RefreshCw size={15} />} disabled={busy} onClick={() => void loadCredentials(query).catch((reason) => setError(vaultError(reason)))}>Actualizar</Button>
            </div>
            {activeCredentials.length ? <div className="vault-credential-list">
              {activeCredentials.map((credential) => <CredentialRow key={credential.id} credential={credential} onCopy={copy} onOpenUrl={openUrl} onOpen={() => void openDetail(credential)} onEdit={() => void openEdit(credential)} onDelete={() => setDeleting(credential)} onFavorite={() => void toggleFavorite(credential)} />)}
            </div> : <EmptyState title={query ? 'Sin coincidencias' : 'Tu Vault todavía está vacío'} description={query ? 'Prueba otra búsqueda.' : 'Crea una credencial; su contenido se cifra localmente antes de guardarse.'} action={!query ? <Button icon={<Plus size={15} />} onClick={openCreate}>Agregar credencial</Button> : undefined} />}
          </section>
        </>
      )}

      <Modal open={formOpen} title={editing ? 'Editar credencial' : 'Nueva credencial'} onClose={() => { setFormOpen(false); setEditing(undefined); setForm(emptyForm()); setPasswordVisible(false) }} panelClassName="vault-modal">
        <form className="vault-form" onSubmit={(event) => { event.preventDefault(); void saveCredential() }}>
          {error && <p role="alert">{error}</p>}
          <label>Servicio<input value={form.serviceName} onChange={(event) => setForm((current) => ({ ...current, serviceName: event.target.value }))} placeholder="Ej. GitHub" required maxLength={120} /></label>
          <label>Usuario o correo<input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="off" required maxLength={320} /></label>
          <label>Contraseña<div className="vault-password-field"><input type={passwordVisible ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" required maxLength={2048} /><button type="button" onClick={() => setPasswordVisible((current) => !current)} aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button><button type="button" onClick={() => setGeneratorOpen(true)} aria-label="Generar contraseña"><WandSparkles size={16} /></button></div></label>
          <label>URL (opcional)<input type="url" value={form.url} onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://ejemplo.com" maxLength={1024} /></label>
          <label>Etiquetas (opcional)<input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="Trabajo, personal" maxLength={396} /></label>
          <label className="vault-form__notes">Notas (opcional)<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} maxLength={10_000} /></label>
          <label className="vault-check"><input type="checkbox" checked={form.favorite} onChange={(event) => setForm((current) => ({ ...current, favorite: event.target.checked }))} />Marcar como favorita</label>
          <div className="vault-form__actions"><Button type="button" variant="ghost" onClick={() => { setFormOpen(false); setEditing(undefined); setForm(emptyForm()); setPasswordVisible(false) }}>Cancelar</Button><Button type="submit" loading={busy} icon={<ShieldCheck size={15} />}>{editing ? 'Guardar cambios' : 'Guardar cifrada'}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(detail)} title={detail?.serviceName ?? 'Credencial'} onClose={() => { setDetail(undefined); setPasswordVisible(false) }} panelClassName="vault-modal vault-detail-modal">
        {detail && <div className="vault-detail">
          <div className="vault-detail__top"><div><span className="eyebrow">Credencial cifrada</span><h3>{detail.serviceName}</h3><p>{detail.username}</p></div>{detail.favorite && <Star size={18} fill="currentColor" />}</div>
          <div className="vault-detail__field"><span>Usuario</span><strong>{detail.username}</strong><Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => void copy(detail.id, 'username')}>Copiar</Button></div>
          <div className="vault-detail__field"><span>Contraseña</span><strong className="vault-detail__password">{passwordVisible ? detail.password : '••••••••••••••••'}</strong><div><Button size="sm" variant="ghost" icon={passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setPasswordVisible((current) => !current)}>{passwordVisible ? 'Ocultar' : 'Mostrar'}</Button><Button size="sm" variant="secondary" icon={<Clipboard size={14} />} onClick={() => void copy(detail.id, 'password')}>Copiar</Button></div></div>
          {detail.url && <div className="vault-detail__field"><span>Sitio</span><strong className="vault-detail__url">{detail.url}</strong><Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => void openUrl(detail.id)}>Abrir</Button></div>}
          {detail.notes && <div className="vault-detail__notes"><span>Notas</span><p>{detail.notes}</p></div>}
          <div className="vault-detail__meta"><span>Creada {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(detail.createdAt * 1000))}</span><span>{ageLabel(activeCredentials.find((item) => item.id === detail.id)?.passwordAgeDays ?? 0)}</span></div>
          <div className="vault-form__actions"><Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => { setDetail(undefined); setDeleting(detail) }}>Eliminar</Button><Button variant="secondary" icon={<Lock size={15} />} onClick={() => void lockVault('FARO Vault quedó bloqueado y el detalle se cerró.')}>Bloquear Vault</Button><Button icon={<CheckCircle2 size={15} />} onClick={() => { setDetail(undefined); setPasswordVisible(false) }}>Listo</Button></div>
        </div>}
      </Modal>

      <Modal open={generatorOpen} title="Generar contraseña" onClose={() => setGeneratorOpen(false)} panelClassName="vault-generator-modal">
        <div className="vault-generator">
          <p>Se genera localmente con aleatoriedad criptográfica; no se envía a ningún servicio.</p>
          <label>Longitud <output>{generator.length}</output><input type="range" min="12" max="64" value={generator.length} onChange={(event) => setGenerator((current) => ({ ...current, length: Number(event.target.value) }))} /></label>
          <fieldset><legend>Incluir</legend>{([['uppercase', 'Mayúsculas'], ['lowercase', 'Minúsculas'], ['numbers', 'Números'], ['symbols', 'Símbolos']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={generator[key]} onChange={(event) => setGenerator((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}</fieldset>
          <label className="vault-check"><input type="checkbox" checked={generator.avoidAmbiguous} onChange={(event) => setGenerator((current) => ({ ...current, avoidAmbiguous: event.target.checked }))} />Evitar caracteres ambiguos</label>
          <div className="vault-form__actions"><Button variant="ghost" onClick={() => setGeneratorOpen(false)}>Cancelar</Button><Button loading={busy} icon={<WandSparkles size={15} />} onClick={() => void makePassword()}>Generar</Button></div>
        </div>
      </Modal>

      <ConfirmDialog open={Boolean(deleting)} title="Eliminar credencial" description={`Eliminarás “${deleting?.serviceName ?? ''}” de FARO Vault. Esta acción requiere tu confirmación y no puede deshacerse.`} confirmLabel="Eliminar credencial" onClose={() => setDeleting(undefined)} onConfirm={() => void removeCredential()} />
    </div>
  )
}

interface CredentialRowProps {
  credential: VaultCredentialSummary
  onCopy: (id: string, kind: 'username' | 'password') => Promise<void>
  onOpenUrl: (id: string) => Promise<void>
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  onFavorite: () => void
}

function CredentialRow({ credential, onCopy, onOpenUrl, onOpen, onEdit, onDelete, onFavorite }: CredentialRowProps) {
  return <article className="vault-credential">
    <button type="button" className={`vault-favorite ${credential.favorite ? 'is-favorite' : ''}`} onClick={onFavorite} aria-label={credential.favorite ? 'Quitar de favoritas' : 'Marcar como favorita'}><Star size={17} fill={credential.favorite ? 'currentColor' : 'none'} /></button>
    <button type="button" className="vault-credential__identity" onClick={onOpen}><strong>{credential.serviceName}</strong><span>{credential.username}</span><small>{credential.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}</small></button>
    <div className="vault-credential__signals"><span className={`vault-strength vault-strength--${credential.strength.toLowerCase().replace(' ', '-')}`}>{credential.strength}</span>{credential.reusedWith > 1 && <span className="vault-reused"><ShieldX size={12} />{credential.reusedWith} reutilizadas</span>}{credential.passwordAgeDays > 365 && <span className="vault-old"><AlertTriangle size={12} />{credential.passwordAgeDays} días</span>}</div>
    <div className="vault-credential__actions"><button type="button" onClick={() => void onCopy(credential.id, 'username')} aria-label={`Copiar usuario de ${credential.serviceName}`}><Copy size={16} /></button><button type="button" onClick={() => void onCopy(credential.id, 'password')} aria-label={`Copiar contraseña de ${credential.serviceName}`}><Clipboard size={16} /></button>{credential.url && <button type="button" onClick={() => void onOpenUrl(credential.id)} aria-label={`Abrir sitio de ${credential.serviceName}`}><ExternalLink size={16} /></button>}<button type="button" onClick={onEdit} aria-label={`Editar ${credential.serviceName}`}><ChevronDown size={16} /></button><button type="button" className="is-danger" onClick={onDelete} aria-label={`Eliminar ${credential.serviceName}`}><Trash2 size={16} /></button></div>
  </article>
}
