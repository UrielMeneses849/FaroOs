import type { LucideIcon } from 'lucide-react'
import {
  BarChart3, CalendarDays, CircleDollarSign, ClipboardList, Compass, Gauge,
  HardDrive, HeartPulse, Landmark, ListChecks, MessageSquarePlus, NotebookPen, Settings, ShieldCheck, Sparkles,
  UserRound, Workflow,
} from 'lucide-react'

export interface NavigationItem {
  id: string
  label: string
  icon: LucideIcon
  route: string
  /** Dynamic descendants that should preserve this item as active. */
  activePrefix?: string
  desktopOnly?: boolean
  featureFlag?: string
}

export interface NavigationGroup {
  id: 'inicio' | 'personal' | 'organization' | 'device' | 'faro'
  label: string
  icon: LucideIcon
  children: readonly NavigationItem[]
  collapsible: boolean
}

export const navigationGroups: readonly NavigationGroup[] = [
  {
    id: 'inicio',
    label: 'Inicio',
    icon: Gauge,
    collapsible: false,
    children: [
      { id: 'dashboard', label: 'Dashboard', icon: Gauge, route: '/dashboard' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    icon: UserRound,
    collapsible: true,
    children: [
      { id: 'finance', label: 'Finanzas', icon: CircleDollarSign, route: '/finance' },
      { id: 'health', label: 'Salud', icon: HeartPulse, route: '/health' },
      { id: 'journal', label: 'Diario', icon: NotebookPen, route: '/journal' },
      { id: 'needs', label: 'Necesidades', icon: ListChecks, route: '/needs' },
      { id: 'vault', label: 'Vault', icon: ShieldCheck, route: '/vault', desktopOnly: true },
    ],
  },
  {
    id: 'organization',
    label: 'Organización',
    icon: Workflow,
    collapsible: true,
    children: [
      { id: 'backlog', label: 'Backlog', icon: ClipboardList, route: '/backlog' },
      { id: 'calendar', label: 'Calendario', icon: CalendarDays, route: '/calendar' },
    ],
  },
  {
    id: 'device',
    label: 'Dispositivo',
    icon: HardDrive,
    collapsible: true,
    children: [
      { id: 'storage', label: 'Espacio', icon: HardDrive, route: '/storage', desktopOnly: true },
    ],
  },
  {
    id: 'faro',
    label: 'FARO',
    icon: Sparkles,
    collapsible: true,
    children: [
      { id: 'finops', label: 'FinOps', icon: BarChart3, route: '/finops' },
      { id: 'improvements', label: 'Mejoras FARO', icon: MessageSquarePlus, route: '/improvements' },
    ],
  },
]

/**
 * Intentionally non-navigable until each surface has a product route. Keeping
 * this declaration beside the live navigation prevents the sidebar returning
 * to a flat list when FARO Computer, Voice, Lab or Nodes become ready.
 */
export const futureNavigationSurfaces = [
  { id: 'concentration', label: 'Concentración', group: 'organization' },
  { id: 'automations', label: 'Automatizaciones', group: 'device', desktopOnly: true },
  { id: 'system', label: 'Sistema', group: 'device', desktopOnly: true },
  { id: 'voice', label: 'Voice', group: 'faro' },
  { id: 'laboratory', label: 'Laboratorio', group: 'faro' },
  { id: 'nodes', label: 'Nodes', group: 'faro' },
] as const

export const settingsItem: NavigationItem = { id: 'settings', label: 'Ajustes', icon: Settings, route: '/settings' }

export function navigationItemIsActive(item: NavigationItem, pathname: string) {
  return pathname === item.route || Boolean(item.activePrefix && pathname.startsWith(item.activePrefix))
}

export function navigationGroupForPath(pathname: string) {
  return navigationGroups.find((group) => group.children.some((item) => navigationItemIsActive(item, pathname)))
}

export const allNavigationItems = navigationGroups.flatMap((group) => group.children)

export const mobileItems = [
  navigationGroups[0].children[0],
  navigationGroups[2].children[0],
  navigationGroups[2].children[1],
  navigationGroups[1].children[0],
]

export { Compass, Landmark }
