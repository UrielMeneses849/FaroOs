import type { LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { PageHeader } from '../components/layout'
import { usePageCapture } from '../hooks/usePageCapture'

interface ComingSoonPageProps { title: string; description: string; icon: LucideIcon }

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps) {
  const { capture } = usePageCapture()
  const reduceMotion = useReducedMotion()
  return (
    <div className="page">
      <PageHeader eyebrow="FARO OS / Módulo" title={title} description={description} onCapture={capture} />
      <motion.section className="coming-soon" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <div className="coming-soon__orb"><Icon size={32} aria-hidden="true" /></div><span className="status-badge">Próximamente</span><h2>Un espacio con intención.</h2>
        <p>La arquitectura ya está preparada. Este módulo cobrará vida en una próxima etapa de FARO.</p><div className="coming-soon__line"><span /></div>
      </motion.section>
    </div>
  )
}
