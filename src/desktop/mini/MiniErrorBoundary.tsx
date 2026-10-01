import { Component, useEffect, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import orbUrl from '../../assets/faro-orb-v1.png'
function AmbientRecovery({ retry }: { retry: () => void }) {
  useEffect(() => { void invoke('mini_present', { state: 'ambient', long: false }).catch(() => {}) }, [])
  return <main className="mini-surface" data-state="ambient"><button className="mini-orb" onClick={retry} aria-label="Recuperar FARO Mini"><img src={orbUrl} alt="" /></button></main>
}
export class MiniErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <AmbientRecovery retry={() => this.setState({ failed: false })} /> : this.props.children }
}
