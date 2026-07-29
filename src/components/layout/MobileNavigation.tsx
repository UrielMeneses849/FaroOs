import { MoreHorizontal } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { mobileItems } from '../../app/navigation'

export function MobileNavigation({ onMore }: { onMore: () => void }) {
  return (
    <nav className="mobile-nav" aria-label="Navegación móvil">
      {mobileItems.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={path} className={({ isActive }) => `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`}>
          <Icon size={20} aria-hidden="true" /><span>{label}</span>
        </NavLink>
      ))}
      <button className="mobile-nav__link" onClick={onMore}><MoreHorizontal size={20} aria-hidden="true" /><span>Más</span></button>
    </nav>
  )
}
