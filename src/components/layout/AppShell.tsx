import { LogOut, Menu, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { allNavigationItems, settingsItem } from '../../app/navigation'
import { QuickCaptureDialog } from '../../features/capture/QuickCaptureDialog'
import { useAuth } from '../../hooks/auth'
import { IconButton, Modal } from '../common'
import { MobileNavigation } from './MobileNavigation'
import { MobileQuickActions } from './MobileQuickActions'
import { Sidebar } from './Sidebar'
import { readSidebarPreferences, writeSidebarPreferences } from './sidebarState'
import { isFaroDesktop } from '../../desktop/desktopBridge'
import orbUrl from '../../assets/faro-orb-v1.png'

export function AppShell() {
  const [sidebarPreferences, setSidebarPreferences] = useState(readSidebarPreferences)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const { signOut } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const updateSidebarPreferences = (updater: (current: typeof sidebarPreferences) => typeof sidebarPreferences) => {
    setSidebarPreferences((current) => {
      const next = updater(current)
      writeSidebarPreferences(next)
      return next
    })
  }

  useEffect(() => {
    const openCapture = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCaptureOpen(true)
      }
    }
    window.addEventListener('keydown', openCapture)
    return () => window.removeEventListener('keydown', openCapture)
  }, [])

  const desktop = isFaroDesktop()
  const visibleMobileItems = allNavigationItems.filter((item) => !item.desktopOnly || desktop)

  return (
    <div className="app-shell app-shell--sidebar-v2 app-shell--persistent-sidebar">
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <Sidebar
        openGroups={sidebarPreferences.openGroups}
        onToggleGroup={(groupId) => updateSidebarPreferences((current) => ({
          ...current,
          openGroups: current.openGroups[groupId] ? {} : { [groupId]: true },
        }))}
      />
      <div className="app-body">
        <div className="mobile-topbar">
          <div className="brand brand--mobile"><img className="sidebar-brand__logo" src={orbUrl} alt="" aria-hidden="true" /><strong>FARO</strong></div>
          <div>
            <IconButton label="Crear nuevo" onClick={() => setQuickOpen(true)}><Plus size={19} /></IconButton>
            <IconButton label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={20} /></IconButton>
          </div>
        </div>
        <main id="main-content" className="main-content"><Outlet context={{ capture: () => setCaptureOpen(true) }} /></main>
      </div>
      <MobileNavigation onQuick={() => setQuickOpen(true)} />
      <MobileQuickActions
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onExpense={() => { setQuickOpen(false); navigate('/finance?quick=expense') }}
        onCalendar={() => { setQuickOpen(false); navigate('/calendar?quick=event') }}
        onCapture={() => { setQuickOpen(false); setCaptureOpen(true) }}
      />
      {captureOpen && <QuickCaptureDialog open onClose={() => setCaptureOpen(false)} />}
      <Modal open={menuOpen} title="Explorar FARO" onClose={() => setMenuOpen(false)}>
        <nav className="mobile-menu" aria-label="Todas las secciones">
          {visibleMobileItems.map(({ route, label, icon: Icon }) => (
            <NavLink key={route} to={route} onClick={() => setMenuOpen(false)} className={pathname === route ? 'active' : ''}><Icon size={18} />{label}</NavLink>
          ))}
          <NavLink to={settingsItem.route} onClick={() => setMenuOpen(false)}><settingsItem.icon size={18} />Ajustes</NavLink>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false)
              void signOut()
            }}
          >
            <LogOut size={18} aria-hidden="true" />Cerrar sesión
          </button>
        </nav>
      </Modal>
    </div>
  )
}
