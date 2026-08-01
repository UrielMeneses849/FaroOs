import {
  CalendarDays, CircleDollarSign, ClipboardList, Compass, Gauge, HeartPulse,
  Landmark, NotebookPen, Settings, SunMedium, Target,
} from 'lucide-react'

export const navigationGroups = [
  {
    label: 'Prioridad',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: Gauge },
      { path: '/today', label: 'Hoy', icon: SunMedium },
      { path: '/backlog', label: 'Backlog', icon: ClipboardList },
      { path: '/calendar', label: 'Calendario', icon: CalendarDays },
      { path: '/finance', label: 'Finanzas', icon: CircleDollarSign },
      { path: '/health', label: 'Salud', icon: HeartPulse },
      { path: '/journal', label: 'Diario', icon: NotebookPen },
    ],
  },
  {
    label: 'Planificación',
    items: [
      { path: '/goals', label: 'Objetivos', icon: Target },
    ],
  },
] as const

// Módulos conservados en el código pero retirados temporalmente del producto:
// Sprints, Nexvora, Portafolio, Ventas, Contenido, Aprendizaje y Viajes.

export const settingsItem = { path: '/settings', label: 'Ajustes', icon: Settings }
export const mobileItems = [
  navigationGroups[0].items[0],
  navigationGroups[0].items[1],
  navigationGroups[0].items[2],
  navigationGroups[0].items[3],
]
export const allNavigationItems = [
  ...navigationGroups[0].items,
  ...navigationGroups[1].items,
]
export { Compass, Landmark }
