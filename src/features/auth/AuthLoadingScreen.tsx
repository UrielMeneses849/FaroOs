import { LoaderCircle } from 'lucide-react'

export function AuthLoadingScreen() {
  return (
    <main className="auth-loading" role="status" aria-live="polite">
      <div className="brand__mark" aria-hidden="true"><span /></div>
      <LoaderCircle className="spin" aria-hidden="true" />
      <p>Preparando tu espacio</p>
    </main>
  )
}
