import { ChevronDown, LogOut } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { navigationGroups, navigationItemIsActive, settingsItem, type NavigationGroup } from '../../app/navigation'
import { useAuth } from '../../hooks/auth'
import { isFaroDesktop } from '../../desktop/desktopBridge'

interface SidebarProps {
  openGroups: Partial<Record<NavigationGroup['id'], boolean>>
  onToggleGroup: (groupId: NavigationGroup['id']) => void
}

export function Sidebar({ openGroups, onToggleGroup }: SidebarProps) {
  const { signOut } = useAuth()
  const { pathname } = useLocation()
  const desktop = isFaroDesktop()

  return (
    <aside className="sidebar sidebar--v2 sidebar--persistent">
      <div className="brand sidebar-brand">
        <div className="brand__mark" aria-hidden="true"><span /></div>
        <div className="sidebar-brand__copy"><strong>FARO</strong><small>Personal OS</small></div>
      </div>

      <nav className="sidebar__nav sidebar-nav-v2" aria-label="Navegación principal">
        {navigationGroups.map((group) => {
          const children = group.children.filter((item) => !item.desktopOnly || desktop)
          if (!children.length) return null
          const isGroupActive = children.some((item) => navigationItemIsActive(item, pathname))
          const isExpanded = Boolean(openGroups[group.id])
          const GroupIcon = group.icon

          if (!group.collapsible) {
            const item = children[0]
            const ItemIcon = item.icon
            return <section className="sidebar-group sidebar-group--inicio" key={group.id}>
              <span className="sidebar-group__label">{group.label}</span>
              <NavLink to={item.route} className={`sidebar-child-link ${navigationItemIsActive(item, pathname) ? 'sidebar-child-link--active' : ''}`}>
                <ItemIcon size={18} aria-hidden="true" /><span>{item.label}</span>
              </NavLink>
            </section>
          }

          return <section className={`sidebar-group ${isGroupActive ? 'sidebar-group--active' : ''}`} key={group.id}>
            <button
              type="button"
              className="sidebar-group-toggle"
              aria-expanded={isExpanded}
              onClick={() => onToggleGroup(group.id)}
            >
              <GroupIcon size={18} aria-hidden="true" />
              <span>{group.label}</span>
              <ChevronDown className={isExpanded ? 'is-open' : ''} size={15} aria-hidden="true" />
            </button>
            <div className={`sidebar-group__children ${isExpanded ? 'is-open' : ''}`} aria-hidden={!isExpanded}>
              {children.map((item) => {
                const ItemIcon = item.icon
                const active = navigationItemIsActive(item, pathname)
                return <NavLink key={item.id} to={item.route} tabIndex={isExpanded ? undefined : -1} className={`sidebar-child-link ${active ? 'sidebar-child-link--active' : ''}`}>
                  <ItemIcon size={15} aria-hidden="true" /><span>{item.label}</span>
                </NavLink>
              })}
            </div>
          </section>
        })}
      </nav>

      <div className="sidebar__footer sidebar-footer-v2">
        <NavLink to={settingsItem.route} className={`sidebar-child-link ${navigationItemIsActive(settingsItem, pathname) ? 'sidebar-child-link--active' : ''}`}>
          <settingsItem.icon size={18} aria-hidden="true" /><span>{settingsItem.label}</span>
        </NavLink>
        <button type="button" className="sidebar-child-link sidebar-child-link--button" onClick={() => void signOut()}>
          <LogOut size={18} aria-hidden="true" /><span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  )
}
