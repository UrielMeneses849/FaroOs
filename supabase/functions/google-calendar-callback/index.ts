import { encryptRefreshToken, serviceClient, sha256 } from '../_shared/googleCalendar.ts'
import { calendarAppUrl } from '../_shared/googleCalendarPure.ts'

function appRedirect(result: 'connected' | 'error', reason?: string) {
  return Response.redirect(calendarAppUrl(Deno.env.get('APP_URL')!, result, reason), 302)
}

Deno.serve(async (request) => {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state || url.searchParams.has('error')) return appRedirect('error', 'oauth_denied')
  const db = serviceClient()
  const { data: oauthState } = await db.from('google_calendar_oauth_states').select('*')
    .eq('state_hash', await sha256(state)).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!oauthState) return appRedirect('error', 'invalid_state')
  await db.from('google_calendar_oauth_states').update({ used_at: new Date().toISOString() }).eq('id', oauthState.id)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: Deno.env.get('GOOGLE_CLIENT_ID')!, client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      redirect_uri: Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI')!, grant_type: 'authorization_code',
    }),
  })
  const tokens = await response.json()
  if (!response.ok || !tokens.refresh_token) return appRedirect('error', 'token_exchange')
  const protectedToken = await encryptRefreshToken(tokens.refresh_token)
  const grantedScopes = String(tokens.scope ?? '').split(/\s+/).filter(Boolean)
  const now = new Date().toISOString()
  const { error } = await db.from('google_calendar_connections').upsert({
    user_id: oauthState.user_id, encrypted_refresh_token: protectedToken.encrypted,
    refresh_token_iv: protectedToken.iv, calendar_id: null, calendar_name: null,
    google_account_email: null, status: 'needs_calendar',
    granted_scopes: grantedScopes, write_enabled: false,
    calendar_access_role: null, connected_at: now, updated_at: now,
  }, { onConflict: 'user_id' })
  return error ? appRedirect('error', 'storage') : appRedirect('connected')
})
