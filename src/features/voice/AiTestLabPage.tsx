import { FlaskConical, Landmark, LogOut, MessageSquareText, Settings2, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '../../components/common'
import { useAuth } from '../../hooks/auth'
import { FinancePage } from '../../pages/FinancePage'
import { AiLabConsole } from './AiLabConsole'
import { AiTestLab } from './AiTestLab'

type LabView = 'finance' | 'console' | 'setup'

export function AiTestLabPage() {
  const { user, signOut } = useAuth()
  const [view, setView] = useState<LabView>('finance')
  const isLab = user?.is_anonymous || user?.user_metadata?.faro_mode === 'ai_test_lab'

  if (!isLab) return <Navigate to="/settings" replace />

  return (
    <main className="lab-page lab-page--workspace">
      <header className="lab-page__header">
        <div className="lab-page__identity"><div className="brand__mark" aria-hidden="true"><span /></div><div><strong>FARO LAB</strong><small>Entorno aislado de pruebas</small></div></div>
        <Button variant="secondary" icon={<LogOut size={15} />} onClick={() => void signOut()}>Salir del laboratorio</Button>
      </header>
      <section className="lab-page__hero">
        <FlaskConical aria-hidden="true" />
        <div><span>SESIÓN TEMPORAL · {user?.id.slice(0, 8)}</span><h1>Prueba sin tocar tu vida real.</h1><p>Es el mismo motor financiero y las mismas reglas de FARO, ejecutados con una identidad y datos independientes.</p></div>
        <div className="lab-page__seal"><ShieldCheck size={17} /><span>RLS + usuario independiente</span></div>
      </section>

      <nav className="lab-page__nav" aria-label="Secciones del laboratorio">
        <button type="button" className={view === 'finance' ? 'is-active' : ''} onClick={() => setView('finance')}><Landmark size={16} /><span>Finanzas de prueba</span></button>
        <button type="button" className={view === 'console' ? 'is-active' : ''} onClick={() => setView('console')}><MessageSquareText size={16} /><span>Consola FARO</span></button>
        <button type="button" className={view === 'setup' ? 'is-active' : ''} onClick={() => setView('setup')}><Settings2 size={16} /><span>Configuración</span></button>
      </nav>

      {view === 'finance' && <section className="lab-workspace"><div className="lab-workspace__intro"><div><span>MÓDULO REAL · DATOS DE PRUEBA</span><h2>Tus reglas financieras, sin tu información personal</h2><p>Crea, edita, elimina y valida movimientos exactamente como en FARO. Usa NU Pruebas y BBVA Pruebas para identificar este entorno.</p></div><Button icon={<MessageSquareText size={15} />} onClick={() => setView('console')}>Probar con un prompt</Button></div><div className="lab-finance"><FinancePage /></div></section>}
      {view === 'console' && <AiLabConsole onOpenFinance={() => setView('finance')} />}
      {view === 'setup' && <AiTestLab onPrepared={() => setView('finance')} />}
      <p className="lab-page__footnote">Esta sesión vive en este navegador. Si cierras sesión, perderás el acceso a esta identidad temporal.</p>
    </main>
  )
}
