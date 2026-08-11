import { corsHeaders, json } from '../_shared/http.ts'
import { accessToken, authenticatedUser, decryptRefreshToken, GoogleApiError, googleJson, googleRequest, revokeGoogleToken, serviceClient } from '../_shared/googleCalendar.ts'
import { googleEventsUrl, maskCalendarId } from '../_shared/googleCalendarPure.ts'

type Connection = { id:string;user_id:string;google_account_email:string|null;calendar_id:string|null;calendar_name:string|null;encrypted_refresh_token:string;refresh_token_iv:string;connected_at:string;last_synced_at:string|null;status:string;granted_scopes?:string[];calendar_access_role?:string|null;write_enabled?:boolean }

const publicConnection = (connection: Connection | null) => connection ? ({
  connected: true, accountEmail: connection.google_account_email, calendarId: connection.calendar_id,
  calendarName: connection.calendar_name, connectedAt: connection.connected_at,
  lastSyncedAt: connection.last_synced_at,
  status: connection.granted_scopes?.includes('https://www.googleapis.com/auth/calendar.events')
    ? 'reconnect_required'
    : connection.status === 'reconnect_required' ? (connection.calendar_id ? 'active' : 'needs_calendar') : connection.status,
  accessRole: connection.calendar_access_role, scopes: connection.granted_scopes ?? [],
  writeEnabled: false,
}) : ({ connected: false, status: 'disconnected' })

function logGoogle(action: string, userId: string, calendarId: string | null, stage: string, error?: unknown) {
  const googleError = error instanceof GoogleApiError ? error : null
  const details = {
    action,
    user_id: userId,
    calendar_id: maskCalendarId(calendarId),
    stage,
    ...(googleError ? { google_status: googleError.status, google_reason: googleError.reason } : {}),
  }
  if (error) console.error('[google-calendar-api]', details)
  else console.info('[google-calendar-api]', details)
}

