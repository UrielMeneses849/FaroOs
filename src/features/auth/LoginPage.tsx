import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Compass, UserPlus } from 'lucide-react'
import { Button, FormField } from '../../components/common'
import { useAuth } from '../../hooks/auth'
import { loginSchema, type LoginFields } from './loginSchema'

interface LocationState {
  from?: { pathname?: string }
}

export function LoginPage() {
  const { loading: authLoading, session, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [fields, setFields] = useState<LoginFields>({ email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof LoginFields, string>>>({})
  const [feedback, setFeedback] = useState('')
  const [action, setAction] = useState<'signIn' | 'signUp' | null>(null)

  const destination =
    (location.state as LocationState | null)?.from?.pathname ?? '/dashboard'

  if (!authLoading && session) {
    return <Navigate to={destination} replace />
  }

  const validate = () => {
    const result = loginSchema.safeParse(fields)
    if (result.success) {
      setErrors({})
      return result.data
    }

    const fieldErrors = result.error.flatten().fieldErrors
    setErrors({
      email: fieldErrors.email?.[0],
      password: fieldErrors.password?.[0],
    })
    return null
  }

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault()
    const credentials = validate()
    if (!credentials) return

    setAction('signIn')
    setFeedback('')
    const { error } = await signIn(credentials)
    setAction(null)

    if (error) {
      setFeedback(error.message)
      return
    }
    navigate(destination, { replace: true })
  }

  const handleSignUp = async () => {
    const credentials = validate()
    if (!credentials) return

    setAction('signUp')
    setFeedback('')
    const { error } = await signUp(credentials)
    setAction(null)
    setFeedback(
      error
        ? error.message
        : 'Cuenta creada. Revisa tu correo si la confirmación está habilitada.',
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <header className="auth-brand">
          <div className="brand__mark" aria-hidden="true"><span /></div>
          <div><strong>FARO</strong><small>Personal OS</small></div>
        </header>

        <div className="auth-intro">
          <Compass size={20} aria-hidden="true" />
          <span>Tu dirección, en un solo lugar</span>
          <h1 id="login-title">Vuelve a tu centro.</h1>
          <p>Accede al espacio donde conviertes intención en progreso.</p>
        </div>

        <form className="auth-form" onSubmit={handleSignIn} noValidate>
          <FormField
            label="Correo"
            type="email"
            autoComplete="email"
            autoFocus
            value={fields.email}
            error={errors.email}
            onChange={(event) =>
              setFields((current) => ({ ...current, email: event.target.value }))
            }
          />
          <FormField
            label="Contraseña"
            type="password"
            autoComplete="current-password"
            value={fields.password}
            error={errors.password}
            onChange={(event) =>
              setFields((current) => ({ ...current, password: event.target.value }))
            }
          />

          {feedback && (
            <p className="auth-feedback" role="status" aria-live="polite">
              {feedback}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            loading={action === 'signIn'}
            disabled={action !== null || authLoading}
            icon={<ArrowRight size={17} />}
          >
            Entrar
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            loading={action === 'signUp'}
            disabled={action !== null || authLoading}
            icon={<UserPlus size={17} />}
            onClick={handleSignUp}
          >
            Crear cuenta
          </Button>
          <button
            type="button"
            className="auth-forgot"
            onClick={() =>
              setFeedback('La recuperación de contraseña estará disponible próximamente.')
            }
          >
            Olvidé mi contraseña
          </button>
        </form>
      </section>
    </main>
  )
}
