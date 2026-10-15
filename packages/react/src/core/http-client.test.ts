import { afterEach, expect, it, vi } from 'vitest'
import { requestJson } from './http-client'
import { IamNetworkError } from './types'
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
it('keeps the request timeout active while a successful response body is pending', async () => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit) => ({
    ok: true,
    status: 200,
    text: () => new Promise<string>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }),
  })))
  const pending = requestJson('https://auth.test.com/token', { timeoutMs: 100 })
  const rejected = expect(pending).rejects.toBeInstanceOf(IamNetworkError)
  await vi.advanceTimersByTimeAsync(100)
  await rejected
})
