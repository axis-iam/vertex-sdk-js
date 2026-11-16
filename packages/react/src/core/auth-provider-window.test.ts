import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProviderWindow } from './auth-provider-window'

let popup: { closed: boolean; location: { href: string }; history: { replaceState: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> }
beforeEach(() => {
  vi.useFakeTimers()
  popup = { closed: false, location: { href: 'about:blank' }, history: { replaceState: vi.fn() }, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('automatic provider window ownership', () => {
  it('rejects a window closed between reading its callback and scrubbing history without an unhandled timer error', async () => {
    const helper = new AuthProviderWindow('/callback', 1000)
    const result = helper.start(async () => 'https://provider.test/')
    const rejection = expect(result).rejects.toMatchObject({ code: 'AUTH_PROVIDER_CLOSED' })
    await vi.advanceTimersByTimeAsync(1)
    popup.location.href = `${location.origin}/callback?code=one&state=bound`
    popup.history.replaceState.mockImplementation(() => { throw new DOMException('Window was detached', 'SecurityError') })
    await vi.advanceTimersByTimeAsync(50)
    await rejection
    expect(popup.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('accepts only the exact configured plain BFF return in server-session mode', async () => {
    const helper = new AuthProviderWindow('/login', 1000, 'server-session')
    const result = helper.start(async () => 'https://provider.test/')
    await vi.advanceTimersByTimeAsync(1)
    popup.location.href = `${location.origin}/login?code=injected`
    await vi.advanceTimersByTimeAsync(50)
    expect(popup.close).not.toHaveBeenCalled()
    popup.location.href = `${location.origin}/login`
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toBe(`${location.origin}/login`)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('automatically returns and scrubs only the exact popup and registered path/query', async () => {
    const helper = new AuthProviderWindow('/callback?app=one')
    const authorize = vi.fn(async () => 'https://provider.test/authorize')
    const result = helper.start(authorize)
    await vi.advanceTimersByTimeAsync(1)
    for (const wrong of ['https://wrong.test/callback?app=one&code=x&state=s', `${location.origin}/other?app=one&code=x&state=s`, `${location.origin}/callback?app=two&code=x&state=s`]) {
      popup.location.href = wrong
      await vi.advanceTimersByTimeAsync(50)
      expect(popup.close).not.toHaveBeenCalled()
    }
    // Messages from any origin/source have no listener and cannot complete authentication.
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, data: { code: 'injected' } }))
    expect(popup.close).not.toHaveBeenCalled()
    const url = `${location.origin}/callback?app=one&code=one&state=bound`
    popup.location.href = url
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toBe(url)
    expect(authorize).toHaveBeenCalledOnce()
    expect(popup.history.replaceState).toHaveBeenCalledWith(null, '', `${location.origin}/callback?app=one`)
    expect(popup.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['closed', 'timeout', 'cancelled', 'authorize'] as const)('rejects %s and releases every timer', async kind => {
    const helper = new AuthProviderWindow('/callback', 100)
    const result = helper.start(async () => {
      if (kind === 'authorize') throw new Error('Authorization unavailable')
      return 'https://provider.test/'
    })
    const rejection = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1)
    if (kind === 'closed') popup.closed = true
    if (kind === 'cancelled') helper.close()
    await vi.advanceTimersByTimeAsync(101)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
    expect(popup.close).toHaveBeenCalledOnce()
  })
  it('does not start transport when blocked and uses the authentication error domain', async () => {
    vi.mocked(window.open).mockReturnValue(null)
    const authorize = vi.fn()
    await expect(new AuthProviderWindow('/callback').start(authorize)).rejects.toMatchObject({ code: 'AUTH_PROVIDER_POPUP_BLOCKED' })
    expect(authorize).not.toHaveBeenCalled()
  })
  it('ignores an old authorization completion after a replacement window starts', async () => {
    let release!: (url: string) => void
    const helper = new AuthProviderWindow('/callback', 100)
    const old = helper.start(() => new Promise(resolve => { release = resolve }))
    const rejected = expect(old).rejects.toMatchObject({ code: 'AUTH_PROVIDER_CANCELLED' })
    await vi.advanceTimersByTimeAsync(1)
    const nextPopup = { ...popup, location: { href: 'about:blank' }, close: vi.fn() }
    vi.mocked(window.open).mockReturnValue(nextPopup as unknown as Window)
    const next = helper.start(async () => 'https://provider.test/new')
    const nextRejected = expect(next).rejects.toMatchObject({ code: 'AUTH_PROVIDER_CANCELLED' })
    release('https://provider.test/old')
    await vi.advanceTimersByTimeAsync(1)
    expect(nextPopup.location.href).toBe('https://provider.test/new')
    helper.close()
    await rejected
    await nextRejected
    expect(vi.getTimerCount()).toBe(0)
  })
})
