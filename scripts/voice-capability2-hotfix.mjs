import { createClient } from '@supabase/supabase-js'

const url=process.env.VITE_SUPABASE_URL
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if(!url||!key)throw new Error('Faltan variables públicas de Supabase.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
const auth=await client.auth.signInAnonymously({options:{data:{faro_mode:'ai_test_lab'}}})
if(auth.error||!auth.data.session)throw auth.error??new Error('No se creó la sesión Lab.')
const headers={Authorization:`Bearer ${auth.data.session.access_token}`,apikey:key,'Content-Type':'application/json'}
const localContext={now:'2026-08-09T01:00:00.000Z',timezone:'America/Mexico_City',calendarItems:[]}
const sessionId=crypto.randomUUID()
let context={sessionId,lastSkill:'calendar',lastResults:[]}

async function edge(body){const response=await fetch(`${url}/functions/v1/faro-voice`,{method:'POST',headers,body:JSON.stringify(body)});const data=await response.json();return{response,data}}
async function say(message){const {response,data}=await edge({requestId:crypto.randomUUID(),sessionId,source:'text',message,history:[],surface:'lab',pipeline:'optimized',localContext,sessionContext:context});if(!response.ok)throw new Error(`${response.status}: ${data.message}`);const payload=data.result&&typeof data.result==='object'?data.result:{};context={...context,lastSkill:data.qa?.skill??context.lastSkill,lastResults:payload.references??context.lastResults,pendingClarification:payload.pendingClarification,pendingAction:data.pendingAction};return data}
async function confirm(action){const {response,data}=await edge({type:'confirm',requestId:action.requestId});if(!response.ok||data.status!=='completed'){const log=await client.from('voice_action_logs').select('error_message,execution_status,tool_arguments').eq('request_id',action.requestId).maybeSingle();throw new Error(`${response.status}: ${data.message} · ${log.data?.error_message??log.error?.message??'sin detalle'}`)}if(data.result?.reference)context={...context,lastResults:[data.result.reference],pendingAction:undefined,pendingClarification:undefined};return data}

const prepared=await client.rpc('prepare_ai_calendar_scenario',{p_anchor_date:'2026-08-08',p_confirm_is_test_user:true})
if(prepared.error)throw prepared.error

const read=await say('¿Qué tengo mañana?')
if(/\b\d{2}:\d{2}\b/.test(read.message)||!read.message.includes('de la mañana'))throw new Error(`Hora no natural: ${read.message}`)
const googleReference=read.result?.references?.find((item)=>item.type==='google_event')
if(!googleReference)throw new Error('El evento Google no participó en la lectura.')

const conflict=await say('Agrega mañana a las 5 pm un evento llamado Conflicto con Google')
if(conflict.status!=='needs_clarification'||!conflict.message.includes('Google Calendar'))throw new Error(`No detectó conflicto Google: ${conflict.message}`)
context={...context,pendingClarification:undefined,lastResults:[googleReference]}
const blockedGoogle=await say('Muévelo a las 10')
if(blockedGoogle.status!=='completed'||blockedGoogle.pendingAction||!blockedGoogle.message.includes('sólo tiene acceso de lectura'))throw new Error(`Google no quedó read-only: ${blockedGoogle.message}`)

context={...context,lastResults:[],pendingClarification:undefined}
const proposal=await say('Agrega mañana a las 12 del día un evento llamado Salida con Iris')
if(proposal.status!=='pending_confirmation'||proposal.pendingAction?.arguments?.provider!=='faro')throw new Error(`No propuso evento FARO: ${proposal.message}`)
const created=await confirm(proposal.pendingAction)
const id=created.result?.item?.id
if(!id)throw new Error('La confirmación no devolvió un ID persistido.')
let persisted=await client.from('calendar_entries').select('id,title,starts_at,ends_at').eq('id',id).single()
if(persisted.error||persisted.data.title!=='Salida con Iris')throw persisted.error??new Error('El evento no quedó persistido.')

const move=await say('Muévelo a las 4 pm')
if(!move.pendingAction)throw new Error(`No propuso mover: ${move.message}`)
await confirm(move.pendingAction)
persisted=await client.from('calendar_entries').select('id,title,starts_at,ends_at').eq('id',id).single()
if(persisted.error||!persisted.data.starts_at.includes('22:00:00'))throw persisted.error??new Error(`Hora no actualizada: ${persisted.data.starts_at}`)

const rename=await say('Cámbiale el título a Comida con Iris')
if(!rename.pendingAction)throw new Error(`No propuso renombrar: ${rename.message}`)
await confirm(rename.pendingAction)
persisted=await client.from('calendar_entries').select('id,title,starts_at,ends_at').eq('id',id).single()
if(persisted.error||persisted.data.title!=='Comida con Iris')throw persisted.error??new Error(`Título no actualizado: ${persisted.data.title}`)

const remove=await say('Elimínalo')
if(!remove.pendingAction)throw new Error(`No propuso eliminar: ${remove.message}`)
await confirm(remove.pendingAction)
const remaining=await client.from('calendar_entries').select('id').eq('id',id)
if(remaining.error||remaining.data.length)throw remaining.error??new Error('El evento sigue persistido después de eliminar.')

await client.auth.signOut()
console.log(JSON.stringify({read:read.message,googleConflict:conflict.message,googleMutation:blockGoogleMessage(blockedGoogle.message),created:true,moved:true,renamed:true,deleted:true},null,2))

function blockGoogleMessage(message){return message}
