import { useCallback, useEffect, useState } from 'react'
import { authenticateDesktopBiometrics, getDesktopBiometricStatus, isFaroDesktop } from '../desktop/desktopBridge'

type JournalBiometricPhase = 'checking' | 'setup' | 'locked' | 'enrolling' | 'unlocking' | 'unlocked' | 'unsupported'
type BiometricMethod = 'desktop-touch-id' | 'web-authn' | 'unsupported'

const keyFor = (userId?: string) => `faro:journal-biometric:${userId ?? 'local'}`
const NATIVE_TOUCH_ID_MARKER = 'native-touch-id'

function randomBytes(length: number) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function toBase64(value: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function savedCredential(userId?: string) {
  try { return localStorage.getItem(keyFor(userId)) }
  catch { return null }
}

async function supportsPlatformBiometrics() {
  if (typeof window === 'undefined' || !navigator.credentials || typeof PublicKeyCredential === 'undefined') return false
  const available = PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable
  return typeof available === 'function' && available.call(PublicKeyCredential)
}

async function getBiometricMethod(): Promise<{ method: BiometricMethod, reason?: string }> {
  if (isFaroDesktop()) {
    const status = await getDesktopBiometricStatus()
    if (status?.available) return { method: 'desktop-touch-id' }
    return { method: 'unsupported', reason: status?.reason ?? 'Touch ID no está configurado en este Mac.' }
  }

  return (await supportsPlatformBiometrics())
    ? { method: 'web-authn' }
    : { method: 'unsupported' }
}

function biometricError(reason: unknown, fallback: string) {
  if (reason instanceof DOMException && reason.name === 'NotAllowedError') return 'No se confirmó la huella. Intenta de nuevo cuando estés listo.'
  if (typeof reason === 'string') {
    if (/cancel|canceled|cancelled/i.test(reason)) return 'No se confirmó Touch ID. Intenta de nuevo cuando estés listo.'
    return reason
  }
  return reason instanceof Error ? reason.message : fallback
}

export function useJournalBiometricLock(userId?: string) {
  const [phase, setPhase] = useState<JournalBiometricPhase>('checking')
  const [error, setError] = useState('')
  const [method, setMethod] = useState<BiometricMethod>('unsupported')
  const [unavailableReason, setUnavailableReason] = useState('')

  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (!active) return
      setPhase('checking'); setError(''); setUnavailableReason('')
    })
    void getBiometricMethod().then(({ method: nextMethod, reason }) => {
      if (!active) return
      setMethod(nextMethod)
      setUnavailableReason(reason ?? '')
      setPhase(nextMethod === 'unsupported' ? 'unsupported' : (savedCredential(userId) ? 'locked' : 'setup'))
    }).catch(() => {
      if (!active) return
      setMethod('unsupported')
      setUnavailableReason(isFaroDesktop() ? 'No fue posible consultar Touch ID en este Mac.' : '')
      setPhase('unsupported')
    })
    return () => { active = false }
  }, [userId])

  const enroll = useCallback(async () => {
    setError(''); setPhase('enrolling')
    try {
      if (method === 'desktop-touch-id') {
        await authenticateDesktopBiometrics('proteger tu diario privado en FARO')
        localStorage.setItem(keyFor(userId), NATIVE_TOUCH_ID_MARKER)
        setPhase('unlocked')
        return
      }
      if (method !== 'web-authn' || !await supportsPlatformBiometrics()) throw new Error('Este dispositivo no tiene una huella disponible para FARO.')
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: 'FARO OS · Diario' },
          user: { id: randomBytes(16), name: `journal-${userId ?? 'local'}`, displayName: 'Diario privado FARO' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
          timeout: 60_000,
          attestation: 'none',
        },
      }) as PublicKeyCredential | null
      if (!credential?.rawId) throw new Error('No se pudo registrar la huella en este dispositivo.')
      localStorage.setItem(keyFor(userId), toBase64(credential.rawId))
      setPhase('unlocked')
    } catch (reason) {
      setError(biometricError(reason, 'No se pudo activar la protección biométrica.'))
      setPhase('setup')
    }
  }, [method, userId])

  const unlock = useCallback(async () => {
    const credentialId = savedCredential(userId)
    if (!credentialId) { setPhase('setup'); return }
    setError(''); setPhase('unlocking')
    try {
      if (method === 'desktop-touch-id') {
        await authenticateDesktopBiometrics('desbloquear tu diario privado en FARO')
        setPhase('unlocked')
        return
      }
      if (method !== 'web-authn') throw new Error('Este dispositivo no tiene una huella disponible para FARO.')
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [{ type: 'public-key', id: fromBase64(credentialId), transports: ['internal'] }],
          userVerification: 'required',
          timeout: 60_000,
        },
      }) as PublicKeyCredential | null
      if (!assertion?.rawId) throw new Error('No se pudo verificar la huella.')
      setPhase('unlocked')
    } catch (reason) {
      setError(biometricError(reason, 'No se pudo desbloquear el diario.'))
      setPhase('locked')
    }
  }, [method, userId])

  const continueWithoutBiometrics = useCallback(() => setPhase('unlocked'), [])

  return { phase, error, method, unavailableReason, enroll, unlock, continueWithoutBiometrics }
}

export type { JournalBiometricPhase }
