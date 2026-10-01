import { FolderPlus, MonitorCog, Plus, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { defaultComputerConfig, type ComputerConfig, type ProjectRegistryEntry } from '../features/computer/computerTypes'
import { startSilentConcentration } from '../features/computer/computerController'
import { getComputerConfig, updateComputerConfig } from './desktopBridge'

const cleanUrls = (value: string) => value.split(/\n|,/).map((item) => item.trim()).filter((item) => /^https:\/\//.test(item))

export function ComputerSettings() {
  const [config, setConfig] = useState<ComputerConfig>()
  const [message, setMessage] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectPath, setProjectPath] = useState('')
  const [projectEditor, setProjectEditor] = useState('Visual Studio Code')
  const [projectUrls, setProjectUrls] = useState('')

  useEffect(() => { void getComputerConfig().then((value) => setConfig(value ?? defaultComputerConfig())) }, [])
  if (!config) return null
  const displayPreferences = config.displayPreferences ?? {}
  const save = async (next: ComputerConfig, success = 'Configuración de Computer actualizada.') => {
    const latest = await getComputerConfig()
    const stored = await updateComputerConfig({ ...next, focusSession: latest?.focusSession, doNotDisturb: latest?.doNotDisturb ?? next.doNotDisturb })
    setConfig(stored ?? next)
    setMessage(success)
  }
  const addProject = (event: FormEvent) => {
    event.preventDefault()
    if (!projectName.trim() || !projectPath.trim()) { setMessage('Indica nombre y ruta absoluta del proyecto.'); return }
    const project: ProjectRegistryEntry = {
      id: crypto.randomUUID(), name: projectName.trim(), path: projectPath.trim(),
      editorApp: projectEditor.trim() || undefined, urls: cleanUrls(projectUrls), apps: [], workspaceName: projectName.trim(), openFinder: false,
    }
    void save({ ...config, projects: [...config.projects, project] }, `Proyecto ${project.name} agregado.`)
    setProjectName(''); setProjectPath(''); setProjectUrls('')
  }

  return <section className="settings-group desktop-settings computer-settings">
    <div className="settings-group__head"><MonitorCog /><div><h2>Computer</h2><p>Control local con tools permitidas. FARO nunca recibe una shell ni envía tus rutas a Supabase.</p></div></div>
    <div className="desktop-settings__items">
      <label><Zap /><span><strong>Computer Control</strong><small>Permite comandos deterministas como abrir apps, controlar volumen y ejecutar automatizaciones locales.</small></span><input type="checkbox" checked={config.enabled} onChange={(event) => void save({ ...config, enabled: event.target.checked })} /></label>
    </div>

    <div className="computer-settings__head"><FolderPlus size={16} /><strong>Project Registry</strong><span>Rutas aprobadas de este Mac</span></div>
    <form className="computer-settings__project-form" onSubmit={addProject}>
      <input aria-label="Nombre del proyecto" placeholder="Ej. BIMSA" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
      <input aria-label="Ruta absoluta del proyecto" placeholder="/Users/tuusuario/Proyectos/BIMSA" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} />
      <input aria-label="Editor del proyecto" placeholder="Visual Studio Code" value={projectEditor} onChange={(event) => setProjectEditor(event.target.value)} />
      <textarea aria-label="URLs del proyecto" placeholder="URLs https opcionales, una por línea" value={projectUrls} onChange={(event) => setProjectUrls(event.target.value)} />
      <button type="submit"><Plus size={14} /> Agregar proyecto</button>
    </form>
    <div className="computer-settings__registry">{config.projects.length ? config.projects.map((project) => <article key={project.id}><div><strong>{project.name}</strong><span>{project.path}</span>{project.editorApp && <small>{project.editorApp}</small>}</div><button type="button" aria-label={`Eliminar ${project.name}`} onClick={() => void save({ ...config, projects: config.projects.filter((item) => item.id !== project.id) }, `Proyecto ${project.name} eliminado del registro.`)}><Trash2 size={14} /></button></article>) : <p>Agrega FARO OS, BIMSA o cualquier proyecto que quieras abrir por voz.</p>}</div>

    <div className="computer-settings__head"><Zap size={16} /><strong>Automations</strong><span>Se guardan sólo en este Mac</span></div>
    <div className="computer-settings__registry">{config.automations.length ? config.automations.map((automation) => <article key={automation.id}><div><strong>{automation.name}</strong><span>“{automation.trigger.phrase}” · {automation.actions.length} acciones</span></div><label className="computer-settings__toggle"><input type="checkbox" checked={automation.enabled} onChange={(event) => void save({ ...config, automations: config.automations.map((item) => item.id === automation.id ? { ...item, enabled: event.target.checked } : item) })} /> Activa</label><button type="button" aria-label={`Eliminar ${automation.name}`} onClick={() => void save({ ...config, automations: config.automations.filter((item) => item.id !== automation.id) })}><Trash2 size={14} /></button></article>) : <p>Enséñale una: “cuando te diga modo BIMSA quiero que…”; FARO mostrará la propuesta antes de guardarla.</p>}</div>

    <div className="computer-settings__head"><ShieldCheck size={16} /><strong>Focus y permisos</strong><span>Se piden sólo al usar la función</span></div>
    <div className="computer-settings__focus">
      <label>Concentración por defecto (min)<input type="number" min="1" max="480" value={config.focusPreferences.defaultDurationMinutes} onChange={(event) => void save({ ...config, focusPreferences: { ...config.focusPreferences, defaultDurationMinutes: Math.max(1, Math.min(480, Number(event.target.value) || 45)) } })} /></label>
      <label>Descanso por defecto (min)<input type="number" min="1" max="120" value={config.focusPreferences.defaultBreakDurationMinutes ?? 15} onChange={(event) => void save({ ...config, focusPreferences: { ...config.focusPreferences, defaultBreakDurationMinutes: Math.max(1, Math.min(120, Number(event.target.value) || 15)) } })} /></label>
      <p>Estos tiempos se aplican a la siguiente sesión. FARO avisa por voz al terminar la concentración y el descanso.</p>
      <button type="button" onClick={() => { void startSilentConcentration(true).then((result) => setMessage(result.response?.message ?? 'Prueba iniciada: 10 segundos de concentración y 5 de descanso.')).catch(() => setMessage('No pude iniciar la prueba. Inténtalo de nuevo.')) }}>Probar ahora · 10 s de enfoque / 5 s de descanso</button>
      <label><input type="checkbox" checked={config.focusPreferences.enableDoNotDisturb} onChange={(event) => void save({ ...config, focusPreferences: { ...config.focusPreferences, enableDoNotDisturb: event.target.checked } })} /> Activar concentración al iniciar Focus</label>
      {config.focusPreferences.enableDoNotDisturb && <><label>Shortcut para activar<input placeholder="FARO Focus On" value={config.focusPreferences.focusOnShortcut ?? ''} onChange={(event) => void save({ ...config, focusPreferences: { ...config.focusPreferences, focusOnShortcut: event.target.value } })} /></label><label>Shortcut para restaurar<input placeholder="FARO Focus Off" value={config.focusPreferences.focusOffShortcut ?? ''} onChange={(event) => void save({ ...config, focusPreferences: { ...config.focusPreferences, focusOffShortcut: event.target.value } })} /></label></>}
      <p><strong>Permisos:</strong> volumen, bloqueo y abrir apps no requieren acceso completo al disco. Enfocar/ordenar ventanas puede pedir Automatización o Accesibilidad; búsquedas de archivos respetan las protecciones normales de macOS.</p>
    </div>
    <div className="computer-settings__head"><MonitorCog size={16} /><strong>Pantalla</strong><span>Brillo directo y Night Shift mediante Shortcuts</span></div>
    <div className="computer-settings__focus">
      <label>Shortcut para activar Night Shift<input placeholder="FARO Night Shift On" value={displayPreferences.nightShiftOnShortcut ?? ''} onChange={(event) => void save({ ...config, displayPreferences: { ...displayPreferences, nightShiftOnShortcut: event.target.value } })} /></label>
      <label>Shortcut para desactivar Night Shift<input placeholder="FARO Night Shift Off" value={displayPreferences.nightShiftOffShortcut ?? ''} onChange={(event) => void save({ ...config, displayPreferences: { ...displayPreferences, nightShiftOffShortcut: event.target.value } })} /></label>
      <p>“Sube el brillo” y “brillo máximo” se aplican a la pantalla activa. Para Night Shift, crea esos Shortcuts en la app Atajos con la acción de pantalla correspondiente y escribe sus nombres aquí.</p>
    </div>
    {message && <p className="desktop-settings__message">{message}</p>}
  </section>
}
