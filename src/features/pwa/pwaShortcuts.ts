/** Launcher shortcuts are navigation intents, never mutations or microphone grants. */
export const pwaShortcutDefinitions = [
  { name: 'Registrar movimiento', short_name: 'Movimiento', description: 'Abre el registro de ingresos, gastos y transferencias', path: 'finance?quick=movement' },
  { name: 'Nueva tarea', short_name: 'Tarea', description: 'Prepara una tarea nueva sin guardarla todavía', path: 'backlog?quick=task' },
  { name: 'Mi día', short_name: 'Mi día', description: 'Consulta tu agenda y tus pendientes de hoy', path: 'today' },
  { name: 'Hablar con FARO', short_name: 'FARO', description: 'Abre el asistente; tú decides cuándo activar el micrófono', path: 'dashboard?quick=voice' },
  { name: 'Lista del sábado', short_name: 'Compras', description: 'Tu lista, inventario y presupuesto de casa', path: 'needs' },
  { name: 'Nuevo evento', short_name: 'Evento', description: 'Añade algo a tu calendario', path: 'calendar?quick=event' },
] as const

export function createPwaShortcuts(scope: string) {
  const base = scope.endsWith('/') ? scope : `${scope}/`
  return pwaShortcutDefinitions.map(({ path, ...shortcut }) => ({
    ...shortcut,
    url: `${base}${path}`,
    icons: [{ src: `${base}pwa-icons/faro-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' as const }],
  }))
}
