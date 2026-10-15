import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionInvalidatedError, SessionLifecycle } from './session-lifecycle.js'

afterEach(() => vi.useRealTimers())

describe('SessionLifecycle', () => {
  it('joins concurrent callers and releases the completed flight', async () => {
    const lifecycle = new SessionLifecycle<number>()
    const operation = vi.fn(async () => 1)
    const first = lifecycle.run(operation)
    expect(lifecycle.run(operation)).toBe(first)
    await expect(first).resolves.toBe(1)
    await expect(lifecycle.run(operation)).resolves.toBe(1)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('rejects an operation queued before sign out without invoking transport', async () => {
    const lifecycle = new SessionLifecycle<number>()
    const operation = vi.fn(async () => 1)
    const result = lifecycle.run(operation)
    lifecycle.invalidate()
    await expect(result).rejects.toBeInstanceOf(SessionInvalidatedError)
    expect(operation).not.toHaveBeenCalled()
  })

  it('an old completion cannot release a newer in-flight operation', async () => {
    const lifecycle = new SessionLifecycle<number>()
    let releaseOld!: (value: number) => void
    let releaseNew!: (value: number) => void
    const old = lifecycle.run(() => new Promise(resolve => { releaseOld = resolve }))
    await Promise.resolve()
    lifecycle.invalidate()
    const current = lifecycle.run(() => new Promise(resolve => { releaseNew = resolve }))
    await Promise.resolve()
    releaseOld(1)
    await old
    expect(lifecycle.run(async () => 99)).toBe(current)
    releaseNew(2)
    await expect(current).resolves.toBe(2)
  })

  it('cancels the previous session timer on replacement', async () => {
    vi.useFakeTimers()
    const lifecycle = new SessionLifecycle<number>()
    const callback = vi.fn()
    lifecycle.scheduleAt(Date.now() + 100, callback)
    lifecycle.invalidate()
    await vi.advanceTimersByTimeAsync(100)
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not overflow a browser timeout for a distant deadline', async () => {
    vi.useFakeTimers()
    const lifecycle = new SessionLifecycle<number>()
    const callback = vi.fn()
    lifecycle.scheduleAt(Date.now() + 2_147_483_648, callback)
    await vi.advanceTimersByTimeAsync(2_147_483_647)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledOnce()
  })
})
