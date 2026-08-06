const fillers = new Set(['de','del','la','el','mi','mis','un','una','por','para','ya','acabo','como','lo','los','las','me','este','esta','pago','pagar','pague','cobre','cobro','recibi','recibido','registra','marca'])
const aliases: Record<string,string[]> = { carro:['attitude'], auto:['attitude'], coche:['attitude'], quincena:['sueldo'], licencia:['renovacion'] }
export function financeTokens(value:string) { const base=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x&&x.length>2&&!fillers.has(x)); return [...new Set(base.flatMap(x=>[x,...(aliases[x]??[])]))] }
export interface FinanceCandidate { id:string; description:string; kind:'recurring'|'transaction'; type:'income'|'expense'; amount:number; status:string; accountName?:string; categoryName?:string; period?:string; expectedDate?:string }
export function matchFinanceCandidates(message:string,candidates:FinanceCandidate[]) {
  const input=financeTokens(message); const amount=Number(message.replace(/,/g,'').match(/\d+(?:\.\d+)?/)?.[0]??NaN)
  return candidates.map(candidate=>{ const target=financeTokens(`${candidate.description} ${candidate.accountName??''} ${candidate.categoryName??''}`); const hits=target.filter(x=>input.includes(x)).length; let score=target.length?hits/target.length:0; if(Number.isFinite(amount)&&Math.abs(amount-candidate.amount)<.005)score+=.35; return {candidate,score} }).filter(x=>x.score>=.34).sort((a,b)=>b.score-a.score)
}
