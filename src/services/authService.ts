import type {
  AuthChangeEvent,
  AuthError,
  Session,
  Subscription,
} from '@supabase/supabase-js'
import { supabase } from '../lib/supabase/client'

export interface AuthCredentials {
  email: string
  password: string
}

export interface AuthOperationResult {
  error: AuthError | null
}

export interface AuthService {
  getSession: () => Promise<Session | null>
  subscribe: (
    callback: (event: AuthChangeEvent, session: Session | null) => void,
  ) => Subscription
  signIn: (credentials: AuthCredentials) => Promise<AuthOperationResult>
  signUp: (credentials: AuthCredentials) => Promise<AuthOperationResult>
  signOut: () => Promise<AuthOperationResult>
}

export const authService: AuthService = {
  async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session
  },
  subscribe(callback) {
    return supabase.auth.onAuthStateChange(callback).data.subscription
  },
  async signIn(credentials) {
    const { error } = await supabase.auth.signInWithPassword(credentials)
    return { error }
  },
  async signUp(credentials) {
    const { error } = await supabase.auth.signUp(credentials)
    return { error }
  },
  async signOut() {
    const { error } = await supabase.auth.signOut()
    return { error }
  },
}
