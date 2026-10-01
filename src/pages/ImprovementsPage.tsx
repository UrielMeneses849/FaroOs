import { Bug, Lightbulb, Rocket, Send } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button, EmptyState } from '../components/common'
import { PageHeader } from '../components/layout'
import { useAuth } from '../hooks/auth'
import { supabase } from '../lib/supabase/client'

type Kind = 'hotfix' | 'evolution' | 'feature'
type Item = { id:string; title:string; description?:string; kind:Kind; area:string; status:string; created_at:string }
// This table is deployed ahead of the generated Supabase client types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table:string) => any }
const kinds: Array<{ id:Kind; label:string; copy:string; Icon:typeof Bug }> = [
  { id:'hotfix', label:'HotFix', copy:'Algo roto, confuso o urgente.', Icon:Bug },
  { id:'evolution', label:'Evolutivo', copy:'Mejorar lo que ya existe.', Icon:Lightbulb },
  { id:'feature', label:'Nueva feature', copy:'Una capacidad nueva para FARO.', Icon:Rocket },
]
const areas = ['General', 'Dashboard', 'Calendario', 'Backlog', 'Finanzas', 'Salud', 'FARO Voice', 'FinOps', 'Storage', 'Vault']
export function ImprovementsPage() {
  const { user } = useAuth(); const [items,setItems]=useState<Item[]>([]); const [title,setTitle]=useState(''); const [description,setDescription]=useState(''); const [kind,setKind]=useState<Kind>('evolution'); const [area,setArea]=useState('General'); const [saving,setSaving]=useState(false); const [error,setError]=useState('')
  const load=useCallback(()=>{ if(user) void db.from('faro_improvements').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).then(({data,error}:{data:Item[]|null;error:{message:string}|null})=>{if(error)setError(error.message);else setItems(data??[])}) },[user])
  useEffect(()=>{load()},[load])
  const counts = kinds.map(({ id }) => ({ id, count:items.filter(item=>item.kind===id).length }))
  const submit=async(event:FormEvent)=>{event.preventDefault();if(!user||title.trim().length<2)return;setSaving(true);setError('');const {error}=await db.from('faro_improvements').insert({user_id:user.id,title:title.trim(),description:description.trim()||null,kind,area});setSaving(false);if(error){setError(error.message);return}setTitle('');setDescription('');load()}
  return <div className="page improvements-page"><PageHeader eyebrow="Producto interno" title="Mejoras FARO" description="Captura hallazgos de producto, clasifícalos y vincúlalos al área que necesita atención." /><div className="improvements-summary">{kinds.map(({id,label,Icon})=><div key={id} data-kind={id}><Icon size={15}/><span>{label}</span><strong>{counts.find(item=>item.id===id)?.count ?? 0}</strong></div>)}</div><div className="improvements-layout"><form className="improvements-capture" onSubmit={submit}><header><span className="eyebrow">Nueva observación</span><h2>¿Qué mejorarías?</h2><p>Describe el problema desde el lugar donde lo encontraste.</p></header><label>Área de FARO<select value={area} onChange={event=>setArea(event.target.value)}>{areas.map(value=><option key={value}>{value}</option>)}</select></label><label>Título<input autoFocus value={title} onChange={event=>setTitle(event.target.value)} placeholder="Ej. El modal de calendario tarda en abrir" required minLength={2}/></label><label>Contexto <small>opcional</small><textarea rows={4} value={description} onChange={event=>setDescription(event.target.value)} placeholder="Qué pasó, dónde lo viste y cómo esperabas que funcionara."/></label><div className="improvements-kinds">{kinds.map(({id,label,copy,Icon})=><button key={id} type="button" className={kind===id?'active':''} onClick={()=>setKind(id)}><Icon size={16}/><strong>{label}</strong><span>{copy}</span></button>)}</div>{error&&<p className="form-error">{error}</p>}<Button type="submit" icon={<Send size={15}/>} disabled={saving}>{saving?'Guardando…':'Guardar mejora'}</Button></form><section className="improvements-list"><header><div><span className="eyebrow">Bandeja</span><h2>Por revisar</h2></div><small>{items.length} observaciones</small></header>{items.length?items.map(item=>{const meta=kinds.find(value=>value.id===item.kind)!;const Icon=meta.Icon;return <article key={item.id} data-kind={item.kind}><Icon size={16}/><div><span>{item.area} · {meta.label}</span><strong>{item.title}</strong>{item.description&&<p>{item.description}</p>}</div><time>{new Date(item.created_at).toLocaleDateString('es-MX',{day:'numeric',month:'short'})}</time></article>}):<EmptyState title="Tu bandeja está limpia" description="Cuando algo de FARO te haga ruido, déjalo aquí con su área y tipo."/>}</section></div></div>
}
