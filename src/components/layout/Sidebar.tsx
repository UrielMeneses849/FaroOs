import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { navigationGroups, settingsItem } from '../../app/navigation'
import { useAuth } from '../../hooks/auth'
import { IconButton } from '../common'

interface SidebarProps { collapsed: boolean; onToggle: () => void }

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { signOut } = useAuth()

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="brand">
        <div className="brand__mark" aria-hidden="true"><span /></div>
        {!collapsed && <div><strong>FARO</strong><small>Personal OS</small></div>}
      </div>
      <nav className="sidebar__nav" aria-label="Navegación principal">
        {navigationGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            {!collapsed && <span className="nav-group__label">{group.label}</span>}
            {group.items.map(({ path, label, icon: Icon }) => (
              <NavLink key={path} to={path} aria-label={collapsed ? label : undefined} title={collapsed ? label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
                <Icon size={18} aria-hidden="true" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar__footer">
        <NavLink to={settingsItem.path} aria-label={collapsed ? settingsItem.label : undefined} title={collapsed ? settingsItem.label : undefined} className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}>
          <settingsItem.icon size={18} aria-hidden="true" />{!collapsed && <span>{settingsItem.label}</span>}
        </NavLink>
        <button
          type="button"
          className="nav-link nav-link--button"
          aria-label={collapsed ? 'Cerrar sesión' : undefined}
          title={collapsed ? 'Cerrar sesión' : undefined}
          onClick={() => void signOut()}
        >
          <LogOut size={18} aria-hidden="true" />{!collapsed && <span>Cerrar sesión</span>}
        </button>
        <IconButton className="collapse-button" label={collapsed ? 'Expandir barra lateral' : 'Colapsar barra lateral'} onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </IconButton>
      </div>
    </aside>
  )
}
