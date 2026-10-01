import { createClient } from '@supabase/supabase-js'
import { performance } from 'node:perf_hooks'

const url=process.env.VITE_SUPABASE_URL
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if(!url||!key)throw new Error('Faltan variables VITE_SUPABASE_URL/VITE_SUPABASE_PUBLISHABLE_KEY.')

const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
const auth=await client.auth.signInAnonymously({options:{data:{faro_mode:'ai_test_lab'}}})
if(auth.error||!auth.data.session)throw auth.error??new Error('No se creó la sesión Lab.')
const token=auth.data.session.access_token
const headers={Authorization:`Bearer ${token}`,apikey:key,'Content-Type':'application/json'}

async function edge(name,body){const started=performance.now();const response=await fetch(`${url}/functions/v1/${name}`,{method:'POST',headers,body:JSON.stringify(body)});let data;try{data=await response.json()}catch{data={message:await response.text()}}return{ok:response.ok,status:response.status,data,elapsedMs:performance.now()-started}}
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]??0}
const summary=values=>({n:values.length,p50Ms:Math.round(percentile(values,.5)*100)/100,p95Ms:Math.round(percentile(values,.95)*100)/100})
const scenarios=[
  'Gasté 350 en comida.',
  'Registra 1200 de ingreso en BBVA.',
  '¿Cuánto gasté hoy?',
  'Elimina el gasto de 500 de ayer.',
  'Cambia el gasto de 350 a Transporte.',
  'Registra el pago de Renta.',
  'Elimina ese gasto.',
]
const pipelines=(process.env.VOICE_BENCH_PIPELINES??'legacy,optimized').split(',').filter(value=>value==='legacy'||value==='optimized')
const repetitions=Math.max(1,Number(process.env.VOICE_BENCH_REPETITIONS??3))
const ttsRepetitions=Math.max(1,Number(process.env.VOICE_TTS_REPETITIONS??3))

const prepared=await client.rpc('prepare_ai_test_environment',{p_nu_balance:10000,p_bbva_balance:15000,p_personal_budget:3000,p_confirm_is_test_user:true})
if(prepared.error)throw prepared.error
const restoredAtStart=await client.rpc('restore_ai_finance_scenario',{p_confirm_is_test_user:true})
if(restoredAtStart.error)throw restoredAtStart.error

const samples=[]
for(const pipeline of pipelines){
  for(let repetition=0;repetition<repetitions;repetition++){
    for(const message of scenarios){
      const requestId=crypto.randomUUID();const sessionId=crypto.randomUUID();const started=performance.now()
      if(pipeline==='legacy')await new Promise(resolve=>setTimeout(resolve,250))
      const response=await edge('faro-voice',{requestId,sessionId,source:'text',message,history:[],surface:'lab',pipeline,trace:{startedAt:started,marks:{legacyClientDelayMs:pipeline==='legacy'?250:0}}})
      samples.push({pipeline,message,status:response.data.status,httpStatus:response.status,proposalMs:performance.now()-started,serverTotalMs:Number(response.data.qa?.timings?.serverTotalMs??0),route:response.data.qa?.route??'none'})
      if(response.data.pendingAction)await edge('faro-voice',{type:'cancel',requestId:response.data.pendingAction.requestId})
    }
  }
}

const {data:accounts}=await client.from('finance_accounts').select('id,name').eq('is_active',true)
const {data:categories}=await client.from('finance_categories').select('id,name,type').eq('is_active',true)
const nu=accounts?.find(item=>item.name==='NU Pruebas')
const food=categories?.find(item=>item.name==='Comida'&&item.type==='expense')
if(!nu||!food)throw new Error('El fixture Lab no contiene NU Pruebas/Comida.')

const uniqueAmount=86.64
const creation=await edge('faro-voice',{requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),source:'text',message:`Gasté ${uniqueAmount} en Comida desde NU Pruebas.`,history:[],surface:'lab',pipeline:'optimized'})
if(!creation.data.pendingAction)throw new Error(`No se propuso el alta: ${creation.data.message}`)
const confirmations=await Promise.all([
  edge('faro-voice',{type:'confirm',requestId:creation.data.pendingAction.requestId}),
  edge('faro-voice',{type:'confirm',requestId:creation.data.pendingAction.requestId}),
])
const {data:createdRows}=await client.from('finance_transactions').select('id,amount,category_id,account_id,status').eq('amount',uniqueAmount).eq('account_id',nu.id)

