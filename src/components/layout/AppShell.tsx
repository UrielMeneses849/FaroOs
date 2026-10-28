import { LogOut, Menu, Plus, Sun, Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { allNavigationItems, navigationGroups, navigationItemIsActive, settingsItem } from '../../app/navigation'
import { QuickCaptureDialog } from '../../features/capture/QuickCaptureDialog'
import { useAuth } from '../../hooks/auth'
import { IconButton, Modal } from '../common'
import { MobileNavigation } from './MobileNavigation'
import { MobileQuickActions } from './MobileQuickActions'
import { Sidebar } from './Sidebar'
import { DesktopTopbar } from './DesktopTopbar'
import { readSidebarPreferences, writeSidebarPreferences } from './sidebarState'
import { isFaroDesktop } from '../../desktop/desktopBridge'
import orbUrl from '../../assets/faro-orb-v1.png'
import { QuickActionEntry } from '../../features/pwa/QuickActionEntry'

export function AppShell() {
  const mainContentRef = useRef<HTMLElement>(null)
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
      return next
    })
  }

  useEffect(() => {
    writeSidebarPreferences(sidebarPreferences)
  }, [sidebarPreferences])

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
  const currentMobileApp = allNavigationItems.find((item) => navigationItemIsActive(item, pathname))?.label
    ?? (pathname.startsWith('/goals') ? 'Metas' : pathname === '/today' ? 'Hoy' : pathname === '/settings' ? 'Ajustes' : 'FARO')
  const mobileGroups = navigationGroups.map((group) => ({ ...group,
    children: [
      ...group.children.filter((item) => !item.desktopOnly || desktop),
      ...(group.id === 'inicio' ? [{ id: 'today', label: 'Hoy', icon: Sun, route: '/today' }] : []),
      ...(group.id === 'organization' ? [{ id: 'goals', label: 'Metas', icon: Target, route: '/goals', activePrefix: '/goals/' }] : []),
    ],
  })).filter((group) => group.children.length)

  useEffect(() => {
    const scrollOwner = window.matchMedia?.('(max-width: 760px)').matches
      ? document.scrollingElement
      : mainContentRef.current
    scrollOwner?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])

  return (
    <div className={`app-shell app-shell--paper app-shell--mobile-ready app-shell--sidebar-v2 app-shell--persistent-sidebar ${sidebarPreferences.collapsed ? 'app-shell--collapsed' : 'app-shell--expanded'}`}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <Sidebar
        variant="paper"
        collapsed={sidebarPreferences.collapsed}
        onToggleCollapsed={() => updateSidebarPreferences((current) => ({ ...current, collapsed: !current.collapsed }))}
        openGroups={sidebarPreferences.openGroups}
        onToggleGroup={(groupId) => updateSidebarPreferences((current) => ({
          ...current,
          openGroups: current.openGroups[groupId] ? {} : { [groupId]: true },
        }))}
      />
      <div className="app-body">
        <DesktopTopbar onCapture={() => setCaptureOpen(true)} />
        <div className="mobile-topbar">
          <NavLink className="brand brand--mobile" to="/dashboard" aria-label="FARO, ir al inicio"><img className="sidebar-brand__logo" src={orbUrl} alt="" aria-hidden="true" /><strong>FARO</strong><span className="mobile-topbar__section">{currentMobileApp === 'Dashboard' ? 'Inicio' : currentMobileApp}</span></NavLink>
          <div className="mobile-topbar__actions">
            <IconButton label="Crear nuevo" onClick={() => setQuickOpen(true)}><Plus size={19} /></IconButton>
            <IconButton label="Abrir menú" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Menu size={20} /></IconButton>
          </div>
        </div>
        <main ref={mainContentRef} id="main-content" className="main-content"><Outlet context={{ capture: () => setCaptureOpen(true) }} /></main>
      </div>
      <QuickActionEntry key={pathname} />
      <MobileNavigation onQuick={() => setQuickOpen(true)} />
      <MobileQuickActions
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onExpense={() => { setQuickOpen(false); navigate('/finance?quick=expense') }}
        onCalendar={() => { setQuickOpen(false); navigate('/calendar?quick=event') }}
        onCapture={() => { setQuickOpen(false); setCaptureOpen(true) }}
      />
      {captureOpen && <QuickCaptureDialog open onClose={() => setCaptureOpen(false)} />}
      <Modal open={menuOpen} title="Explorar FARO" onClose={() => setMenuOpen(false)} panelClassName="mobile-apps-modal">
        <nav className="mobile-menu" aria-label="Todas las secciones">
          <p className="mobile-menu__intro">Tus aplicaciones, en un solo lugar.</p>
          {mobileGroups.map((group) => <section key={group.id} className="mobile-app-group" aria-label={group.label}>
            <h3>{group.label}</h3>
            <div>{group.children.map((item) => <NavLink key={item.route} to={item.route} onClick={() => setMenuOpen(false)} className={navigationItemIsActive(item, pathname) ? 'active' : ''}><item.icon size={20} aria-hidden="true" /><span>{item.label === 'Dashboard' ? 'Inicio' : item.label}</span></NavLink>)}</div>
          </section>)}
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
