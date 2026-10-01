import { requestPermission } from '@tauri-apps/plugin-notification'
import { useEffect, useState } from 'react'
import { Bell, LaptopMinimal, Mic, Power } from 'lucide-react'
import { WakeEnrollment } from './WakeEnrollment'
import { ComputerSettings } from './ComputerSettings'
import { getDesktopPreferences, setDesktopLaunchAtLogin, updateDesktopPreferences, type DesktopPreferences } from './desktopBridge'

export function DesktopSettings() {
  const [preferences, setPreferences] = useState<DesktopPreferences>()
  const [message, setMessage] = useState('')
  useEffect(() => { void getDesktopPreferences().then((value) => setPreferences(value)) }, [])
  if (!preferences) return null
  const update = async (patch: Partial<DesktopPreferences>) => {
    const next = await updateDesktopPreferences(patch)
    if (next) setPreferences(next)
    if (Object.hasOwn(patch, 'wakeEnabled')) window.dispatchEvent(new CustomEvent('faro:desktop-wake-enabled', { detail: patch.wakeEnabled }))
    if (patch.notificationsEnabled) { await requestPermission(); window.dispatchEvent(new CustomEvent('faro:desktop-notifications-enabled', { detail: true })) }
    if (patch.notificationsEnabled === false) window.dispatchEvent(new CustomEvent('faro:desktop-notifications-enabled', { detail: false }))
  }
  const launchAtLogin = async (enabled: boolean) => {
    const result = await setDesktopLaunchAtLogin(enabled)
    setPreferences((current) => current ? { ...current, launchAtLogin: result ?? current.launchAtLogin } : current)
  }
  return <><section className="settings-group desktop-settings"><div className="settings-group__head"><LaptopMinimal /><div><h2>FARO Desktop</h2><p>Preferencias nativas de este Mac. Tus datos y reglas siguen siendo los mismos de FARO Web.</p></div></div><div className="desktop-settings__items">
    <label><Mic /><span><strong>Wake listening local</strong><small>“FARO” se procesa en este Mac. Es experimental; FARO Mini usa Realtime para una transcripción más consistente.</small></span><input type="checkbox" checked={preferences.wakeEnabled} onChange={(event) => void update({ wakeEnabled: event.target.checked })} /></label>
    <label><Bell /><span><strong>Notificaciones nativas</strong><small>Diez minutos antes de un evento, FARO Mini muestra una notificación y la anuncia con voz. Es determinista y no usa un modelo.</small></span><input type="checkbox" checked={preferences.notificationsEnabled} onChange={(event) => void update({ notificationsEnabled: event.target.checked })} /></label>
    <label><Power /><span><strong>Abrir al iniciar sesión</strong><small>Inicia en segundo plano, sin mostrar la ventana principal.</small></span><input type="checkbox" checked={preferences.launchAtLogin} onChange={(event) => void launchAtLogin(event.target.checked)} /></label>
  </div><WakeEnrollment onComplete={() => setMessage('Muestras completas. El siguiente paso es ejecutar el entrenamiento local y el bake-off antes de instalar FARO Desktop 0.3.')} />{message && <p className="desktop-settings__message">{message}</p>}</section><ComputerSettings /></>
}
