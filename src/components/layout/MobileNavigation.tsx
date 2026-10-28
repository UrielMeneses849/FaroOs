import { House, Plus, SquareCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { mobileItems } from '../../app/navigation'

const mobileLabel = (label: string) => label === 'Dashboard' ? 'Inicio' : label === 'Backlog' ? 'Pendientes' : label

export function MobileNavigation({ onQuick }: { onQuick: () => void }) {
  const [dashboard, backlog, calendar, finance] = mobileItems
  return (
    <nav className="mobile-nav mobile-nav--faro" aria-label="Navegación móvil">
      {[dashboard, backlog].map(({ route, label, icon: Icon }) => (
        <NavLink key={route} to={route} aria-label={mobileLabel(label)} className={({ isActive }) => `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`}>
          {label === 'Dashboard' ? <House size={20} aria-hidden="true" /> : label === 'Backlog' ? <SquareCheck size={20} aria-hidden="true" /> : <Icon size={20} aria-hidden="true" />}<span>{mobileLabel(label)}</span>
        </NavLink>
      ))}
      <button className="mobile-nav__link mobile-nav__create" aria-label="Crear nuevo" onClick={onQuick}><span><Plus size={23} aria-hidden="true" /></span><small>Nuevo</small></button>
      {[calendar, finance].map(({ route, label, icon: Icon }) => (
        <NavLink key={route} to={route} aria-label={mobileLabel(label)} className={({ isActive }) => `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`}>
          <Icon size={20} aria-hidden="true" /><span>{mobileLabel(label)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
