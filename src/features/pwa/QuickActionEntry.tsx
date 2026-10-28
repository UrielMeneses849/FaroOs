import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Modal } from '../../components/common'
import { useOptionalFaroVoice } from '../voice/FaroVoiceProvider'

const TaskFormDialog = lazy(async () => {
  const { TaskFormDialog } = await import('../planning/PlanningDialogs')
  return { default: TaskFormDialog }
})

/** Mounted inside the authenticated shell so links retain normal login protection. */
export function QuickActionEntry() {
  const location = useLocation()
  const navigate = useNavigate()
  const voice = useOptionalFaroVoice()
  const handledEntry = useRef<string | undefined>(undefined)
  const openVoice = voice?.openFaroVoice
  const voiceEnabled = voice?.enabled
  const quick = new URLSearchParams(location.search).get('quick')
  const taskRequested = quick === 'task' && (location.pathname === '/backlog' || location.pathname === '/today')

  const clearQuickIntent = useCallback(() => {
    const params = new URLSearchParams(location.search)
    params.delete('quick')
    navigate({ pathname: location.pathname, search: params.size ? `?${params}` : '', hash: location.hash }, {
      replace: true,
      state: location.state,
    })
  }, [location, navigate])

  useEffect(() => {
    if (handledEntry.current === location.key || quick !== 'voice' || location.pathname !== '/dashboard' || !voiceEnabled || !openVoice) return
    handledEntry.current = location.key
    // Open the existing panel; microphone access still needs a tap there.
    openVoice({ surface: 'dashboard' })
    clearQuickIntent()
  }, [clearQuickIntent, location.key, location.pathname, openVoice, quick, voiceEnabled])

  // The URL owns this draft. Closing or saving removes only its quick intent.
  if (!taskRequested) return null
  return <Suspense fallback={<Modal open title="Nueva tarea" onClose={clearQuickIntent}><p role="status">Abriendo formulario…</p></Modal>}>
    <TaskFormDialog open onClose={clearQuickIntent} />
  </Suspense>
}