function googleFailure(error: unknown, code: string, fallback: string) {
  if (!(error instanceof GoogleApiError)) return json({ error: code, message: fallback }, 500)
  const message = error.status === 401
    ? 'La autorización de Google expiró. Vuelve a conectar Google Calendar.'
    : error.status === 403
      ? 'Google no permitió leer este calendario. Confirma que siga compartido con la cuenta conectada.'
      : error.status === 404
        ? 'Google ya no encuentra el calendario seleccionado. Selecciona otro calendario.'
        : fallback
  return json({ error: code, message, googleStatus: error.status, googleReason: error.reason }, error.status >= 400 && error.status < 500 ? error.status : 502)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405)
  const user = await authenticatedUser(request)
  if (!user || user.is_anonymous) return json({ error: 'Se requiere una sesión personal válida.' }, 401)
  const body = await request.json().catch(() => ({}))
  const action = String(body.action ?? 'status')
  const db = serviceClient()
  const { data } = await db.from('google_calendar_connections').select('*').eq('user_id', user.id).maybeSingle()
  const connection = data as Connection | null
  logGoogle(action, user.id, connection?.calendar_id ?? null, 'request')
  if (action === 'status') return json({ connection: publicConnection(connection) })
  if (action === 'disconnect') {
    if (connection) {
      try { await revokeGoogleToken(await decryptRefreshToken(connection.encrypted_refresh_token, connection.refresh_token_iv)) }
      catch (error) { logGoogle(action, user.id, connection.calendar_id, 'revoke_legacy_grant', error) }
      await db.from('google_calendar_connections').delete().eq('user_id', user.id)
    }
    return json({ connection: publicConnection(null) })
  }
  if (!connection) return json({ error: 'Google Calendar no está conectado.', code: 'not_connected' }, 409)
  const needsWrite = ['insert','patch','delete'].includes(action)
  if (needsWrite) return json({ error: 'google_read_only', message: 'Google Calendar es una fuente de solo lectura en FARO.' }, 403)
  let refreshToken: string
  try { refreshToken = await decryptRefreshToken(connection.encrypted_refresh_token, connection.refresh_token_iv) }
  catch (error) {
    logGoogle(action, user.id, connection.calendar_id, 'decrypt_refresh_token', error)
    return json({ error: 'google_token_decrypt_failed', message: 'No pudimos leer de forma segura la conexión de Google. Reconecta el calendario.' }, 500)
  }
  let token: string
  try { token = await accessToken(refreshToken) }
  catch (error) {
    logGoogle(action, user.id, connection.calendar_id, 'refresh_access_token', error)
    if (error instanceof GoogleApiError && (error.status === 400 || error.status === 401)) {
      await db.from('google_calendar_connections').update({ status: 'reconnect_required', updated_at: new Date().toISOString() }).eq('id', connection.id)
    }
    return googleFailure(error, 'google_token_refresh_failed', 'Google no pudo renovar la autorización. Intenta nuevamente o reconecta el calendario.')
  }
  if (action === 'list' || action === 'select') {
    let payload
    try { payload = await googleJson('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false', token) }
    catch (error) {
      logGoogle(action, user.id, connection.calendar_id, 'calendar_list', error)
      return googleFailure(error, 'google_calendar_list_failed', 'No pudimos consultar los calendarios disponibles en Google.')
    }
    const calendars = (payload.items ?? []).map((item: Record<string, unknown>) => ({
      id: String(item.id), name: String(item.summaryOverride ?? item.summary ?? item.id),
      primary: Boolean(item.primary), accessRole: String(item.accessRole ?? 'reader'),
    }))
    if (action === 'list') return json({ calendars, connection: publicConnection(connection) })
    const selected = calendars.find((calendar: { id:string }) => calendar.id === body.calendarId)
    if (!selected) return json({ error: 'El calendario seleccionado ya no está disponible.' }, 400)
    const primary = calendars.find((calendar: { primary:boolean }) => calendar.primary)
    const now = new Date().toISOString()
    const { error: selectionError } = await db.from('google_calendar_connections').update({
      calendar_id: selected.id, calendar_name: selected.name,
      google_account_email: primary?.id ?? connection.google_account_email,
      calendar_access_role: selected.accessRole,
      write_enabled: false,
      status: 'active', updated_at: now,
    }).eq('id', connection.id)
    if (selectionError) {
      logGoogle(action, user.id, selected.id, 'persist_calendar_selection', selectionError)
      return json({ error: 'calendar_selection_failed', message: 'No pudimos guardar el calendario seleccionado. Intenta nuevamente.' }, 500)
    }
    return json({ connection: { ...publicConnection(connection), calendarId:selected.id, calendarName:selected.name, accountEmail:primary?.id, accessRole:selected.accessRole, writeEnabled:false, status:'active' } })
  }
  if (action === 'events') {
    if (!connection.calendar_id) return json({ error: 'Selecciona un calendario antes de sincronizar.', code: 'calendar_required' }, 409)
    const timeMin = new Date(String(body.timeMin)); const timeMax = new Date(String(body.timeMax))
    if (!Number.isFinite(timeMin.getTime()) || !Number.isFinite(timeMax.getTime()) || timeMax <= timeMin || timeMax.getTime() - timeMin.getTime() > 420 * 86_400_000) {
      logGoogle(action, user.id, connection.calendar_id, 'validate_event_range')
      return json({ error: 'invalid_event_range', message: 'El rango solicitado para sincronizar no es válido.' }, 400)
    }
    let payload
    try { payload = await googleJson(googleEventsUrl(connection.calendar_id, timeMin, timeMax), token) }
    catch (error) {
      logGoogle(action, user.id, connection.calendar_id, 'google_events_list', error)
      return googleFailure(error, 'google_events_failed', 'No pudimos sincronizar los eventos de Google Calendar.')
    }
    const syncedAt = new Date().toISOString()
    await db.from('google_calendar_connections').update({ last_synced_at: syncedAt, status: 'active', updated_at: syncedAt }).eq('id', connection.id)
    return json({ events: payload.items ?? [], calendarId: connection.calendar_id, calendarName: connection.calendar_name, lastSyncedAt: syncedAt })
  }
  if (action === 'freebusy') {
    const timeMin = new Date(String(body.timeMin)); const timeMax = new Date(String(body.timeMax))
    if (!connection.calendar_id || !Number.isFinite(timeMin.getTime()) || !Number.isFinite(timeMax.getTime()) || timeMax <= timeMin) return json({ error:'invalid_freebusy_range', message:'El rango de disponibilidad no es válido.' },400)
    try {
      const payload=await googleRequest('https://www.googleapis.com/calendar/v3/freeBusy',token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({timeMin:timeMin.toISOString(),timeMax:timeMax.toISOString(),timeZone:String(body.timeZone??'UTC'),items:[{id:connection.calendar_id}]})})
      return json({busy:payload.calendars?.[connection.calendar_id]?.busy??[]})
    } catch(error){return googleFailure(error,'google_freebusy_failed','No pudimos consultar la disponibilidad en Google Calendar.')}
  }
  if (action === 'get') {
    if (!connection.calendar_id) return json({ error:'calendar_required', message:'Selecciona un calendario antes de continuar.' },409)
    if (!['reader','writer','owner'].includes(connection.calendar_access_role??'reader')) return json({error:'calendar_access_denied',message:'Ya no tienes acceso al calendario seleccionado.'},403)
    const base=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events`
    const eventId=String(body.eventId??'')
    if(!eventId) return json({error:'event_required',message:'Falta identificar el evento.'},400)
    try {
      return json({event:await googleRequest(`${base}/${encodeURIComponent(eventId)}`,token)})
    } catch(error){return googleFailure(error,'google_event_get_failed','No pudimos leer el evento de Google Calendar.')}
  }
  return json({ error: 'Acción desconocida.' }, 400)
})
