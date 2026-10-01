import { corsHeaders, json } from '../_shared/http.ts'
import { authenticatedUser, googleScopes, randomState, serviceClient, sha256 } from '../_shared/googleCalendar.ts'
import { googleOAuthState } from '../_shared/googleCalendarPure.ts'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const user = await authenticatedUser(request)
  if (!user || user.is_anonymous) return json({ error: 'Se requiere una sesión personal válida.' }, 401)
  const body = await request.json().catch(() => ({}))
  const completionMode = body.completionMode === 'desktop' ? 'desktop' : 'web'
  const state = googleOAuthState(randomState(), completionMode)
  const db = serviceClient()
  const { error } = await db.from('google_calendar_oauth_states').insert({
    user_id: user.id, state_hash: await sha256(state),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  })
  if (error) return json({ error: 'No se pudo iniciar la autorización.' }, 500)
  // Keep the current connection until OAuth completes. A revoked refresh token
  // cannot be revoked again, and a cancelled reconnection must not erase the
  // last known connection record.
  const params = new URLSearchParams({
    client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
    redirect_uri: Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')!,
    response_type: 'code', scope: googleScopes.join(' '), state,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false',
  })
  return json({ authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
})
