import {
  Activity, BookOpen, BriefcaseBusiness, CalendarDays, CircleDollarSign, ClipboardList,
  Compass, Gauge, GraduationCap, HeartPulse, Landmark, NotebookPen,
  Plane, Rocket, Settings, Sparkles, SunMedium, Target,
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
      { path: '/sprints', label: 'Sprints', icon: Rocket },
    ],
  },
  {
    label: 'Trabajo',
    items: [
      { path: '/nexvora', label: 'Nexvora', icon: Sparkles },
      { path: '/portfolio', label: 'Portafolio', icon: BriefcaseBusiness },
      { path: '/sales', label: 'Ventas', icon: Activity },
      { path: '/content', label: 'Contenido', icon: BookOpen },
    ],
  },
  {
    label: 'Vida',
    items: [
      { path: '/learning', label: 'Aprendizaje', icon: GraduationCap },
      { path: '/travel', label: 'Viajes', icon: Plane },
    ],
  },
] as const

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
  ...navigationGroups[2].items,
  ...navigationGroups[3].items,
]
export { Compass, Landmark }
