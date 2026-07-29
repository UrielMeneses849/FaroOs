import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type {
  AuthCredentials,
  AuthOperationResult,
} from '../services/authService'

export interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (credentials: AuthCredentials) => Promise<AuthOperationResult>
  signUp: (credentials: AuthCredentials) => Promise<AuthOperationResult>
  signOut: () => Promise<AuthOperationResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
