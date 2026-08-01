import { DatabaseBackup, Download, RefreshCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { Button, ConfirmDialog, Modal } from '../components/common'
import { PageHeader } from '../components/layout'
import { usePageCapture } from '../hooks/usePageCapture'
import { createBackup, parseBackup } from '../lib/backup'
import { useFaroStore } from '../store'

export function SettingsPage() {
  const { capture } = usePageCapture()
  const inputRef = useRef<HTMLInputElement>(null)
  const replaceData = useFaroStore((state) => state.replaceData)
  const restoreDemoData = useFaroStore((state) => state.restoreDemoData)
  const clearAllData = useFaroStore((state) => state.clearAllData)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const exportData = () => {
    const backup = createBackup(useFaroStore.getState())
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `faro-os-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setFeedback({ type: 'success', message: 'Respaldo exportado correctamente.' })
  }

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const backup = parseBackup(await file.text())
      replaceData(backup.data)
      setFeedback({ type: 'success', message: `Respaldo del ${new Date(backup.exportedAt).toLocaleDateString('es-MX')} importado.` })
    } catch (error) {
      setFeedback({ type: 'error', message: error instanceof Error ? error.message : 'No pudimos importar el respaldo.' })
    } finally {
      event.target.value = ''
    }
  }

  return <div className="page settings-page"><PageHeader eyebrow="Sistema" title="Configuración" description="Tus datos, tus decisiones." onCapture={capture} />
    {feedback && <div className={`settings-feedback settings-feedback--${feedback.type}`} role="status">{feedback.message}<button onClick={() => setFeedback(null)} aria-label="Cerrar mensaje">×</button></div>}
    <section className="settings-intro"><ShieldCheck /><div><h2>FARO protege cada capa.</h2><p>Supabase conserva los módulos conectados y el respaldo JSON protege el estado local restante. Las claves privadas viven sólo en funciones del servidor.</p></div></section>
    <section className="settings-group"><div className="settings-group__head"><DatabaseBackup /><div><h2>Respaldo y portabilidad</h2><p>Exporta todo FARO como JSON o recupera un respaldo validado.</p></div></div><div className="settings-actions"><div><strong>Exportar respaldo</strong><span>Incluye objetivos, tareas y todos tus registros personales.</span><Button variant="secondary" icon={<Download size={15} />} onClick={exportData}>Exportar JSON</Button></div><div><strong>Importar respaldo</strong><span>Reemplaza los datos actuales sólo si el archivo es válido.</span><input ref={inputRef} className="sr-only" type="file" accept="application/json,.json" onChange={importData} /><Button variant="secondary" icon={<Upload size={15} />} onClick={() => inputRef.current?.click()}>Elegir archivo</Button></div></div></section>
    <section className="settings-group"><div className="settings-group__head"><RefreshCcw /><div><h2>Datos de demostración</h2><p>Restaura la experiencia inicial de Uriel para explorar FARO.</p></div></div><div className="settings-single"><span>Esta acción reemplazará todos tus datos actuales.</span><Button variant="secondary" onClick={() => setRestoreOpen(true)}>Restaurar demo</Button></div></section>
    <section className="settings-group settings-danger"><div className="settings-group__head"><Trash2 /><div><h2>Borrar todos los datos</h2><p>Vacía las colecciones locales. Esta acción no se puede deshacer.</p></div></div><div className="settings-single"><span>Exporta un respaldo antes de continuar.</span><Button variant="danger" onClick={() => { setDeletePhrase(''); setDeleteOpen(true) }}>Borrar datos</Button></div></section>
    <ConfirmDialog open={restoreOpen} title="Restaurar datos demo" description="Tus datos actuales serán reemplazados por el conjunto de demostración." onClose={() => setRestoreOpen(false)} onConfirm={() => { restoreDemoData(); setRestoreOpen(false); setFeedback({ type: 'success', message: 'Datos demo restaurados.' }) }} />
    {deleteOpen && <Modal open title="Confirmación reforzada" onClose={() => setDeleteOpen(false)}><div className="reinforced-confirm"><p>Escribe <strong>BORRAR FARO</strong> para eliminar todos los datos locales.</p><label>Frase de confirmación<input autoFocus value={deletePhrase} onChange={(event) => setDeletePhrase(event.target.value)} /></label><div className="modal-actions"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button variant="danger" disabled={deletePhrase !== 'BORRAR FARO'} onClick={() => { clearAllData(); setDeleteOpen(false); setFeedback({ type: 'success', message: 'Todos los datos fueron eliminados.' }) }}>Borrar definitivamente</Button></div></div></Modal>}
  </div>
}
