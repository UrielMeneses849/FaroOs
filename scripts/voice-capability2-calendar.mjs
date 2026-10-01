import { createClient } from '@supabase/supabase-js'
import { performance } from 'node:perf_hooks'

const url=process.env.VITE_SUPABASE_URL
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if(!url||!key)throw new Error('Faltan variables públicas de Supabase.')
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
const auth=await client.auth.signInAnonymously({options:{data:{faro_mode:'ai_test_lab'}}})
if(auth.error||!auth.data.session)throw auth.error??new Error('No se creó la sesión Lab.')
const headers={Authorization:`Bearer ${auth.data.session.access_token}`,apikey:key,'Content-Type':'application/json'}
const localContext={now:'2026-08-09T01:00:00.000Z',timezone:'America/Mexico_City'}
const sessionId=crypto.randomUUID()
let context={sessionId,lastSkill:'calendar',lastResults:[]}
const samples=[]

async function edge(body){const started=performance.now();const response=await fetch(`${url}/functions/v1/faro-voice`,{method:'POST',headers,body:JSON.stringify(body)});const data=await response.json();samples.push({message:body.message??body.type,httpStatus:response.status,status:data.status,route:data.qa?.route,skill:data.qa?.skill,elapsedMs:Math.round((performance.now()-started)*100)/100});return{response,data}}
async function say(message){const result=await edge({requestId:crypto.randomUUID(),sessionId,source:'text',message,history:[],surface:'lab',pipeline:'optimized',localContext,sessionContext:context});const payload=result.data.result&&typeof result.data.result==='object'?result.data.result:{};context={...context,lastSkill:result.data.qa?.skill??context.lastSkill,lastResults:payload.references??context.lastResults,pendingClarification:payload.pendingClarification,pendingAction:result.data.pendingAction};return result}
async function confirm(action){const result=await edge({type:'confirm',requestId:action.requestId});if(result.data.result?.reference)context={...context,lastResults:[result.data.result.reference],pendingAction:undefined,pendingClarification:undefined};return result}

const prepared=await client.rpc('prepare_ai_calendar_scenario',{p_anchor_date:'2026-08-08',p_confirm_is_test_user:true})
if(prepared.error)throw prepared.error

const agenda=await say('¿Qué tengo mañana?')
const availability=await say('Encuéntrame un espacio de dos horas esta semana')
const scheduled=await say('Pon ahí una tarea de dos horas para trabajar en FARO')
if(!scheduled.data.pendingAction)throw new Error(`No se propuso la tarea sobre el hueco: ${scheduled.data.message}`)
const scheduledResult=await confirm(scheduled.data.pendingAction)
const movedTask=await say('Mejor muévela a las 11 pm')
if(!movedTask.data.pendingAction)throw new Error(`No se propuso mover la tarea: ${movedTask.data.message}`)
const movedTaskResult=await confirm(movedTask.data.pendingAction)
const conflict=await say('Agenda una reunión con Ana mañana a las 10')
if(conflict.data.status!=='needs_clarification'||!conflict.data.result?.references?.length)throw new Error(`No se detectó el conflicto: ${conflict.data.message}`)
const selected=await say('La segunda')
if(!selected.data.pendingAction)throw new Error(`No se propuso la segunda alternativa: ${selected.data.message}`)
const created=await confirm(selected.data.pendingAction)
if(created.data.status!=='completed')throw new Error(created.data.message)
const moved=await say('Mueve esa reunión a las 6 pm')
if(!moved.data.pendingAction)throw new Error(`No se propuso mover el evento: ${moved.data.message}`)
const updated=await confirm(moved.data.pendingAction)
const next=await say('¿Qué sigue?')

const createdId=created.data.result?.item?.id
const {data:events,error:eventsError}=await client.from('calendar_entries').select('id,title,starts_at,ends_at').eq('id',createdId)
if(eventsError)throw eventsError
await client.auth.signOut()
console.log(JSON.stringify({capturedAt:new Date().toISOString(),checks:{agendaCount:agenda.data.result?.data?.items?.length??0,availableSlots:availability.data.result?.data?.slots?.length??0,scheduledTask:scheduledResult.data.status==='completed',movedTask:movedTaskResult.data.status==='completed',conflictDetected:conflict.data.status==='needs_clarification',created:created.data.status==='completed',updated:updated.data.status==='completed',nextCommitment:Boolean(next.data.result?.data?.items?.length),persistedEvents:events?.length??0,persistedStart:events?.[0]?.starts_at},samples,failures:samples.filter(item=>item.httpStatus>=400)},null,2))
