import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { authService, type AuthService } from '../services/authService'
import { AuthContext } from './AuthContext'

interface AuthProviderProps {
  children: ReactNode
  service?: AuthService
}

export function AuthProvider({
  children,
  service = authService,
}: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const subscription = service.subscribe((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setLoading(false)
    })

    void service
      .getSession()
      .then((storedSession) => {
        if (active) setSession(storedSession)
      })
      .catch(() => {
        if (active) setSession(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [service])

  const value = useMemo(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      signIn: service.signIn,
      signUp: service.signUp,
      signOut: service.signOut,
    }),
    [loading, service, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
