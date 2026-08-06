import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FaroVoiceProvider, useFaroVoice } from './FaroVoiceProvider'

const panel = vi.hoisted(() => vi.fn())
vi.mock('./VoicePanel', () => ({ VoicePanel: (props: unknown) => { panel(props); return <div data-testid="voice-panel" /> } }))

function Accesses() {
  const { openFaroVoice, surface, open } = useFaroVoice()
  return <><button onClick={() => openFaroVoice({ surface: 'dashboard' })}>Dashboard</button><button onClick={() => openFaroVoice({ surface: 'today' })}>Hoy</button><button onClick={() => openFaroVoice({ surface: 'finances' })}>Finanzas</button><output>{open ? surface : 'closed'}</output></>
}

describe('FaroVoiceProvider', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks() })
  it('abre una sola instancia global con el contexto de cada superficie', () => {
    render(<FaroVoiceProvider><Accesses /></FaroVoiceProvider>)
    expect(screen.getAllByTestId('voice-panel')).toHaveLength(1)
    fireEvent.click(screen.getByText('Dashboard')); expect(screen.getByText('dashboard')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Hoy')); expect(screen.getByText('today')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Finanzas')); expect(screen.getByText('finances')).toBeInTheDocument()
    expect(screen.getAllByTestId('voice-panel')).toHaveLength(1)
  })
})
