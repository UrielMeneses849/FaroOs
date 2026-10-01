import {
  AlertTriangle, Archive, ArrowLeft, Box, CheckCircle2, ChevronRight, Clock3,
  Cloud, ExternalLink, FileSearch, FolderArchive, FolderOpen, HardDrive, LoaderCircle,
  RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2,
} from 'lucide-react'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ConfirmDialog, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import {
  acknowledgeDesktopArchiveMonthlyReview, browseDesktopStorageFolder,
  configureDesktopGoogleDrive, getDesktopArchiveOverview, getDesktopStorageCapacity, isFaroDesktop,
  moveDesktopStorageToTrash, processDesktopArchiveCandidate, processDesktopArchiveCandidates, purgeDesktopArchiveTrash,
  revealDesktopStorageFolder, revealDesktopStorageItem,
  openDesktopArchiveRemoteItem, openDesktopArchiveRootFolder, restoreDesktopArchiveItem, runDesktopArchiveSafeUploadTest,
  startDesktopArchiveGoogleDriveOAuth,
} from '../desktop/desktopBridge'
import type { ArchiveBatchProcessResult, ArchiveItemOverview, ArchiveOverview, FaroTrashItemOverview } from '../features/storage/archiveTypes'
import type { StorageAccumulation, StorageBrowserEntry, StorageFolderBrowser, StorageOverview } from '../features/storage/storageTypes'
import { readStorageScan } from '../features/storage/storageScan'
import '../features/storage/storage.css'

const bytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  // macOS presents storage in decimal GB. Keeping this format in FARO makes
  // both surfaces directly comparable after a Finder cleanup.
  const power = Math.min(Math.floor(Math.log(value) / Math.log(1000)), units.length - 1)
  const number = value / (1000 ** power)
  return `${number >= 10 || power === 0 ? number.toFixed(0) : number.toFixed(1)} ${units[power]}`
}

const date = (timestamp: number) => timestamp
  ? new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestamp * 1000))
  : 'Sin fecha disponible'

const percentage = (value: number, total: number) => total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0

interface StorageSelectionItem {
  id: string
  name: string
  bytes: number
  type: 'archivo' | 'app' | 'carpeta'
}

interface BrowserLocation {
  folderId: string
  parentId?: string
  label: string
}

type ArchiveOperation = 'backup' | 'archive'

interface ArchiveActionTarget {
  items: Array<Pick<StorageSelectionItem, 'id' | 'name' | 'bytes' | 'type'>>
  operation: ArchiveOperation
}

interface ArchiveProgress {
  phase: 'scanning' | 'uploading' | 'verifying' | 'movingToTrash' | 'complete' | 'failed' | string
  itemName: string
  currentPath?: string | null
  completedFiles: number
  totalFiles: number
  bytesCompleted: number
  totalBytes: number
}

const SELECTION_LIMIT = 100

