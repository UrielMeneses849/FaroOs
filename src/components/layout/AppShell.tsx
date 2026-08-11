import { LogOut, Menu, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { allNavigationItems, settingsItem } from '../../app/navigation'
import { QuickCaptureDialog } from '../../features/capture/QuickCaptureDialog'
import { useAuth } from '../../hooks/auth'
import { IconButton, Modal } from '../common'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(true)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { signOut } = useAuth()

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

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">Saltar al contenido</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="app-body">
        <div className="mobile-topbar">
          <div className="brand brand--mobile"><div className="brand__mark" aria-hidden="true"><span /></div><strong>FARO</strong></div>
          <div>
            <IconButton label="Buscar"><Search size={18} /></IconButton>
            <IconButton label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={20} /></IconButton>
          </div>
        </div>
        <main id="main-content" className="main-content"><Outlet context={{ capture: () => setCaptureOpen(true) }} /></main>
      </div>
      <MobileNavigation onMore={() => setMenuOpen(true)} />
      {captureOpen && <QuickCaptureDialog open onClose={() => setCaptureOpen(false)} />}
      <Modal open={menuOpen} title="Explorar FARO" onClose={() => setMenuOpen(false)}>
        <nav className="mobile-menu" aria-label="Todas las secciones">
          {allNavigationItems.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} onClick={() => setMenuOpen(false)} className={location.pathname === path ? 'active' : ''}><Icon size={18} />{label}</NavLink>
          ))}
          <NavLink to={settingsItem.path} onClick={() => setMenuOpen(false)}><settingsItem.icon size={18} />Ajustes</NavLink>
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
