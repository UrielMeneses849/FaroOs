import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { useEffect, useRef, useState } from 'react'
import { useCalendarData } from '../hooks/useCalendarData'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { resolveCalendarWorkspaceId } from '../lib/calendarWorkspaceCounts'
import { useFaroStore } from '../store'
import { announceFaroCalendarEvent, getDesktopPreferences, isFaroDesktop } from './desktopBridge'
import { calendarAnnouncement, desktopNotificationCandidates } from './desktopNotificationRules'

export function DesktopProactivity() {
  if (!isFaroDesktop()) return null
  return <DesktopProactivityEnabled />
}

function DesktopProactivityEnabled() {
  const tasks = useFaroStore((state) => state.tasks)
  const { data } = useCalendarData()
  const { data: workspaces } = useWorkspaces()
  const [enabled, setEnabled] = useState(false)
  const [lead, setLead] = useState(10)
  const sent = useRef(new Set<string>())

  useEffect(() => {
    void getDesktopPreferences().then((preferences) => { if (preferences) { setEnabled(preferences.notificationsEnabled); setLead(preferences.calendarLeadMinutes) } })
    const action = (event: Event) => setEnabled(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener('faro:desktop-notifications-enabled', action)
    return () => window.removeEventListener('faro:desktop-notifications-enabled', action)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const evaluate = async () => {
      let allowed = await isPermissionGranted()
      if (!allowed) allowed = await requestPermission() === 'granted'
      if (!allowed) return
      for (const candidate of desktopNotificationCandidates({ now: new Date(), calendarItems: data.items, tasks, calendarLeadMinutes: lead })) {
        if (sent.current.has(candidate.key)) continue
        sent.current.add(candidate.key)
        sendNotification({ title: candidate.title, body: candidate.body, extra: { route: candidate.route }, autoCancel: true })
        if (candidate.route !== '/calendar') continue
        const item = data.items.find((calendarItem) => calendarItem.id === candidate.calendarItemId)
        if (!item) continue
        const workspace = workspaces.find((entry) => entry.id === resolveCalendarWorkspaceId(item, workspaces))
        const workspaceName = workspace?.name ?? item.calendarName
        void announceFaroCalendarEvent(calendarAnnouncement(item.title, workspaceName, lead))
      }
    }
    void evaluate()
    const timer = window.setInterval(() => void evaluate(), 60_000)
    return () => window.clearInterval(timer)
  }, [data.items, enabled, lead, tasks, workspaces])
  return null
}
