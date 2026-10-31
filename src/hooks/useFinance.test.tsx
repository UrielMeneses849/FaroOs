import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFinance } from './useFinance'
import type { FinanceData } from '../features/finance/financeTypes'
const mocks = vi.hoisted(() => ({ user: { id: 'one' }, load: vi.fn() }))
vi.mock('./auth', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../repositories/financeRepositories', () => ({ loadFinanceData: mocks.load }))
const data = (name: string) => ({ accounts: [{ id: name }] } as FinanceData)
beforeEach(() => { vi.clearAllMocks(); mocks.user={id:'one'}; mocks.load.mockResolvedValue(data('old')); Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}); Object.defineProperty(navigator,'onLine',{configurable:true,value:true}) })
afterEach(() => vi.restoreAllMocks())
describe('live Finance data when returning to the PWA', () => {
  it('refreshes after returning and reconnecting while ignoring hidden or offline focus', async () => {
    let time=100000
    vi.spyOn(Date,'now').mockImplementation(()=>time)
    const {result}=renderHook(()=>useFinance())
    await waitFor(()=>expect(result.current.loading).toBe(false))
    mocks.load.mockResolvedValue(data('new-motorcycle'))
    time+=31000
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'))})
    expect(result.current.data.accounts[0].id).toBe('new-motorcycle')
    expect(mocks.load).toHaveBeenCalledTimes(2)
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'})
    time+=31000
    await act(async()=>{window.dispatchEvent(new Event('focus'))})
    expect(mocks.load).toHaveBeenCalledTimes(2)
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'})
    await act(async()=>{window.dispatchEvent(new Event('online'))})
    expect(mocks.load).toHaveBeenCalledTimes(3)
  })
  it('discards a late response from another signed-in account', async () => {
    let finishOld!: (value: FinanceData)=>void
    mocks.load.mockImplementationOnce(()=>new Promise(resolve=>{finishOld=resolve}))
    const {result,rerender}=renderHook(()=>useFinance())
    await waitFor(()=>expect(mocks.load).toHaveBeenCalledTimes(1))
    mocks.user={id:'two'}; mocks.load.mockResolvedValue(data('second-owner'))
    rerender()
    await waitFor(()=>expect(result.current.loadedForUserId).toBe('two'))
    await act(async()=>finishOld(data('first-owner')))
    expect(result.current.data.accounts[0].id).toBe('second-owner')
    expect(result.current.loadedForUserId).toBe('two')
  })
})
