import { createClient } from 'npm:@supabase/supabase-js@2'
import { googleErrorDetails, googleReadOnlyScopes } from './googleCalendarPure.ts'

export const googleScopes = [...googleReadOnlyScopes]

export const serviceClient = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

export async function authenticatedUser(request: Request) {
  const auth = request.headers.get('Authorization')
  if (!auth) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  })
  const { data: { user } } = await client.auth.getUser()
  return user
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

async function encryptionKey() {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new Error('Falta la clave server-only para proteger Google Calendar.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptRefreshToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value))
  return { encrypted: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) }
}

export async function decryptRefreshToken(encrypted: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(encrypted))
  return new TextDecoder().decode(decrypted)
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomState() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export class GoogleApiError extends Error {
  constructor(public status: number, public reason: string, message: string) {
    super(message)
    this.name = 'GoogleApiError'
  }
}

export async function accessToken(refreshToken: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.access_token) {
    const details = googleErrorDetails(response.status, payload)
    throw new GoogleApiError(details.status, details.reason, details.message)
  }
  return payload.access_token as string
}

export async function revokeGoogleToken(token: string) {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  })
  if (!response.ok) throw new Error('Google no pudo revocar la autorización anterior.')
}

export async function googleJson(url: string, token: string) {
  return googleRequest(url, token)
}

export async function googleRequest(url: string, token: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const details = googleErrorDetails(response.status, payload)
    throw new GoogleApiError(details.status, details.reason, details.message)
  }
  return payload
}
