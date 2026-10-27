import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useId, useState, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { navigationGroups, navigationItemIsActive, settingsItem, type NavigationGroup } from '../../app/navigation'
import { useAuth } from '../../hooks/auth'
import { isFaroDesktop } from '../../desktop/desktopBridge'
import orbUrl from '../../assets/faro-orb-v1.png'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  openGroups: Partial<Record<NavigationGroup['id'], boolean>>
  onToggleGroup: (groupId: NavigationGroup['id']) => void
}

export function Sidebar({ collapsed, onToggleCollapsed, openGroups, onToggleGroup }: SidebarProps) {
  const { signOut } = useAuth()
  const { pathname } = useLocation()
  const desktop = isFaroDesktop()
  const navId = useId()
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null)
  const showLabel = (event: SyntheticEvent) => {
    if (!collapsed || !(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>('[data-sidebar-label]')
    if (!target) { setTooltip(null); return }
    const rect = target.getBoundingClientRect()
    setTooltip({ label: target.dataset.sidebarLabel!, top: Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height / 2)) })
  }
  const toggleLabel = collapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'

  return (
    <aside
      className={`sidebar sidebar--v2 sidebar--persistent ${collapsed ? 'sidebar--collapsed' : ''}`}
      aria-label="Barra lateral"
      onMouseOver={showLabel}
      onMouseLeave={() => setTooltip(null)}
      onFocusCapture={showLabel}
      onBlurCapture={() => setTooltip(null)}
      onScrollCapture={() => setTooltip(null)}
      onClickCapture={() => setTooltip(null)}
      onKeyDown={(event) => { if (event.key === 'Escape') setTooltip(null) }}
    >
      <div className="brand sidebar-brand">
        <img className="sidebar-brand__logo" src={orbUrl} alt="FARO" />
        <div className="sidebar-brand__copy" aria-hidden={collapsed}><strong>FARO</strong><small>Personal operating system</small></div>
      </div>
      <div className="sidebar-toolbar">
        <button type="button" className="sidebar-collapse-toggle" aria-label={toggleLabel} aria-expanded={!collapsed} aria-controls={navId} data-sidebar-label={toggleLabel} onClick={onToggleCollapsed}>
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          <span>{collapsed ? 'Expandir menú' : 'Contraer menú'}</span>
        </button>
      </div>

      <nav id={navId} className="sidebar__nav sidebar-nav-v2" aria-label="Navegación principal">
        {navigationGroups.map((group) => {
          const children = group.children.filter((item) => !item.desktopOnly || desktop)
          if (!children.length) return null
          const isGroupActive = children.some((item) => navigationItemIsActive(item, pathname))
          const isExpanded = Boolean(openGroups[group.id]) || isGroupActive
          const GroupIcon = group.icon

          if (collapsed) return <section className="sidebar-rail-group" aria-label={group.label} key={group.id}>
            {children.map((item) => {
              const ItemIcon = item.icon
              return <NavLink key={item.id} to={item.route} aria-label={item.label} data-sidebar-label={item.label} className={`sidebar-rail-link ${navigationItemIsActive(item, pathname) ? 'sidebar-rail-link--active' : ''}`}>
                <ItemIcon size={19} aria-hidden="true" />
              </NavLink>
            })}
          </section>

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
            <button type="button" className="sidebar-group-toggle" aria-expanded={isExpanded} onClick={() => onToggleGroup(group.id)}>
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
        <NavLink to={settingsItem.route} aria-label={settingsItem.label} data-sidebar-label={settingsItem.label} className={`sidebar-child-link ${navigationItemIsActive(settingsItem, pathname) ? 'sidebar-child-link--active' : ''}`}>
          <settingsItem.icon size={18} aria-hidden="true" /><span>{settingsItem.label}</span>
        </NavLink>
        <button type="button" className="sidebar-child-link sidebar-child-link--button" aria-label="Cerrar sesión" data-sidebar-label="Cerrar sesión" onClick={() => void signOut()}>
          <LogOut size={18} aria-hidden="true" /><span>Cerrar sesión</span>
        </button>
      </div>
      {collapsed && tooltip && createPortal(<div className="sidebar-rail-tooltip" role="tooltip" style={{ top: tooltip.top }}>{tooltip.label}</div>, document.body)}
    </aside>
  )
}
