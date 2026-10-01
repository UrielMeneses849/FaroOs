import { Download, RefreshCw, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isFaroTauriRuntime } from '../../core/platform/runtime'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const installDismissedKey = 'faro-pwa-install-dismissed'

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

export function PwaExperience() {
  const nativeRuntime = isFaroTauriRuntime()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent>()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [installing, setInstalling] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError(error) {
      if (import.meta.env.DEV) console.debug('[FARO PWA] Service worker registration failed.', error)
    },
  })

  useEffect(() => {
    if (nativeRuntime) return
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      if (!isStandalone() && sessionStorage.getItem(installDismissedKey) !== 'true') {
        setInstallPrompt(event as BeforeInstallPromptEvent)
      }
    }
    const handleInstalled = () => setInstallPrompt(undefined)
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [nativeRuntime])

  if (nativeRuntime) return null

  const dismissInstall = () => {
    sessionStorage.setItem(installDismissedKey, 'true')
    setInstallPrompt(undefined)
  }

  const install = async () => {
    if (!installPrompt) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
      setInstallPrompt(undefined)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <aside className="pwa-experience" aria-live="polite" aria-atomic="true">
      {installPrompt && (
        <section className="pwa-install-card">
          <img src={`${import.meta.env.BASE_URL}pwa-icons/faro-192.png`} alt="" />
          <div>
            <span>FARO en tu teléfono</span>
            <strong>Instala tu espacio personal</strong>
            <p>Ábrelo desde tu inicio, a pantalla completa y con acceso rápido.</p>
          </div>
          <button type="button" className="pwa-install-card__primary" disabled={installing} onClick={() => void install()}>
            <Download size={16} />{installing ? 'Abriendo…' : 'Instalar'}
          </button>
          <button type="button" className="pwa-install-card__close" aria-label="Ahora no" onClick={dismissInstall}><X size={17} /></button>
        </section>
      )}

      {needRefresh && (
        <section className="pwa-status-card pwa-status-card--update">
          <RefreshCw size={17} />
          <div><strong>Nueva versión lista</strong><span>Actualiza para usar las últimas mejoras.</span></div>
          <button type="button" onClick={() => void updateServiceWorker(true)}>Actualizar</button>
          <button type="button" aria-label="Actualizar después" onClick={() => setNeedRefresh(false)}><X size={16} /></button>
        </section>
      )}

      {!online && (
        <section className="pwa-status-card pwa-status-card--offline">
          <WifiOff size={17} />
          <div><strong>Estás sin conexión</strong><span>FARO abrirá lo guardado; los datos en vivo volverán al reconectarte.</span></div>
        </section>
      )}

      {offlineReady && online && !needRefresh && (
        <section className="pwa-status-card pwa-status-card--ready">
          <span className="pwa-status-card__signal" aria-hidden="true" />
          <div><strong>FARO está listo</strong><span>La interfaz ya puede abrir aunque pierdas conexión.</span></div>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setOfflineReady(false)}><X size={16} /></button>
        </section>
      )}
    </aside>
  )
}
