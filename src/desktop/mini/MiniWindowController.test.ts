import { describe, expect, it, vi } from 'vitest'
import { MiniWindowController } from './MiniWindowController'

describe('Mini native resize scheduling', () => {
  it('sends one request for 100 equivalent snapshots, with no per-frame resize', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const controller = new MiniWindowController(send)
    for (let index = 0; index < 100; index++) controller.present('listening', `fragment ${index}`)
    await Promise.resolve()
    expect(send).toHaveBeenCalledExactlyOnceWith('listening', false)
  })
  it('coalesces intermediate targets and never overlaps native requests', async () => {
    let done!: () => void
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve })).mockResolvedValue(undefined)
    const controller = new MiniWindowController(send)
    controller.present('ambient'); controller.present('peek'); controller.present('listening')
    expect(send).toHaveBeenCalledTimes(1)
    done(); await Promise.resolve(); await Promise.resolve()
    expect(send).toHaveBeenCalledTimes(2); expect(send).toHaveBeenLastCalledWith('listening', false)
  })
  it('sizes responses by content length and stops after disposal', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const controller = new MiniWindowController(send)
    controller.present('speaking', 'Listo.'); await Promise.resolve()
    controller.present('speaking', 'a'.repeat(100)); await Promise.resolve()
    expect(send).toHaveBeenLastCalledWith('speaking', true)
    controller.dispose(); controller.present('ambient'); expect(send).toHaveBeenCalledTimes(2)
  })
})
