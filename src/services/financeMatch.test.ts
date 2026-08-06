import {describe,expect,it} from 'vitest'
import {matchFinanceCandidates,type FinanceCandidate} from '../../supabase/functions/_shared/financeMatch'
const candidates:FinanceCandidate[]=[
 {id:'license',description:'Licencia Moto',kind:'transaction',type:'expense',amount:1300,status:'planned'},
 {id:'car',description:'Gasolina Attitude',kind:'recurring',type:'expense',amount:750,status:'pending'},
 {id:'bike',description:'Gasolina Moto',kind:'recurring',type:'expense',amount:250,status:'pending'},
 {id:'salary',description:'Sueldo BBVA Q1',kind:'recurring',type:'income',amount:7000,status:'pending'},
]
describe('coincidencias financieras',()=>{
 it('reconoce variantes de licencia',()=>expect(matchFinanceCandidates('Acabo de pagar la licencia de mi moto',candidates)[0].candidate.id).toBe('license'))
 it('reconoce el sueldo existente',()=>expect(matchFinanceCandidates('Me cayó el sueldo de BBVA',candidates)[0].candidate.id).toBe('salary'))
 it('desambigua gasolina con el seguimiento carro',()=>expect(matchFinanceCandidates('Acabo de poner gasolina para el carro',candidates)[0].candidate.id).toBe('car'))
})