const update=await edge('faro-voice',{requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),source:'text',message:`Cambia el gasto de ${uniqueAmount} a Transporte.`,history:[],surface:'lab',pipeline:'optimized'})
if(update.data.pendingAction)await edge('faro-voice',{type:'confirm',requestId:update.data.pendingAction.requestId})
const transport=categories?.find(item=>item.name==='Transporte'&&item.type==='expense')
const {data:updatedRows}=await client.from('finance_transactions').select('id,category_id').eq('amount',uniqueAmount).eq('account_id',nu.id)

const deletion=await edge('faro-voice',{requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),source:'text',message:`Elimina el gasto de ${uniqueAmount} de hoy.`,history:[],surface:'lab',pipeline:'optimized'})
if(deletion.data.pendingAction){await edge('faro-voice',{type:'confirm',requestId:deletion.data.pendingAction.requestId});await edge('faro-voice',{type:'confirm',requestId:deletion.data.pendingAction.requestId})}
const {count:remaining}=await client.from('finance_transactions').select('id',{count:'exact',head:true}).eq('amount',uniqueAmount).eq('account_id',nu.id)

const recurring=await edge('faro-voice',{requestId:crypto.randomUUID(),sessionId:crypto.randomUUID(),source:'text',message:'Registra el pago de Renta.',history:[],surface:'lab',pipeline:'optimized'})
let recurringConfirmStatuses=[]
if(recurring.data.pendingAction)recurringConfirmStatuses=(await Promise.all([edge('faro-voice',{type:'confirm',requestId:recurring.data.pendingAction.requestId}),edge('faro-voice',{type:'confirm',requestId:recurring.data.pendingAction.requestId})])).map(item=>item.status)
const {data:recurringRows}=await client.from('finance_recurring_transactions').select('id').eq('description','Renta')
const recurringIds=(recurringRows??[]).map(item=>item.id)
const {data:recurringOccurrences}=recurringIds.length?await client.from('finance_recurring_occurrences').select('status,transaction_id').in('recurring_transaction_id',recurringIds):{data:[]}

async function tts(model){const started=performance.now();const response=await fetch(`${url}/functions/v1/faro-speech`,{method:'POST',headers,body:JSON.stringify({text:'FARO confirma el movimiento financiero.',model,stream:true})});if(!response.ok)throw new Error(`TTS ${model}: HTTP ${response.status} ${await response.text()}`);const reader=response.body?.getReader();let firstByteMs=Number.NaN;if(reader){while(true){const chunk=await reader.read();if(chunk.done)break;if(chunk.value?.byteLength&&!Number.isFinite(firstByteMs))firstByteMs=performance.now()-started}}return{model,providerModel:response.headers.get('x-faro-model-id'),firstByteMs:Math.round(firstByteMs*100)/100,totalDownloadMs:Math.round((performance.now()-started)*100)/100}}
const ttsResults=[]
for(const model of ['current','flash'])for(let index=0;index<ttsRepetitions;index++)ttsResults.push(await tts(model))

await client.rpc('restore_ai_finance_scenario',{p_confirm_is_test_user:true})
await client.auth.signOut()

const report={
  capturedAt:new Date().toISOString(),
  pipeline:Object.fromEntries(pipelines.map(pipeline=>{const rows=samples.filter(item=>item.pipeline===pipeline);return[pipeline,{proposal:summary(rows.map(item=>item.proposalMs)),server:summary(rows.map(item=>item.serverTotalMs).filter(Boolean)),routes:Object.fromEntries([...new Set(rows.map(item=>item.route))].map(route=>{const routeRows=rows.filter(item=>item.route===route);return[route,{count:routeRows.length,proposal:summary(routeRows.map(item=>item.proposalMs)),server:summary(routeRows.map(item=>item.serverTotalMs).filter(Boolean))}]}))}]})),
  tts:Object.fromEntries(['current','flash'].map(model=>{const rows=ttsResults.filter(item=>item.model===model);return[model,{firstByte:summary(rows.map(item=>item.firstByteMs)),download:summary(rows.map(item=>item.totalDownloadMs)),providerModel:rows[0]?.providerModel}]})),
  crud:{createCount:createdRows?.length??0,duplicateConfirmStatuses:confirmations.map(item=>item.status),updatedToTransport:Boolean(updatedRows?.[0]?.category_id===transport?.id),remainingAfterDelete:remaining??null,recurringConfirmStatuses,recurringPaidCount:(recurringOccurrences??[]).filter(item=>item.status==='paid'&&item.transaction_id).length},
  failures:samples.filter(item=>item.httpStatus>=500).map(item=>({pipeline:item.pipeline,message:item.message,httpStatus:item.httpStatus})),
}
console.log(JSON.stringify(report,null,2))