export function StoragePage() {
  const [overview, setOverview] = useState<StorageOverview>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [selected, setSelected] = useState<Record<string, StorageSelectionItem>>({})
  const [confirmingTrash, setConfirmingTrash] = useState(false)
  const [movingToTrash, setMovingToTrash] = useState(false)
  const [trashFailures, setTrashFailures] = useState<string[]>([])
  const [archive, setArchive] = useState<ArchiveOverview>()
  const [archiveSetupOpen, setArchiveSetupOpen] = useState(false)
  const [archiveClientId, setArchiveClientId] = useState('')
  const [archiveClientSecret, setArchiveClientSecret] = useState('')
  const [savingArchiveConfig, setSavingArchiveConfig] = useState(false)
  const [connectingDrive, setConnectingDrive] = useState(false)
  const [runningSafeUploadTest, setRunningSafeUploadTest] = useState(false)
  const [archiveActionTarget, setArchiveActionTarget] = useState<ArchiveActionTarget>()
  const [processingArchiveAction, setProcessingArchiveAction] = useState(false)
  const [archiveProgress, setArchiveProgress] = useState<ArchiveProgress>()
  const [restoreTarget, setRestoreTarget] = useState<ArchiveItemOverview>()
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoringArchive, setRestoringArchive] = useState(false)
  const [archiveInventoryOpen, setArchiveInventoryOpen] = useState(false)
  const [archiveReviewOpen, setArchiveReviewOpen] = useState(false)
  const [archivePurgeIds, setArchivePurgeIds] = useState<Record<string, boolean>>({})
  const [archivePurgePhrase, setArchivePurgePhrase] = useState('')
  const [purgingArchive, setPurgingArchive] = useState(false)
  const [browser, setBrowser] = useState<StorageFolderBrowser>()
  const [browserLocation, setBrowserLocation] = useState<BrowserLocation>()
  const [browserTrail, setBrowserTrail] = useState<BrowserLocation[]>([])
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserVisibleCount, setBrowserVisibleCount] = useState(80)
  const [analysisTab, setAnalysisTab] = useState<'large' | 'accumulation' | 'applications' | 'development'>('large')
  const [selectedAccumulationId, setSelectedAccumulationId] = useState('')
  const screenshotSelectAllRef = useRef<HTMLInputElement>(null)
  const refreshInFlight = useRef(false)
  const browserRequest = useRef(0)
  const trashInFlight = useRef(false)

  const refresh = useCallback(async (clearSelection = true, force = true) => {
    if (!isFaroDesktop() || refreshInFlight.current) return
    refreshInFlight.current = true
    setLoading(true)
    setError('')
    // A new scan replaces native browser IDs. Close stale views before it starts.
    browserRequest.current += 1
    setBrowserLoading(false)
    setBrowser(undefined)
    setBrowserLocation(undefined)
    setBrowserTrail([])
    // Drive metadata must not delay or discard a successful local analysis.
    void getDesktopArchiveOverview().then((next) => {
      if (next) setArchive(next)
    }).catch(() => setFeedback('No pude actualizar el estado de Archive. El análisis local sigue disponible.'))
    try {
      const next = await readStorageScan(force)
      if (!next) throw new Error('Espacio sólo está disponible en FARO Desktop.')
      setOverview(next)
      if (clearSelection) setSelected({})
      setBrowser(undefined)
      setBrowserLocation(undefined)
      setBrowserTrail([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No pude leer el almacenamiento de este Mac.')
    } finally {
      setLoading(false)
      refreshInFlight.current = false
    }
  }, [])

  useEffect(() => {
    // Defer the native scan one tick: the page can paint its loading state
    // before the scanner starts traversing folders.
    const timer = window.setTimeout(() => { void refresh(true, false) }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  useEffect(() => {
    if (!isFaroDesktop()) return
    let lastCapacityCheck = 0
    let checking = false
    let disposed = false
    const refreshAfterFinder = () => {
      if (checking || refreshInFlight.current || Date.now() - lastCapacityCheck < 30_000) return
      checking = true
      lastCapacityCheck = Date.now()
      // Capacity is cheap; traversing every folder on focus was freezing the
      // interface and invalidating selections when returning from Finder.
      void getDesktopStorageCapacity().then((capacity) => {
        if (!disposed && capacity) setOverview((current) => current ? { ...current, ...capacity } : current)
      }).catch(() => {}).finally(() => { checking = false })
    }
    window.addEventListener('focus', refreshAfterFinder)
    return () => {
      disposed = true
      window.removeEventListener('focus', refreshAfterFinder)
    }
  }, [refresh])

  useEffect(() => {
    if (!connectingDrive) return
    const poll = window.setInterval(() => {
      void getDesktopArchiveOverview().then((next) => {
        if (!next) return
        setArchive(next)
        if (!next.provider.oauthInProgress) {
          setConnectingDrive(false)
          if (next.provider.connected) {
            setError('')
            setFeedback('Google Drive quedó conectado y FARO Archive ya verificó su estructura.')
          } else {
            setError(next.provider.statusMessage || 'La conexión de Google terminó sin quedar activa. Revisa la configuración OAuth y vuelve a intentarlo.')
          }
        }
      }).catch(() => {
        // Keep the visible connection state until the native flow emits a
        // terminal status or the user decides to retry it.
      })
    }, 1200)
    return () => window.clearInterval(poll)
  }, [connectingDrive])

  useEffect(() => {
    if (!isFaroDesktop()) return
    let unlisten: (() => void) | undefined
    let disposed = false
    void listen<ArchiveProgress>('faro://archive-progress', (event) => setArchiveProgress(event.payload))
      .then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup })
      .catch(() => {})
    return () => { disposed = true; unlisten?.() }
  }, [])

  const selectedItems = useMemo(() => Object.values(selected), [selected])
  const selectedIds = selectedItems.map((item) => item.id)
  const selectedBytes = selectedItems.reduce((sum, item) => sum + item.bytes, 0)
  const selectedArchiveItems = selectedItems.filter((item) => item.type === 'archivo' || item.type === 'carpeta')
  const selectedArchiveBytes = selectedArchiveItems.reduce((sum, item) => sum + item.bytes, 0)
  const reviewBytes = overview?.candidates.reduce((sum, candidate) => sum + candidate.bytes, 0) ?? 0
  const allCandidateIds = overview?.candidates.map((candidate) => candidate.id) ?? []
  const allCandidatesSelected = allCandidateIds.length > 0 && allCandidateIds.every((candidateId) => Boolean(selected[candidateId]))
  const screenshotCandidates = overview?.screenshots ?? []
  const screenshotBytes = screenshotCandidates.reduce((sum, screenshot) => sum + screenshot.bytes, 0)
  const allScreenshotsSelected = screenshotCandidates.length > 0 && screenshotCandidates.every((screenshot) => Boolean(selected[screenshot.id]))
  const selectedScreenshotItems = screenshotCandidates.filter((screenshot) => Boolean(selected[screenshot.id])).map((screenshot) => ({ ...screenshot, type: 'archivo' as const }))
  const screenshotsPartiallySelected = selectedScreenshotItems.length > 0 && !allScreenshotsSelected
  const selectedAccumulation = overview?.intelligence.accumulations.find((group) => group.id === selectedAccumulationId)
  const selectedAccumulationItems = selectedAccumulation?.items.filter((item) => Boolean(selected[item.id])).map((item) => ({ ...item, type: 'archivo' as const })) ?? []
  const browserSuggestedEntries = browser?.entries.filter((entry) => !entry.isDirectory && entry.suggestedReason).slice(0, SELECTION_LIMIT) ?? []
  const browserSuggestedSelected = browserSuggestedEntries.length > 0 && browserSuggestedEntries.every((entry) => Boolean(selected[entry.id]))
  const usedPercent = percentage(overview?.usedBytes ?? 0, overview?.totalBytes ?? 0)
  const freePercent = percentage(overview?.freeBytes ?? 0, overview?.totalBytes ?? 0)
  const storageTone = freePercent < 10 ? 'critical' : freePercent < 18 ? 'warning' : 'calm'

  useEffect(() => {
    if (screenshotSelectAllRef.current) screenshotSelectAllRef.current.indeterminate = screenshotsPartiallySelected
  }, [screenshotsPartiallySelected])

  const selectionFor = (item: { id: string, name: string, bytes: number }, type: StorageSelectionItem['type'] = 'archivo'): StorageSelectionItem => ({ ...item, type })
  const developmentItems = overview?.intelligence.development.map((artifact) => selectionFor(artifact, 'carpeta')) ?? []
  const selectedDevelopmentItems = developmentItems.filter((item) => Boolean(selected[item.id]))
  const allDevelopmentSelected = developmentItems.length > 0 && developmentItems.every((item) => Boolean(selected[item.id]))

  const toggle = (item: StorageSelectionItem) => {
    setSelected((current) => {
      if (current[item.id]) {
        const next = { ...current }
        delete next[item.id]
        return next
      }
      if (Object.keys(current).length >= SELECTION_LIMIT) {
        setFeedback(`Una tanda admite hasta ${SELECTION_LIMIT} elementos. Mueve o quita algunos antes de añadir más.`)
        return current
      }
      return { ...current, [item.id]: item }
    })
  }

  const replaceSelection = (items: StorageSelectionItem[]) => {
    setSelected(Object.fromEntries(items.slice(0, SELECTION_LIMIT).map((item) => [item.id, item])))
  }

  const toggleMany = (items: StorageSelectionItem[]) => {
    if (!items.length) return
    setSelected((current) => {
      const allSelected = items.every((item) => Boolean(current[item.id]))
      if (allSelected) {
        const next = { ...current }
        items.forEach((item) => { delete next[item.id] })
        return next
      }
      const available = SELECTION_LIMIT - Object.keys(current).length
      const additions = items.filter((item) => !current[item.id]).slice(0, Math.max(0, available))
      if (additions.length < items.filter((item) => !current[item.id]).length) {
        setFeedback(`Seleccioné hasta ${SELECTION_LIMIT} elementos; mueve esa tanda o reduce la selección para continuar.`)
      }
      return { ...current, ...Object.fromEntries(additions.map((item) => [item.id, item])) }
    })
  }

  const toggleAllScreenshots = () => {
    if (!screenshotCandidates.length) return
    if (allScreenshotsSelected) {
      setSelected((current) => {
        const next = { ...current }
        screenshotCandidates.forEach((screenshot) => { delete next[screenshot.id] })
        return next
      })
      return
    }

    const screenshotItems = screenshotCandidates.map((screenshot) => selectionFor(screenshot))
    setSelected((current) => {
      const screenshotIds = new Set(screenshotItems.map((item) => item.id))
      const otherItems = Object.values(current).filter((item) => !screenshotIds.has(item.id))
      return Object.fromEntries([...screenshotItems, ...otherItems].slice(0, SELECTION_LIMIT).map((item) => [item.id, item]))
    })
  }

  const reveal = async (candidateId: string) => {
    try {
      await revealDesktopStorageItem(candidateId)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude abrir ese elemento en Finder.')
    }
  }

  const moveSelectionToTrash = async () => {
    if (!selectedIds.length || trashInFlight.current) return
    trashInFlight.current = true
    setMovingToTrash(true)
    setTrashFailures([])
    try {
      const result = await moveDesktopStorageToTrash(selectedIds)
      if (!result) throw new Error('Esta acción sólo está disponible en FARO Desktop.')
      setTrashFailures([...result.failed, ...result.warnings])
      const failure = result.failed.length
        ? ` ${result.failed.length} elemento(s) no se movieron: ${result.failed.slice(0, 2).join(' · ')}${result.failed.length > 2 ? '…' : ''}`
        : ''
      const warning = result.warnings.length ? ` ${result.warnings.length} elemento(s) no quedaron en la Papelera gobernada de FARO.` : ''
      setFeedback(result.movedCount
        ? `Moví ${result.movedCount} elemento(s) a la Papelera. Recuperable estimado: ${bytes(result.reclaimedBytes)}.${failure}${warning}`
        : `No se movió nada a la Papelera.${failure}`)
      setConfirmingTrash(false)
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude mover esos elementos a la Papelera.')
    } finally {
      trashInFlight.current = false
      setMovingToTrash(false)
    }
  }

  const loadBrowser = async (location: BrowserLocation, rememberCurrent = false) => {
    const request = ++browserRequest.current
    setBrowserLoading(true)
    try {
      const next = await browseDesktopStorageFolder(location.folderId, location.parentId)
      if (request !== browserRequest.current) return
      if (!next) throw new Error('El explorador sólo está disponible en FARO Desktop.')
      if (rememberCurrent && browserLocation) setBrowserTrail((current) => [...current, browserLocation])
      setBrowserVisibleCount(80)
      setBrowser(next)
      setBrowserLocation(location)
    } catch (reason) {
      if (request === browserRequest.current) setFeedback(reason instanceof Error ? reason.message : 'No pude abrir esta carpeta.')
    } finally {
      if (request === browserRequest.current) setBrowserLoading(false)
    }
  }

  const openFolder = (folderId: string, label: string) => void loadBrowser({ folderId, label })

  const showAnalysisTab = (tab: 'large' | 'accumulation' | 'applications' | 'development') => {
    setAnalysisTab(tab)
    window.setTimeout(() => document.querySelector('.storage-analysis-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const inspectStorageCategory = (id: string, name: string, protectedCategory: boolean) => {
    if (protectedCategory) {
      setFeedback('macOS y APFS no exponen ese espacio como archivos gestionables. FARO lo mantiene separado para no sugerirte borrar algo del sistema.')
      return
    }
    if (id === 'applications') return showAnalysisTab('applications')
    if (id === 'development') return showAnalysisTab('development')
    if (id === 'downloads' || id === 'app-data' || id === 'caches') return openFolder(id, name)
    if (id === 'personal') {
      document.querySelector('.storage-folders')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFeedback('El peso personal se divide abajo por carpeta. Abre Escritorio, Documentos, Fotos o Videos para ver sus archivos reales.')
      return
    }
    setFeedback(`${name} se mide para contexto, pero FARO no permite limpiar esa ruta desde esta pantalla.`)
  }

  const openAccumulationDetails = (group: StorageAccumulation) => {
    setSelectedAccumulationId(group.id)
    window.setTimeout(() => document.getElementById('storage-accumulation-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const openBrowserEntry = (entry: StorageBrowserEntry) => {
    if (!browser || !browserLocation || !entry.isDirectory) return
    void loadBrowser({ folderId: browser.folderId, parentId: entry.id, label: entry.name }, true)
  }

  const goBackInBrowser = () => {
    const previous = browserTrail.at(-1)
    if (!previous) return
    setBrowserTrail((current) => current.slice(0, -1))
    void loadBrowser(previous)
  }

  const revealFolder = async () => {
    if (!browserLocation) return
    try {
      await revealDesktopStorageFolder(browserLocation.folderId, browserLocation.parentId)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude abrir esta carpeta en Finder.')
    }
  }

  const saveArchiveConfig = async () => {
    setSavingArchiveConfig(true)
    try {
      const next = await configureDesktopGoogleDrive({ clientId: archiveClientId, clientSecret: archiveClientSecret, redirectUri: '' })
      if (!next) throw new Error('La configuración de Archive sólo está disponible en FARO Desktop.')
      setArchive(next)
      setArchiveSetupOpen(false)
      setFeedback('Configuración de Google guardada en este Mac. Abriré Google en tu navegador para completar la conexión.')
      const started = await startDesktopArchiveGoogleDriveOAuth()
      if (!started) throw new Error('No pude iniciar OAuth desde FARO Desktop.')
      setConnectingDrive(true)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude guardar la configuración de Google Drive.')
    } finally {
      setSavingArchiveConfig(false)
    }
  }

  const connectGoogleDrive = async () => {
    try {
      const started = await startDesktopArchiveGoogleDriveOAuth()
      if (!started) throw new Error('No pude iniciar OAuth desde FARO Desktop.')
      setConnectingDrive(true)
      setFeedback(started.message)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude abrir el navegador para conectar Google Drive.')
    }
  }

  const openArchiveSetup = () => {
    setError('')
    // The client ID is not a secret.  Keeping it here lets the user replace
    // only the secret when Google reports it is missing or stale.
    setArchiveClientId(archive?.provider.clientId ?? '')
    setArchiveClientSecret('')
    setArchiveSetupOpen(true)
  }

  const startArchiveActions = (items: Array<Pick<StorageSelectionItem, 'id' | 'name' | 'bytes' | 'type'>>, operation: ArchiveOperation) => {
    if (!archive?.provider.connected) {
      setFeedback('Conecta Google Drive antes de crear un Backup o Archive.')
      return
    }
    const unique = [...new Map(items.map((item) => [item.id, item])).values()].slice(0, SELECTION_LIMIT)
    if (!unique.length) return
    setArchiveActionTarget({ items: unique, operation })
  }

  const startArchiveAction = (id: string, name: string, value: number, operation: ArchiveOperation, type: StorageSelectionItem['type'] = 'archivo') => {
    startArchiveActions([{ id, name, bytes: value, type }], operation)
  }

  const processArchiveAction = async () => {
    if (!archiveActionTarget) return
    setArchiveProgress({ phase: 'scanning', itemName: archiveActionTarget.items[0]?.name ?? 'Selección', completedFiles: 0, totalFiles: 0, bytesCompleted: 0, totalBytes: archiveActionTarget.items.reduce((sum, item) => sum + item.bytes, 0) })
    setProcessingArchiveAction(true)
    try {
      let succeededIds: Set<string>
      let resultMessage: string
      if (archiveActionTarget.items.length > 1) {
        const result: ArchiveBatchProcessResult | undefined = await processDesktopArchiveCandidates(archiveActionTarget.items.map((item) => item.id), archiveActionTarget.operation)
        if (!result) throw new Error('Archive sólo está disponible en FARO Desktop.')
        succeededIds = new Set(result.succeeded.map((item) => item.itemId))
        resultMessage = `${result.succeeded.length ? `${result.succeeded.length} elemento(s) ${archiveActionTarget.operation === 'archive' ? 'verificados y archivados' : 'respaldados'} (${bytes(result.bytesProcessed)}).` : 'No se pudo completar ningún elemento de la tanda.'}${result.failed.length ? ` ${result.failed.length} quedaron sin tocar: ${result.failed.slice(0, 2).join(' · ')}${result.failed.length > 2 ? '…' : ''}` : ''}`
      } else {
        const result = await processDesktopArchiveCandidate(archiveActionTarget.items[0].id, archiveActionTarget.operation)
        if (!result) throw new Error('Archive sólo está disponible en FARO Desktop.')
        succeededIds = new Set([result.itemId])
        resultMessage = result.message
      }
      setSelected((current) => {
        const next = { ...current }
        succeededIds.forEach((id) => { delete next[id] })
        return next
      })
      setFeedback(resultMessage)
      setArchiveActionTarget(undefined)
      await refresh(false)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude completar el ciclo de Archive.')
    } finally {
      setProcessingArchiveAction(false)
    }
  }

  const runSafeUploadTest = async () => {
    setRunningSafeUploadTest(true)
    try {
      const result = await runDesktopArchiveSafeUploadTest()
      if (!result) throw new Error('La prueba de Archive sólo está disponible en FARO Desktop.')
      setFeedback(`Prueba segura verificada: ${result.message}`)
      const next = await getDesktopArchiveOverview()
      if (next) setArchive(next)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude completar la prueba segura de Google Drive.')
    } finally {
      setRunningSafeUploadTest(false)
    }
  }

  const restoreArchiveItem = async () => {
    if (!restoreTarget || restorePhrase.trim().toUpperCase() !== 'RESTAURAR') return
    setRestoringArchive(true)
    try {
      const result = await restoreDesktopArchiveItem(restoreTarget.id, restorePhrase)
      if (!result) throw new Error('Restaurar sólo está disponible en FARO Desktop.')
      setFeedback(result.message)
      setRestoreTarget(undefined)
      setRestorePhrase('')
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude restaurar ese archivo.')
    } finally {
      setRestoringArchive(false)
    }
  }

  const openArchiveRootFolder = async () => {
    try {
      if (!isFaroDesktop()) throw new Error('Abrir FARO Archive sólo está disponible en FARO Desktop.')
      await openDesktopArchiveRootFolder()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude abrir FARO Archive en Drive.')
    }
  }

  const openArchiveRemoteItem = async (item: ArchiveItemOverview) => {
    try {
      if (!isFaroDesktop()) throw new Error('Abrir este archivo sólo está disponible en FARO Desktop.')
      await openDesktopArchiveRemoteItem(item.id)
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude abrir este archivo en Google Drive.')
    }
  }

  const toggleArchivePurge = (item: FaroTrashItemOverview) => {
    if (!item.eligibleForPurge) return
    setArchivePurgeIds((current) => ({ ...current, [item.id]: !current[item.id] }))
  }

  const archivePurgeSelection = Object.entries(archivePurgeIds).filter(([, selected]) => selected).map(([id]) => id)

  const purgeArchiveTrash = async () => {
    if (archivePurgePhrase.trim().toUpperCase() !== 'ELIMINAR' || !archivePurgeSelection.length) return
    setPurgingArchive(true)
    try {
      const result = await purgeDesktopArchiveTrash(archivePurgeSelection, archivePurgePhrase)
      if (!result) throw new Error('La purga sólo está disponible en FARO Desktop.')
      setArchivePurgeIds({})
      setArchivePurgePhrase('')
      setArchiveReviewOpen(false)
      setFeedback(result.purgedCount
        ? `Eliminé permanentemente ${result.purgedCount} registro(s) de la Papelera FARO. Recuperaste ${bytes(result.reclaimedBytes)}.`
        : result.failed.length ? result.failed.slice(0, 2).join(' · ') : 'No había registros FARO elegibles para eliminar.')
      await refresh()
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'No pude purgar esos registros de FARO.')
    } finally {
      setPurgingArchive(false)
    }
  }

  const openArchiveReview = async () => {
    try {
      const next = await acknowledgeDesktopArchiveMonthlyReview()
      if (next) setArchive(next)
    } catch {
      // The review remains usable even when the acknowledgement cannot be
      // persisted; it simply appears again on the next launch.
    }
    setArchiveReviewOpen(true)
  }

  const desktopOnly = !isFaroDesktop()
  return <div className="page storage-page">
    <PageHeader
      eyebrow="FARO DESKTOP · ORDEN LOCAL"
      title="Espacio"
      description="Ve qué ocupa tu Mac y gestiona sólo lo que tú elijas."
      showDescription
      trailing={<div className="storage-header-actions">{overview?.scannedAt ? <span className="storage-header-actions__updated">Medido {new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(new Date(overview.scannedAt * 1000))}</span> : null}<Button variant={archive?.provider.connected ? 'secondary' : 'primary'} icon={<Cloud size={15} />} disabled={desktopOnly || connectingDrive || archive?.provider.oauthInProgress} onClick={() => { if (archive?.provider.configured && archive.provider.clientSecretConfigured) void connectGoogleDrive(); else openArchiveSetup() }}>{connectingDrive || archive?.provider.oauthInProgress ? 'Conectando Drive…' : archive?.provider.connected ? 'Drive conectado' : archive?.provider.configured ? (archive.provider.clientSecretConfigured ? 'Conectar Drive' : 'Agregar Secret') : 'Configurar Drive'}</Button><Button variant="secondary" icon={loading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} onClick={() => void refresh()} disabled={loading || desktopOnly}>Actualizar análisis</Button></div>}
    />

    {desktopOnly && <section className="storage-unavailable">
      <HardDrive size={25} />
      <div><span className="eyebrow">DISPONIBLE EN MAC</span><h2>Espacio vive en FARO Desktop.</h2><p>Esta sección analiza metadatos locales y usa la Papelera de macOS. Ábrela desde tu aplicación de escritorio para ver tu almacenamiento real.</p></div>
    </section>}

    {!desktopOnly && <>
      {error && <div className="storage-alert storage-alert--error"><AlertTriangle size={16} /><span>{error}</span><Button size="sm" variant="ghost" onClick={() => void refresh()}>Intentar de nuevo</Button></div>}
      {feedback && <div className="storage-alert storage-alert--feedback"><CheckCircle2 size={16} /><span>{feedback}</span><button type="button" aria-label="Cerrar mensaje" onClick={() => setFeedback('')}>×</button></div>}
      {trashFailures.length > 0 && <div className="storage-alert storage-alert--error storage-alert--details"><AlertTriangle size={16} /><div><strong>Detalles de la limpieza</strong><span>{trashFailures.slice(0, 4).join(' · ')}{trashFailures.length > 4 ? ` · y ${trashFailures.length - 4} más.` : ''}</span></div></div>}

      {!overview && !error && <section className="storage-loading"><LoaderCircle className="spin" size={22} /><strong>Preparando el mapa de tu almacenamiento…</strong><span>FARO sólo revisa nombres, rutas, tamaños y fechas; no lee el contenido de tus documentos.</span></section>}

      {overview && <>
        <section className={`storage-hero storage-hero--${storageTone}`}>
          <div className="storage-hero__disk"><HardDrive size={28} /></div>
          <div className="storage-hero__copy"><span>DISCO PRINCIPAL</span><strong>{bytes(overview.freeBytes)} libres</strong><small>de {bytes(overview.totalBytes)} en este Mac</small></div>
          <div className="storage-hero__status"><b>{Math.round(usedPercent)}%</b><span>en uso</span></div>
          <div className="storage-hero__bar" aria-label={`${Math.round(usedPercent)}% del disco en uso`}><i style={{ width: `${usedPercent}%` }} /></div>
          <p>{freePercent < 10 ? 'El espacio libre ya es bajo: revisa la cola antes de actualizar proyectos o instalar algo pesado.' : freePercent < 18 ? 'Te estás acercando a una zona de cuidado. FARO te muestra primero los candidatos más grandes.' : 'Tu disco tiene margen. El análisis te ayuda a conservarlo ordenado antes de que se vuelva un problema.'}</p>
        </section>

        <section className="storage-metrics" aria-label="Resumen de almacenamiento">
          <article><span>EN USO</span><strong>{bytes(overview.usedBytes)}</strong><small>{Math.round(usedPercent)}% del disco</small></article>
          <article><span>LIBRE</span><strong>{bytes(overview.freeBytes)}</strong><small>{Math.round(freePercent)}% disponible</small></article>
          <article><span>PARA REVISAR</span><strong>{bytes(reviewBytes)}</strong><small>{overview.candidates.length} elemento(s) sugerido(s)</small></article>
          <article><span>ANALIZADO</span><strong>{overview.scannedEntries.toLocaleString('es-MX')}</strong><small>{overview.scanLimited ? 'Escaneo protegido por límite' : 'Elementos revisados'}</small></article>
        </section>

        <section className="storage-panel storage-screenshot-cleaner">
          <header><div><span className="eyebrow">SMART CLEANER · CAPTURAS</span><h2>Capturas que siguen vivas en Finder</h2><p>“Recientes” sólo las reúne: no crea copias. FARO busca los archivos reales de más de 14 días en Escritorio, Descargas, Documentos y Fotos.</p></div><FileSearch size={19} /></header>
          <div className="storage-screenshot-cleaner__summary"><div><strong>{screenshotCandidates.length}</strong><span>capturas para revisar</span></div><div><strong>{bytes(screenshotBytes)}</strong><span>espacio potencial</span></div><p>Las recientes se conservan fuera de esta sugerencia. Puedes abrir cada una, archivarla con Drive cuando esté conectado o mandarla a la Papelera.</p><label className="storage-screenshot-cleaner__select-all"><input ref={screenshotSelectAllRef} type="checkbox" checked={allScreenshotsSelected} disabled={!screenshotCandidates.length || movingToTrash} onChange={toggleAllScreenshots} aria-label={allScreenshotsSelected ? 'Quitar selección de todas las capturas' : `Seleccionar todas las ${screenshotCandidates.length} capturas`} /><span>{allScreenshotsSelected ? 'Todas seleccionadas' : selectedScreenshotItems.length ? `${selectedScreenshotItems.length} seleccionadas` : `Seleccionar todas (${screenshotCandidates.length})`}</span></label>{archive?.provider.connected && <Button variant="secondary" size="sm" icon={<Archive size={14} />} disabled={!selectedScreenshotItems.length || processingArchiveAction} onClick={() => startArchiveActions(selectedScreenshotItems, 'archive')}>Archivar {selectedScreenshotItems.length ? `(${selectedScreenshotItems.length})` : ''}</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedScreenshotItems.length || movingToTrash} onClick={() => { replaceSelection(selectedScreenshotItems); setConfirmingTrash(true) }}>Papelera {selectedScreenshotItems.length ? `(${selectedScreenshotItems.length})` : ''}</Button></div>
          <div className="storage-screenshot-cleaner__list">
            {screenshotCandidates.slice(0, 8).map((screenshot) => <article key={screenshot.id} className={selected[screenshot.id] ? 'is-selected' : ''}>
              <label className="storage-candidate-list__select"><input type="checkbox" checked={Boolean(selected[screenshot.id])} onChange={() => toggle(selectionFor(screenshot))} /><span className="sr-only">Seleccionar {screenshot.name}</span></label>
              <div><strong>{screenshot.name}</strong><span>{screenshot.area} · sin cambios {screenshot.ageDays} días</span><small>{screenshot.path}</small></div>
              <b>{bytes(screenshot.bytes)}</b>
              <div className="storage-candidate-list__actions"><Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(screenshot.id)}>Finder</Button>{archive?.provider.connected && <Button variant="secondary" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(screenshot.id, screenshot.name, screenshot.bytes, 'archive')}>Archive</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([selectionFor(screenshot)]); setConfirmingTrash(true) }}>Papelera</Button></div>
            </article>)}
            {!screenshotCandidates.length && <div className="storage-empty"><CheckCircle2 size={17} /><span>No hay capturas antiguas detectadas en las rutas revisadas.</span></div>}
          </div>
        </section>

        <section className="storage-panel storage-intelligence">
          <header><div><span className="eyebrow">STORAGE INTELLIGENCE · V1</span><h2>¿Qué ocupa mi Mac?</h2><p>FARO separa lo que pudo medir de forma segura de la parte que macOS y APFS no exponen como archivos gestionables.</p></div><HardDrive size={19} /></header>
          <div className="storage-intelligence__headline">
            <div><span>COBERTURA DEL ANÁLISIS</span><strong>{bytes(overview.intelligence.classifiedBytes)} <small>de {bytes(overview.usedBytes)} usados</small></strong><p>{Math.round(percentage(overview.intelligence.classifiedBytes, overview.usedBytes))}% explicado con rutas locales acotadas.</p></div>
            <div><span>MARGEN OPERATIVO</span><strong className={overview.intelligence.bytesToOperatingMargin ? 'is-low' : 'is-good'}>{bytes(overview.freeBytes)}</strong><p>Objetivo: {bytes(overview.intelligence.minimumFreeBytes)} · {overview.intelligence.bytesToOperatingMargin ? `faltan ${bytes(overview.intelligence.bytesToOperatingMargin)} por liberar` : 'objetivo cubierto'}</p></div>
            <div><span>POTENCIAL A REVISAR</span><strong>{bytes(overview.intelligence.recoverableBytes)}</strong><p>Plan sugerido; FARO no ejecuta ninguna acción por sí solo.</p></div>
          </div>
          <div className="storage-intelligence__categories">
            {overview.intelligence.categories.map((category) => <button type="button" key={category.id} className={`${category.protected ? 'is-protected' : ''} ${category.managedByFaro ? 'is-actionable' : ''}`} onClick={() => inspectStorageCategory(category.id, category.name, category.protected)}>
              <div><strong>{category.name}</strong><span>{bytes(category.bytes)}</span></div>
              <i><b style={{ width: `${percentage(category.bytes, overview.usedBytes)}%` }} /></i>
              <small>{category.protected ? 'Protegido / no atribuible · por qué no se debe borrar' : category.managedByFaro ? 'Abrir detalle' : 'Sólo informativo'}{category.potentiallyRecoverableBytes ? ` · hasta ${bytes(category.potentiallyRecoverableBytes)} a revisar` : ''}{category.scanComplete ? '' : ' · vista parcial'}</small>
            </button>)}
          </div>
          <div className="storage-intelligence__footer">
            <span><ShieldCheck size={14} /> Gestionable: {bytes(overview.intelligence.manageableBytes)}</span>
            <span><HardDrive size={14} /> Otros / Sistema / APFS: {bytes(overview.intelligence.protectedBytes)}</span>
            <p>La diferencia no se distribuye artificialmente: puede incluir sistema, snapshots, metadatos y espacio administrado por APFS.</p>
          </div>
          {overview.intelligence.recoveryPlan.length > 0 && <div className="storage-recovery-plan"><div><span className="eyebrow">PARA RECUPERAR EL MARGEN</span><strong>Plan determinista, no automático.</strong></div>{overview.intelligence.recoveryPlan.map((step, index) => <article key={step.id}><b>{index + 1}</b><div><strong>{step.name}</strong><span>{step.reason}</span></div><small>{step.lifecycle === 'regenerate' ? 'Regenerar' : step.lifecycle === 'archive' ? 'Archivar' : 'Revisar'} · {bytes(step.bytes)}</small></article>)}</div>}
        </section>

        {overview.warnings.map((warning, index) => <div className="storage-alert storage-alert--warning" key={`${warning}-${index}`}><AlertTriangle size={15} /><span>{warning}</span></div>)}

        <div className="storage-grid">
          <section className="storage-panel storage-folders">
            <header><div><span className="eyebrow">MAPA LOCAL</span><h2>¿Dónde está el peso?</h2></div><FolderArchive size={18} /></header>
            <p className="storage-panel__description">Entra a una carpeta para ver sus archivos por tamaño, fecha y señales de revisión. Las rutas sensibles y los servicios del sistema se dejan fuera de esta primera vista.</p>
            <div className="storage-folder-list">
              {overview.folders.map((folder) => <button type="button" className="storage-folder-list__item" key={folder.id} onClick={() => openFolder(folder.id, folder.name)}>
                <div className="storage-folder-list__top"><div><FolderArchive size={15} /><strong>{folder.name}</strong></div><b>{bytes(folder.bytes)}</b></div>
                <div className="storage-folder-list__bar"><i style={{ width: `${percentage(folder.bytes, Math.max(...overview.folders.map((item) => item.bytes), 1))}%` }} /></div>
                <small>{folder.fileCount.toLocaleString('es-MX')} archivos {folder.scanComplete ? '' : '· vista parcial para mantener el Mac ágil'}</small><ChevronRight size={15} />
              </button>)}
              {!overview.folders.length && <p className="storage-empty">No encontré carpetas personales para revisar todavía.</p>}
            </div>
          </section>

          <aside className="storage-guidance">
            <Sparkles size={19} />
            <span className="eyebrow">CRITERIO, NO PILOTO AUTOMÁTICO</span>
            <h2>FARO prioriza; tú decides.</h2>
            <p>La lista usa tamaño, tipo de archivo y tiempo sin cambios. No asume que un archivo no sirve sólo por ser viejo.</p>
            <div><ShieldCheck size={15} /><span>Lo que gestiones aquí se mueve a la Papelera de macOS. Sólo los movimientos registrados por FARO pueden purgarse después, uno por uno.</span></div>
            <section className="storage-trash-control">
              <span className="eyebrow">PAPELERA FARO</span>
              <strong>{bytes(archive?.trash.trackedBytes ?? 0)}</strong>
              <small>{archive ? `${archive.trash.trackedCount.toLocaleString('es-MX')} registro(s) de FARO · ${archive.trash.eligibleCount} listos para cierre` : 'Cargando historial local…'}</small>
              <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!archive?.trash.trackedCount} onClick={() => void openArchiveReview()}>Revisar cierre</Button>
              <small className="storage-trash-control__mac">Papelera de macOS: {bytes(overview.trash.bytes)} · {overview.trash.fileCount.toLocaleString('es-MX')} elemento(s){overview.trash.scanComplete ? '' : ' · vista parcial'}</small>
            </section>
          </aside>
        </div>

        <section className="storage-panel storage-archive">
          <header>
            <div><span className="eyebrow">FARO ARCHIVE · CICLO DE VIDA</span><h2>Respalda, archiva o conserva con evidencia.</h2><p>FARO no copia secretos, no borra por antigüedad y nunca libera espacio local hasta que una copia se haya verificado.</p></div>
            <Archive size={19} />
          </header>
          <div className="storage-archive__content">
            <div className={`storage-archive__provider ${archive?.provider.connected ? 'is-connected' : ''}`}>
              <div className="storage-archive__provider-icon"><Cloud size={18} /></div>
              <div>
                <strong>{archive?.provider.provider ?? 'Google Drive'}</strong>
                <span>{archive?.provider.statusMessage ?? 'Leyendo la configuración local…'}</span>
                <small>Scope mínimo: <code>{archive?.provider.scope ?? 'https://www.googleapis.com/auth/drive.file'}</code>{archive?.provider.quotaUsedBytes !== null && archive?.provider.quotaUsedBytes !== undefined ? ` · Drive ${bytes(archive.provider.quotaUsedBytes)}${archive.provider.quotaLimitBytes ? ` de ${bytes(archive.provider.quotaLimitBytes)}` : ''}` : ''}</small>
              </div>
              <div className="storage-archive__provider-actions">
                {archive?.provider.connected && <Button variant="ghost" size="sm" disabled={runningSafeUploadTest} onClick={() => void runSafeUploadTest()}>{runningSafeUploadTest ? 'Verificando…' : 'Probar conexión'}</Button>}
                {archive?.provider.connected && <Button variant="ghost" size="sm" icon={<ExternalLink size={14} />} onClick={() => void openArchiveRootFolder()}>Abrir en Drive</Button>}
                {archive?.provider.configured && <Button variant="ghost" size="sm" icon={<Settings2 size={14} />} disabled={connectingDrive || archive?.provider.oauthInProgress} onClick={openArchiveSetup}>Editar configuración</Button>}
                <Button variant={archive?.provider.configured ? 'secondary' : 'primary'} size="sm" icon={<Settings2 size={14} />} disabled={connectingDrive || archive?.provider.oauthInProgress} onClick={() => { if (archive?.provider.configured && archive.provider.clientSecretConfigured) void connectGoogleDrive(); else openArchiveSetup() }}>{connectingDrive || archive?.provider.oauthInProgress ? 'Conectando…' : archive?.provider.configured ? (archive.provider.connected ? 'Reconectar' : archive.provider.clientSecretConfigured ? 'Conectar Drive' : 'Agregar Secret') : 'Configurar Drive'}</Button>
              </div>
            </div>
            <div className="storage-archive__metrics">
              <article><span>RESPALDADO</span><strong>{archive?.archive.backupCount ?? 0}</strong><small>{bytes(archive?.archive.bytesBackedUp ?? 0)} con copia remota</small></article>
              <article><span>ARCHIVADO</span><strong>{archive?.archive.archivedCount ?? 0}</strong><small>{bytes(archive?.archive.bytesArchived ?? 0)} verificados</small></article>
              <article><span>LIBERADO POR FARO</span><strong>{bytes(archive?.archive.localBytesFreedByFaro ?? 0)}</strong><small>Sólo movimientos locales reales</small></article>
              <article><span>PERIODO DE GRACIA</span><strong>{archive?.trash.graceDays ?? 3} días</strong><small>Sin purga automática</small></article>
            </div>
            {archive?.provider.connected && selectedArchiveItems.length > 0 && <section className="storage-archive__batch" aria-label="Tanda de FARO Archive"><div><strong>{selectedArchiveItems.length} elemento(s) preparados</strong><span>{bytes(selectedArchiveBytes)} · cada copia se verifica antes de mover cualquier original.</span></div><div><Button variant="ghost" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveActions(selectedArchiveItems, 'backup')}>Respaldar selección</Button><Button variant="secondary" size="sm" icon={<Archive size={14} />} disabled={processingArchiveAction} onClick={() => startArchiveActions(selectedArchiveItems, 'archive')}>Archivar selección</Button></div></section>}
            <div className="storage-archive__rules"><ShieldCheck size={15} /><span>{archive?.policy.rules[0] ?? 'Las políticas se están preparando localmente.'}</span><Clock3 size={15} /><span>{archive?.trash.monthlyReviewDue ? 'Tienes una revisión mensual de Papelera FARO pendiente.' : 'La revisión mensual se presentará cuando corresponda; nunca se purga sola.'}</span></div>
            {archive?.remoteItems.length ? <section className="storage-archive__recent" aria-label="Archivos de FARO Archive">
              <div className="storage-archive__recent-heading"><span className="eyebrow">COPIAS VERIFICADAS EN DRIVE</span><span>{archive.remoteItems.length} elemento(s) registrados</span><Button variant="ghost" size="sm" onClick={() => setArchiveInventoryOpen(true)}>Ver archivados</Button></div>
              {archive.remoteItems.slice(0, 3).map((item) => <article key={item.id}>
                <div><strong>{item.name}</strong><span>{item.remotePath ?? 'FARO Archive'} · {item.operation === 'archive' ? 'Archive' : 'Backup'} · {bytes(item.bytes)}</span></div>
                <div className="storage-archive__recent-actions"><Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => void openArchiveRemoteItem(item)}>Drive</Button>{item.restorable && <Button variant="ghost" size="sm" disabled={restoringArchive} onClick={() => { setRestoreTarget(item); setRestorePhrase('') }}>Restaurar</Button>}</div>
              </article>)}
            </section> : null}
          </div>
        </section>

        <nav className="storage-analysis-tabs" aria-label="Análisis profundo de almacenamiento">
          <button type="button" className={analysisTab === 'large' ? 'is-active' : ''} onClick={() => setAnalysisTab('large')}>Grandes</button>
          <button type="button" className={analysisTab === 'accumulation' ? 'is-active' : ''} onClick={() => setAnalysisTab('accumulation')}>Acumulación</button>
          <button type="button" className={analysisTab === 'applications' ? 'is-active' : ''} onClick={() => setAnalysisTab('applications')}>Aplicaciones</button>
          <button type="button" className={analysisTab === 'development' ? 'is-active' : ''} onClick={() => setAnalysisTab('development')}>Desarrollo</button>
        </nav>

        {analysisTab === 'applications' && <section className="storage-panel storage-apps">
          <header><div><span className="eyebrow">APLICACIONES</span><h2>Apps que ocupan espacio</h2><p>Revisa el tamaño del paquete y su actividad registrada antes de desinstalar o mover una app.</p></div><Box size={19} /></header>
          {overview.appsScanLimited && <div className="storage-alert storage-alert--warning storage-apps__notice"><AlertTriangle size={15} /><span>La vista de aplicaciones es parcial para mantener el análisis ligero. Actualiza cuando quieras revisar de nuevo.</span></div>}
          <div className="storage-apps__toolbar"><span>{overview.apps.length ? `${overview.apps.length} aplicaciones encontradas en Aplicaciones y ~/Aplicaciones.` : 'No hay aplicaciones para revisar.'}</span><Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedIds.length || movingToTrash} onClick={() => setConfirmingTrash(true)}>Mover selección {selectedIds.length ? `(${selectedIds.length})` : ''}</Button></div>
          <div className="storage-app-list">
            {overview.apps.map((app) => {
              const item = selectionFor(app, 'app')
              const protectedApp = app.classification === 'SYSTEM_PROTECTED'
              const activity = app.activityAgeDays === null || app.activityAgeDays === undefined
                ? 'Actividad no disponible en macOS'
                : app.activityAgeDays === 0 ? 'Actividad registrada hoy' : `Actividad registrada hace ${app.activityAgeDays} días`
              return <article key={app.id} className={selected[app.id] ? 'is-selected' : ''}>
                <label className="storage-candidate-list__select"><input type="checkbox" disabled={protectedApp} checked={Boolean(selected[app.id])} onChange={() => toggle(item)} /><span className="sr-only">Seleccionar {app.name}</span></label>
                <div className="storage-app-list__icon"><Box size={17} /></div>
                <div className="storage-app-list__copy"><strong>{app.name}</strong><span>{app.path}</span><small>{app.classification === 'SYSTEM_PROTECTED' ? 'Protegida por macOS' : app.classification === 'APPLE_REMOVABLE' ? 'App Apple removible' : activity} · Modificada {date(app.modifiedAt)}{app.scanComplete ? '' : ' · tamaño parcial'}</small></div>
                <div className="storage-candidate-list__meta"><b>{bytes(app.bytes)}</b><span>{protectedApp ? 'Protegida por macOS' : 'Paquete de aplicación'}</span></div>
                <div className="storage-candidate-list__actions">
                  <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(app.id)}>Finder</Button>
                  <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={protectedApp || movingToTrash} onClick={() => { replaceSelection([item]); setConfirmingTrash(true) }}>{protectedApp ? 'Protegida' : 'Papelera'}</Button>
                </div>
              </article>
            })}
            {!overview.apps.length && <div className="storage-empty storage-empty--large"><Box size={20} /><strong>No encontré apps instaladas en las carpetas revisadas.</strong><span>FARO revisa Aplicaciones y ~/Aplicaciones; no toca datos de sistema ni servicios internos.</span></div>}
          </div>
          <p className="storage-apps__footnote">Mover una app sólo manda su paquete a la Papelera. Si tiene desinstalador o datos propios, revísalos también desde Finder.</p>
        </section>}

        {analysisTab === 'accumulation' && <section className="storage-panel storage-accumulation">
          <header><div><span className="eyebrow">ACUMULACIÓN</span><h2>Pequeños archivos, peso colectivo</h2><p>FARO agrupa por tipo y contexto; no asume que algo sea basura sólo por ser viejo o pequeño.</p></div><Archive size={19} /></header>
          <div className="storage-accumulation__list">
            {overview.intelligence.accumulations.map((group) => <button type="button" key={group.id} className={selectedAccumulationId === group.id ? 'is-active' : ''} onClick={() => openAccumulationDetails(group)}>
              <div><strong>{group.name}</strong><span>{group.fileCount.toLocaleString('es-MX')} archivos · {group.oldestAgeDays ? `hasta ${group.oldestAgeDays} días sin cambios` : 'actualizados recientemente'}</span><small>{group.reason}</small></div>
              <b>{bytes(group.bytes)}</b><em>Riesgo {group.risk} · Ver detalle</em>
            </button>)}
            {!overview.intelligence.accumulations.length && <div className="storage-empty storage-empty--large"><CheckCircle2 size={20} /><strong>No detecté acumulaciones claras en las rutas revisadas.</strong><span>El análisis sigue siendo acotado y no lee el contenido de tus archivos.</span></div>}
          </div>
          {selectedAccumulation && <section id="storage-accumulation-detail" className="storage-accumulation__detail">
            <div className="storage-accumulation__detail-heading"><div><span className="eyebrow">DETALLE DE ACUMULACIÓN</span><h3>{selectedAccumulation.name}</h3><p>{selectedAccumulation.fileCount > selectedAccumulation.items.length ? `Mostrando los ${selectedAccumulation.items.length} archivos más pesados o antiguos de ${selectedAccumulation.fileCount.toLocaleString('es-MX')}.` : `${selectedAccumulation.items.length} archivo(s) identificados para revisar uno por uno.`}</p></div><Button variant="ghost" size="sm" onClick={() => setSelectedAccumulationId('')}>Cerrar detalle</Button></div>
            <div className="storage-accumulation__detail-toolbar"><span>{selectedAccumulationItems.length ? `${selectedAccumulationItems.length} seleccionado(s) · ${bytes(selectedAccumulationItems.reduce((sum, item) => sum + item.bytes, 0))}` : 'Abre en Finder antes de respaldar, archivar o mandar algo a Papelera.'}</span><div><Button variant="ghost" size="sm" disabled={!selectedAccumulation.items.length || movingToTrash} onClick={() => toggleMany(selectedAccumulation.items.map((item) => selectionFor(item)))}>{selectedAccumulation.items.every((item) => Boolean(selected[item.id])) ? 'Quitar selección' : `Seleccionar ${Math.min(selectedAccumulation.items.length, SELECTION_LIMIT)}`}</Button>{archive?.provider.connected && <Button variant="secondary" size="sm" icon={<Archive size={14} />} disabled={!selectedAccumulationItems.length || processingArchiveAction} onClick={() => startArchiveActions(selectedAccumulationItems, 'archive')}>Archivar selección</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedAccumulationItems.length || movingToTrash} onClick={() => { replaceSelection(selectedAccumulationItems); setConfirmingTrash(true) }}>Mover a Papelera</Button></div></div>
            <div className="storage-accumulation__detail-list">
              {selectedAccumulation.items.map((item) => <article key={item.id} className={selected[item.id] ? 'is-selected' : ''}>
                <label className="storage-candidate-list__select"><input type="checkbox" checked={Boolean(selected[item.id])} onChange={() => toggle(selectionFor(item))} /><span className="sr-only">Seleccionar {item.name}</span></label>
                <div><strong>{item.name}</strong><span>{item.kind} · {item.area} · sin cambios {item.ageDays} días</span><small>{item.path}</small></div>
                <b>{bytes(item.bytes)}</b>
                <div className="storage-candidate-list__actions"><Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(item.id)}>Finder</Button>{archive?.provider.connected && <Button variant="ghost" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(item.id, item.name, item.bytes, 'backup')}>Backup</Button>}{archive?.provider.connected && <Button variant="secondary" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(item.id, item.name, item.bytes, 'archive')}>Archive</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([selectionFor(item)]); setConfirmingTrash(true) }}>Papelera</Button></div>
              </article>)}
            </div>
          </section>}
        </section>}

        {analysisTab === 'development' && <section className="storage-panel storage-development">
          <header><div><span className="eyebrow">DESARROLLO</span><h2>Artefactos regenerables por proyecto</h2><p>Dependencias, builds y cachés pueden recuperarse con instalación o build. Código fuente, .git, .env y rutas sensibles quedan fuera.</p></div><Box size={19} /></header>
          <div className="storage-apps__toolbar"><span>{developmentItems.length ? `${developmentItems.length} artefacto(s) · ${bytes(developmentItems.reduce((sum, item) => sum + item.bytes, 0))} potencialmente recuperables.` : 'No hay artefactos regenerables detectados.'}</span><div className="storage-review__actions"><Button variant="ghost" size="sm" disabled={!developmentItems.length || movingToTrash} onClick={() => toggleMany(developmentItems)}>{allDevelopmentSelected ? 'Quitar selección' : `Seleccionar ${Math.min(developmentItems.length, SELECTION_LIMIT)}`}</Button><Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedDevelopmentItems.length || movingToTrash} onClick={() => { replaceSelection(selectedDevelopmentItems); setConfirmingTrash(true) }}>Papelera {selectedDevelopmentItems.length ? `(${selectedDevelopmentItems.length})` : ''}</Button></div></div>
          <div className="storage-development__list">
            {overview.intelligence.development.map((artifact) => { const item = selectionFor(artifact, 'carpeta'); return <article key={artifact.id} className={selected[artifact.id] ? 'is-selected' : ''}>
              <label className="storage-candidate-list__select"><input type="checkbox" checked={Boolean(selected[artifact.id])} onChange={() => toggle(item)} /><span className="sr-only">Seleccionar {artifact.name}</span></label>
              <div><strong>{artifact.project} · {artifact.name}</strong><span>{artifact.kind} · Regenerable {artifact.scanComplete ? '' : '· medición parcial'}</span><small>{artifact.path}</small></div>
              <b>{bytes(artifact.bytes)}</b><div className="storage-candidate-list__actions"><Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(artifact.id)}>Finder</Button><Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([item]); setConfirmingTrash(true) }}>Papelera</Button></div>
            </article> })}
            {!overview.intelligence.development.length && <div className="storage-empty storage-empty--large"><CheckCircle2 size={20} /><strong>No encontré artefactos regenerables en las rutas de proyecto revisadas.</strong><span>FARO mira Developer, Projects, Code y Escritorio cuando existen; no toca fuentes ni configuración.</span></div>}
          </div>
        </section>}

        {analysisTab === 'large' && <section className="storage-panel storage-review">
          <header><div><span className="eyebrow">COLA DE LIMPIEZA</span><h2>Grandes y para revisar</h2><p>Abre cada elemento en Finder antes de tomar una decisión.</p></div><FileSearch size={19} /></header>
          <div className="storage-review__toolbar">
            <span>{overview.candidates.length ? `${overview.candidates.length} candidatos · ${bytes(reviewBytes)} potencialmente recuperable` : 'No encontramos archivos obvios para revisar en estas carpetas.'}</span>
            <div className="storage-review__actions">
              <Button variant="ghost" size="sm" disabled={!allCandidateIds.length || movingToTrash} onClick={() => toggleMany(overview.candidates.map((candidate) => selectionFor(candidate)))}>{allCandidatesSelected ? 'Quitar selección' : `Seleccionar ${allCandidateIds.length}`}</Button>
              {archive?.provider.connected && <Button variant="secondary" size="sm" icon={<Archive size={14} />} disabled={!selectedArchiveItems.length || processingArchiveAction} onClick={() => startArchiveActions(selectedArchiveItems, 'archive')}>Archivar selección</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedIds.length || movingToTrash} onClick={() => setConfirmingTrash(true)}>Mover {selectedIds.length ? `${selectedIds.length} a Papelera` : 'a Papelera'}</Button>
            </div>
          </div>
          <div className="storage-candidate-list">
            {overview.candidates.map((candidate) => <article key={candidate.id} className={selected[candidate.id] ? 'is-selected' : ''}>
              <label className="storage-candidate-list__select"><input type="checkbox" checked={Boolean(selected[candidate.id])} onChange={() => toggle(selectionFor(candidate))} /><span className="sr-only">Seleccionar {candidate.name}</span></label>
              <div className="storage-candidate-list__icon"><FileSearch size={16} /></div>
              <div className="storage-candidate-list__copy"><div><strong>{candidate.name}</strong><span>{candidate.kind} · {candidate.area}</span></div><p>{candidate.reason}</p><small>{candidate.path}</small></div>
              <div className="storage-candidate-list__meta"><b>{bytes(candidate.bytes)}</b><span>{candidate.ageDays ? `Sin cambios ${candidate.ageDays} días` : 'Modificado hoy'}</span><small>{date(candidate.modifiedAt)}</small></div>
              <div className="storage-candidate-list__actions">
                <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(candidate.id)}>Ver en Finder</Button>
                {archive?.provider.connected && <Button variant="ghost" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(candidate.id, candidate.name, candidate.bytes, 'backup')}>Backup</Button>}
                {archive?.provider.connected && <Button variant="secondary" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(candidate.id, candidate.name, candidate.bytes, 'archive')}>Archive</Button>}
                <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([selectionFor(candidate)]); setConfirmingTrash(true) }}>Papelera</Button>
              </div>
            </article>)}
            {!overview.candidates.length && <div className="storage-empty storage-empty--large"><CheckCircle2 size={20} /><strong>No hay candidatos evidentes.</strong><span>Eso no significa que no haya nada que ordenar: sólo que FARO no encontró archivos grandes y antiguos en las carpetas revisadas.</span></div>}
          </div>
        </section>}
      </>}
    </>}

    <ConfirmDialog
      open={confirmingTrash}
      title={`¿Mover ${selectedIds.length} elemento${selectedIds.length === 1 ? '' : 's'} a la Papelera?`}
      description={`Liberarás aproximadamente ${bytes(selectedBytes)}. Se moverán a la Papelera de macOS, no se eliminarán de forma permanente. Podrás restaurarlos desde Finder si cambias de opinión.${selectedItems.some((item) => item.type === 'app') ? ' Si hay apps, se moverá sólo el paquete de la aplicación; sus datos pueden vivir en otra ruta.' : ''}${selectedItems.some((item) => item.type === 'carpeta') ? ' Las carpetas seleccionadas se moverán completas: la app correspondiente puede reiniciarse, cerrar sesión o volver a descargar datos.' : ''}`}
      confirmLabel={movingToTrash ? 'Moviendo…' : 'Mover a Papelera'}
      onClose={() => !movingToTrash && setConfirmingTrash(false)}
      onConfirm={() => void moveSelectionToTrash()}
    />

    <Modal open={Boolean(browser || browserLoading)} title={browser ? `Explorar ${browserLocation?.label ?? browser.rootName}` : 'Abriendo carpeta'} onClose={() => { browserRequest.current += 1; setBrowserLoading(false); setBrowser(undefined); setBrowserLocation(undefined); setBrowserTrail([]) }} panelClassName="storage-explorer-dialog">
      {browserLoading && !browser && <div className="storage-loading storage-explorer-loading"><LoaderCircle className="spin" size={21} /><strong>Midiendo la carpeta…</strong><span>FARO ordenará primero los elementos más pesados sin leer su contenido.</span></div>}
      {browser && <>
        <div className="storage-explorer__toolbar">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} disabled={!browserTrail.length || browserLoading} onClick={goBackInBrowser}>Atrás</Button>
          <div><strong>{browserLocation?.label ?? browser.rootName}</strong><span>{browser.path}</span></div>
          <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void revealFolder()}>Finder</Button>
        </div>
        <p className="storage-explorer__description">{browser.scanComplete ? `${browser.entries.length} elementos ordenados por tamaño.` : `Vista parcial: FARO revisó ${browser.scannedEntries.toLocaleString('es-MX')} elementos para no frenar tu Mac.`} {browser.canManage ? 'Puedes seleccionar archivos y carpetas de primer nivel para respaldarlos o archivarlos. Una carpeta sólo pasa a la Papelera cuando cada archivo de su copia remota quedó verificado.' : browser.canManageFolders ? 'Puedes seleccionar carpetas de primer nivel para moverlas completas a la Papelera. No se archivan: borrar datos de una app puede reiniciarla o cerrar su sesión.' : 'Esta ruta se muestra para entender el consumo; por seguridad FARO sólo permite abrirla en Finder, no borrar ni archivar su contenido desde aquí.'}</p>
        {browser.canManage && browserSuggestedEntries.length > 0 && <div className="storage-explorer__suggestion"><div><Sparkles size={15} /><span>{browserSuggestedEntries.length} archivo(s) tienen señales para revisar: tamaño, tipo o tiempo sin cambios.</span></div><Button variant="ghost" size="sm" disabled={movingToTrash} onClick={() => toggleMany(browserSuggestedEntries.map((entry) => selectionFor(entry)))}>{browserSuggestedSelected ? 'Quitar selección sugerida' : 'Seleccionar sugeridos'}</Button></div>}
        {(browser.canManage || browser.canManageFolders) && <div className="storage-explorer__selection"><span>{selectedIds.length ? `${selectedIds.length} elemento(s) seleccionado(s) · ${bytes(selectedBytes)}` : browser.canManageFolders && !browser.canManage ? 'Selecciona carpetas completas para preparar una tanda de limpieza.' : 'Selecciona archivos o carpetas para preparar una tanda de limpieza.'}</span><div>{archive?.provider.connected && <Button variant="secondary" size="sm" icon={<Archive size={14} />} disabled={!selectedArchiveItems.length || processingArchiveAction} onClick={() => startArchiveActions(selectedArchiveItems, 'archive')}>Archivar selección</Button>}<Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={!selectedIds.length || movingToTrash} onClick={() => setConfirmingTrash(true)}>Mover a Papelera</Button></div></div>}
        <div className="storage-explorer-list">
          {browser.entries.slice(0, browserVisibleCount).map((entry) => {
            const item = selectionFor(entry, entry.isDirectory ? 'carpeta' : 'archivo')
            const canSelectEntry = entry.canMoveToTrash && (entry.isDirectory ? browser.canManageFolders : browser.canManage)
            return <article key={entry.id} className={`${entry.isDirectory ? 'is-directory' : ''} ${selected[entry.id] ? 'is-selected' : ''}`}>
              {!canSelectEntry ? <span className="storage-explorer-list__spacer" /> : <label className="storage-candidate-list__select"><input type="checkbox" checked={Boolean(selected[entry.id])} onChange={() => toggle(item)} /><span className="sr-only">Seleccionar {entry.name}</span></label>}
              <div className="storage-explorer-list__icon">{entry.isDirectory ? <FolderArchive size={16} /> : <FileSearch size={16} />}</div>
              <div className="storage-explorer-list__copy"><strong>{entry.name}</strong><span>{entry.isDirectory ? `${entry.fileCount.toLocaleString('es-MX')} archivos${entry.scanComplete ? '' : ' · vista parcial'}` : `${entry.kind} · ${entry.ageDays ? `sin cambios ${entry.ageDays} días` : 'modificado hoy'}`}</span><small>{entry.suggestedReason ?? entry.path}</small></div>
              <div className="storage-candidate-list__meta"><b>{bytes(entry.bytes)}</b><span>{date(entry.modifiedAt)}</span></div>
              <div className="storage-candidate-list__actions">
                {entry.isDirectory ? <><Button variant="ghost" size="sm" icon={<ChevronRight size={14} />} disabled={browserLoading} onClick={() => openBrowserEntry(entry)}>Abrir</Button>{canSelectEntry && archive?.provider.connected && <Button variant="ghost" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(entry.id, entry.name, entry.bytes, 'backup', 'carpeta')}>Backup</Button>}{canSelectEntry && archive?.provider.connected && <Button variant="secondary" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(entry.id, entry.name, entry.bytes, 'archive', 'carpeta')}>Archive</Button>}{canSelectEntry && <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([item]); setConfirmingTrash(true) }}>Papelera</Button>}</> : <>
                  <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void reveal(entry.id)}>Finder</Button>
                  {browser.canManage && archive?.provider.connected && <Button variant="ghost" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(entry.id, entry.name, entry.bytes, 'backup')}>Backup</Button>}
                  {browser.canManage && archive?.provider.connected && <Button variant="secondary" size="sm" disabled={processingArchiveAction} onClick={() => startArchiveAction(entry.id, entry.name, entry.bytes, 'archive')}>Archive</Button>}
                  {browser.canManage && <Button variant="danger" size="sm" icon={<Trash2 size={14} />} disabled={movingToTrash} onClick={() => { replaceSelection([item]); setConfirmingTrash(true) }}>Papelera</Button>}
                </>}
              </div>
            </article>
          })}
          {browserVisibleCount < browser.entries.length && <Button variant="ghost" onClick={() => setBrowserVisibleCount((count) => count + 80)}>Mostrar más archivos ({Math.min(browserVisibleCount, browser.entries.length)} de {browser.entries.length})</Button>}
          {!browser.entries.length && <div className="storage-empty storage-empty--large"><FolderOpen size={20} /><strong>Esta carpeta está vacía o no se puede mostrar.</strong><span>FARO no incluye enlaces simbólicos ni rutas internas protegidas en esta vista.</span></div>}
        </div>
      </>}
    </Modal>

    <Modal open={archiveInventoryOpen} title="Archivos verificados en FARO Archive" onClose={() => setArchiveInventoryOpen(false)} panelClassName="storage-archive-dialog storage-archive-inventory-dialog">
      <p className="modal-description">Esta lista muestra las copias que FARO creó y verificó en esta cuenta de Drive. Cada una conserva su ruta local de origen sólo en este Mac; los archivos se restauran sin sobrescribir. Las carpetas se abren en Drive con su estructura conservada.</p>
      <div className="storage-archive-inventory">
        {archive?.remoteItems.map((item) => <article key={item.id}>
          <div><strong>{item.name}</strong><span>{item.remotePath ?? 'FARO Archive'} · {bytes(item.bytes)} · verificado {date(item.verifiedAt ?? 0)}</span><small>{item.isDirectory ? `Carpeta en Drive: ${item.status === 'archived' ? 'el original sigue recuperable en la Papelera FARO hasta su cierre.' : 'el original local se conserva.'}` : item.status === 'archived' ? 'Archivado: el original sigue recuperable en la Papelera FARO hasta su cierre.' : 'Backup: el original local se conserva.'}</small></div>
          <div className="storage-archive-inventory__actions"><Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => void openArchiveRemoteItem(item)}>Drive</Button>{item.restorable && <Button variant="primary" size="sm" disabled={restoringArchive} onClick={() => { setArchiveInventoryOpen(false); setRestoreTarget(item); setRestorePhrase('') }}>Restaurar</Button>}</div>
        </article>)}
        {!archive?.remoteItems.length && <div className="storage-empty storage-empty--large"><Cloud size={20} /><strong>Aún no hay copias verificadas en FARO Archive.</strong><span>Cuando hagas Backup o Archive desde una recomendación, aparecerá aquí con su ruta y restauración segura.</span></div>}
      </div>
      <div className="modal-actions"><Button variant="ghost" onClick={() => setArchiveInventoryOpen(false)}>Cerrar</Button>{archive?.provider.connected && <Button variant="secondary" icon={<ExternalLink size={14} />} onClick={() => void openArchiveRootFolder()}>Abrir FARO Archive</Button>}</div>
    </Modal>

    <Modal open={archiveSetupOpen} title="Configurar FARO Archive con Google Drive" onClose={() => !savingArchiveConfig && setArchiveSetupOpen(false)} panelClassName="storage-archive-dialog">
      <div className="storage-archive-dialog__intro"><Cloud size={19} /><p>FARO usa una cuenta de Drive dedicada y pedirá únicamente <code>drive.file</code>: podrá crear y gestionar los archivos que FARO mismo cree, no leer todo tu Drive.</p></div>
      <ol className="storage-archive-dialog__steps"><li>En Google Cloud crea un OAuth Client ID de tipo <strong>Desktop app</strong>.</li><li>Habilita Google Drive API y añade tu cuenta FaroOs como usuario de prueba si el proyecto sigue en Testing.</li><li>Pega el <strong>Client ID</strong> y el <strong>Client Secret</strong> emitidos para ese mismo cliente. El secreto se guarda sólo en el Llavero de macOS y nunca se muestra ni se escribe en el historial de FARO.</li></ol>
      {archive?.provider.configured && !archive.provider.clientSecretConfigured && <p className="storage-archive-dialog__note"><strong>Falta el Secret.</strong> Tu Client ID ya está cargado. Pega el Client Secret que aparece junto a ese mismo OAuth Client de Google y guarda; no hace falta abrir la Terminal.</p>}
      <label>Google OAuth Client ID<input value={archiveClientId} onChange={(event) => setArchiveClientId(event.target.value)} placeholder="123…apps.googleusercontent.com" autoComplete="off" /></label>
      <label>Google OAuth Client Secret<input value={archiveClientSecret} onChange={(event) => setArchiveClientSecret(event.target.value)} placeholder={archive?.provider.clientSecretConfigured ? 'Guardado en el Llavero de macOS · deja vacío para conservarlo' : 'GOCSPX-…'} type="password" autoComplete="off" /></label>
      <p className="storage-archive-dialog__note">FARO abrirá el navegador del sistema y reservará un puerto <strong>127.0.0.1</strong> distinto en cada conexión; no registramos un callback fijo ni usamos WebView. Al autorizar, FARO creará o reutilizará <strong>FARO Archive</strong> y sus carpetas Personal, Work, Projects, Learning y Unclassified. Los tokens y el secreto quedan en el Llavero de macOS, nunca en Supabase ni en este formulario. La página del navegador confirma que recibió el código; FARO confirma la conexión sólo después de intercambiarlo y verificar Drive.</p>
      <div className="modal-actions"><Button variant="ghost" disabled={savingArchiveConfig} onClick={() => setArchiveSetupOpen(false)}>Cancelar</Button><Button variant="primary" disabled={!archiveClientId.trim() || (!archiveClientSecret.trim() && !archive?.provider.clientSecretConfigured) || savingArchiveConfig} onClick={() => void saveArchiveConfig()}>{savingArchiveConfig ? 'Guardando…' : 'Guardar y conectar'}</Button></div>
    </Modal>

    <Modal open={Boolean(archiveActionTarget)} title={archiveActionTarget?.operation === 'archive' ? 'Verificar y archivar' : 'Crear Backup verificado'} onClose={() => !processingArchiveAction && setArchiveActionTarget(undefined)} panelClassName="storage-archive-dialog">
      {archiveActionTarget && <>
        <p className="modal-description">{archiveActionTarget.items.length === 1 ? <><strong>{archiveActionTarget.items[0].name}</strong> · {bytes(archiveActionTarget.items[0].bytes)}</> : <><strong>{archiveActionTarget.items.length} elementos seleccionados</strong> · {bytes(archiveActionTarget.items.reduce((sum, item) => sum + item.bytes, 0))}</>}</p>
        {archiveActionTarget.items.some((item) => item.type === 'carpeta') && <p className="storage-archive-dialog__note">Las carpetas se crean con la misma estructura en FARO Archive. FARO revisa todos sus archivos, verifica cada copia y sólo mueve la carpeta local completa cuando la tanda terminó sin cambios ni omisiones.</p>}
        {archiveActionTarget.items.length > 1 && <p className="storage-archive-dialog__note">FARO procesará esta tanda en orden. Si un elemento falla, los demás continúan; cada original se conserva hasta que su propia copia quede verificada.</p>}
        {archiveActionTarget.operation === 'archive'
          ? <p className="storage-archive-dialog__note">FARO subirá el elemento a la carpeta adecuada de Google Drive y verificará nombre, tamaño y hash. Sólo si todo coincide moverá el original a la Papelera FARO de macOS; nunca se elimina permanentemente en este paso.</p>
          : <p className="storage-archive-dialog__note">FARO subirá una copia a Google Drive y verificará nombre, tamaño y hash. El original local se conservará tal como está.</p>}
        {processingArchiveAction && archiveProgress && <div className="storage-archive-progress" role="status" aria-live="polite" style={{ display: 'grid', gap: 7, marginTop: 13, padding: 11, border: '1px solid #2c548a', borderRadius: 9, background: 'linear-gradient(100deg,rgba(30,91,181,.18),rgba(9,20,35,.72))' }}><div style={{ display: 'grid', gap: 3, minWidth: 0 }}><strong style={{ color: '#e7f0ff', fontSize: 10, fontWeight: 600 }}>{archiveProgress.phase === 'scanning' ? 'Preparando la estructura…' : archiveProgress.phase === 'uploading' ? 'Subiendo a Drive…' : archiveProgress.phase === 'verifying' ? 'Verificando copia…' : archiveProgress.phase === 'movingToTrash' ? 'Moviendo original a Papelera…' : archiveProgress.phase === 'complete' ? 'Copia terminada' : 'Revisando resultado…'}</strong><span style={{ overflow: 'hidden', color: '#91a9c7', fontSize: 8, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{archiveProgress.itemName}{archiveProgress.currentPath ? ` · ${archiveProgress.currentPath}` : ''}</span></div><small style={{ color: '#91a9c7', fontSize: 8 }}>{archiveProgress.totalFiles ? `${archiveProgress.completedFiles} de ${archiveProgress.totalFiles} archivos · ${bytes(archiveProgress.bytesCompleted)} de ${bytes(archiveProgress.totalBytes)}` : 'Contando archivos y comprobando que la carpeta sea segura…'}</small><i style={{ display: 'block', height: 5, overflow: 'hidden', borderRadius: 999, background: '#142943' }}><b style={{ display: 'block', height: '100%', minWidth: 6, borderRadius: 'inherit', width: `${archiveProgress.totalBytes ? percentage(archiveProgress.bytesCompleted, archiveProgress.totalBytes) : 8}%`, background: 'linear-gradient(90deg,#347cff,#70b8ff)', transition: 'width .22s ease' }} /></i></div>}
        <div className="modal-actions"><Button variant="ghost" disabled={processingArchiveAction} onClick={() => setArchiveActionTarget(undefined)}>Cancelar</Button><Button variant={archiveActionTarget.operation === 'archive' ? 'secondary' : 'primary'} disabled={processingArchiveAction} onClick={() => void processArchiveAction()}>{processingArchiveAction ? 'Verificando…' : archiveActionTarget.operation === 'archive' ? `Subir y archivar${archiveActionTarget.items.length > 1 ? ` ${archiveActionTarget.items.length}` : ''}` : `Crear Backup${archiveActionTarget.items.length > 1 ? ` ${archiveActionTarget.items.length}` : ''}`}</Button></div>
      </>}
    </Modal>

    <Modal open={Boolean(restoreTarget)} title="Restaurar archivo verificado" onClose={() => { if (!restoringArchive) { setRestoreTarget(undefined); setRestorePhrase('') } }} panelClassName="storage-archive-dialog">
      {restoreTarget && <>
        <p className="modal-description">FARO descargará <strong>{restoreTarget.name}</strong> en su ruta original sólo si no existe otro archivo ahí. Verificará tamaño y hash antes de terminar.</p>
        <label>Escribe <strong>RESTAURAR</strong> para confirmar<input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} placeholder="RESTAURAR" autoComplete="off" /></label>
        <div className="modal-actions"><Button variant="ghost" disabled={restoringArchive} onClick={() => setRestoreTarget(undefined)}>Cancelar</Button><Button variant="primary" disabled={restorePhrase.trim().toUpperCase() !== 'RESTAURAR' || restoringArchive} onClick={() => void restoreArchiveItem()}>{restoringArchive ? 'Restaurando…' : 'Restaurar archivo'}</Button></div>
      </>}
    </Modal>

    <Modal open={archiveReviewOpen} title="Cierre de Papelera FARO" onClose={() => { if (!purgingArchive) { setArchiveReviewOpen(false); setArchivePurgeIds({}); setArchivePurgePhrase('') } }} panelClassName="storage-archive-dialog storage-archive-review-dialog">
      <p className="modal-description">Aquí sólo aparecen elementos que FARO movió a la Papelera. Los que aún están en gracia se pueden restaurar desde Finder, pero no se pueden eliminar permanentemente desde FARO.</p>
      <div className="storage-archive-review-list">
        {archive?.trash.items.map((item) => <label key={item.id} className={!item.eligibleForPurge ? 'is-waiting' : ''}>
          <input type="checkbox" checked={Boolean(archivePurgeIds[item.id])} disabled={!item.eligibleForPurge || purgingArchive} onChange={() => toggleArchivePurge(item)} />
          <div><strong>{item.name}</strong><span>{bytes(item.bytes)} · movido {date(item.movedAt)}</span><small>{item.eligibleForPurge ? 'Listo para cierre permanente' : `Protegido hasta ${date(item.graceEndsAt)}`}</small></div>
        </label>)}
        {!archive?.trash.items.length && <div className="storage-empty storage-empty--large"><CheckCircle2 size={20} /><strong>No hay movimientos de FARO en la Papelera.</strong><span>FARO nunca lista ni borra los archivos que otra app o Finder haya puesto ahí.</span></div>}
      </div>
      {archivePurgeSelection.length > 0 && <label className="storage-archive-review-confirm">Escribe <strong>ELIMINAR</strong> para borrar permanentemente {archivePurgeSelection.length} registro(s)<input value={archivePurgePhrase} onChange={(event) => setArchivePurgePhrase(event.target.value)} placeholder="ELIMINAR" autoComplete="off" /></label>}
      <div className="modal-actions"><Button variant="ghost" disabled={purgingArchive} onClick={() => setArchiveReviewOpen(false)}>Cerrar</Button><Button variant="danger" disabled={!archivePurgeSelection.length || archivePurgePhrase.trim().toUpperCase() !== 'ELIMINAR' || purgingArchive} onClick={() => void purgeArchiveTrash()}>{purgingArchive ? 'Eliminando…' : 'Eliminar seleccionados'}</Button></div>
    </Modal>
  </div>
}
