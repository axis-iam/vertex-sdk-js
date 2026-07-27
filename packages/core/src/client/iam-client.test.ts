import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { IamClient } from '../server.js'

const compatibilityFixture = JSON.parse(readFileSync(new URL('../../../../testdata/permission-compatibility-vectors.json', import.meta.url), 'utf8')) as {
  snapshot: { valid: unknown, rawReject: Array<{ name: string, body: string }>, reject: Array<{ name: string, body: unknown }> }
  resolve: { valid: unknown, reject: Array<{ name: string, body: unknown }> }
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) }
}

function rawResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body }
}

describe('IamClient', () => {
  const config = { endpoint: 'https://auth.example.com', clientId: 'app-1', clientSecret: 'secret-1' }
  let client: IamClient

  beforeEach(() => {
    client = new IamClient(config)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requires confidential ApplicationClient credentials', () => {
    expect(() => new IamClient({ endpoint: 'https://auth.example.com', clientId: 'app-1', clientSecret: '' }))
      .toThrow(/confidential ApplicationClient/)
  })

  it('resolvePermissions sends POST with correct body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ permissions: ['posts:read'] }))
    globalThis.fetch = fetchMock

    const result = await client.resolvePermissions('app-1', ['admin'])

    expect(result).toEqual({ permissions: ['posts:read'] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.example.com/open/v1/permissions:resolve')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ clientId: 'app-1', roles: ['admin'] })
    expect(init.headers['X-IAM-Client-Id']).toBe('app-1')
    expect(init.headers.Authorization).toBe('Basic YXBwLTE6c2VjcmV0LTE=')
  })

  it('returns zero-role resolve locally without a request', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    await expect(client.resolvePermissions('app-1', [])).resolves.toEqual({ permissions: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {},
    { permissions: ['posts:read'], fallback: true },
    { permissions: ['posts'] },
    { permissions: ['posts:read', 'posts:read'] },
  ])('rejects malformed resolve response %#', async (body) => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(body))
    await expect(client.resolvePermissions('app-1', ['admin'])).rejects.toThrow(/invalid permission resolve/)
  })

  it('listPermissions sends canonical app-scoped GET', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
        applicationId: '123e4567-e89b-42d3-a456-426614174000',
        clientId: 'app-1',
        roles: [{ key: 'admin', name: 'Admin', permissions: ['posts:read', 'posts:*', '*:*'] }],
      }))
    globalThis.fetch = fetchMock

    const result = await client.listPermissions('app-1')

    expect(result.roles[0]?.permissions).toEqual(['posts:read', 'posts:*', '*:*'])
    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.example.com/open/v1/apps/app-1/permissions')
  })

  it.each([
    { applicationId: 'app', clientId: 'app-1', permissions: [] },
    { applicationId: 'app', clientId: 'app-1', roles: [], fallback: true },
    { applicationId: 'app', clientId: 'app-1', roles: [{ key: 'admin', name: 'Admin', permissions: ['posts'] }] },
    { applicationId: 'app', clientId: 'app-1', roles: [{ key: 'admin', name: 'Admin', permissions: ['posts:read', 'posts:read'] }] },
  ])('rejects malformed permission snapshot %#', async (body) => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(body))
    await expect(client.listPermissions('app-1')).rejects.toThrow(/invalid permission/)
  })

  it('exhausts every shared permission compatibility reject vector', async () => {
    for (const vector of compatibilityFixture.snapshot.reject) {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(vector.body))
      await expect(client.listPermissions('orders-service'), vector.name).rejects.toThrow(/invalid permission/)
    }
    for (const vector of compatibilityFixture.resolve.reject) {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(vector.body))
      await expect(client.resolvePermissions('orders-service', ['admin']), vector.name).rejects.toThrow(/invalid permission resolve/)
    }
  })

  it('exhausts every shared raw JSON reject vector without preprocessing', async () => {
    for (const vector of compatibilityFixture.snapshot.rawReject) {
      const fetchMock = vi.fn().mockResolvedValue(rawResponse(vector.body))
      globalThis.fetch = fetchMock
      await expect(client.listPermissions('orders-service'), vector.name).rejects.toThrow()
      expect(fetchMock, vector.name).toHaveBeenCalledTimes(1)
    }
  })

  it('accepts the shared canonical snapshot with wildcard grants', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(compatibilityFixture.snapshot.valid))

    const result = await client.listPermissions('orders-service')

    expect(result.roles[0]?.permissions).toEqual(['orders:read', 'orders:*', '*:*'])
  })

  it('accepts the shared resolve response with wildcard grants', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(compatibilityFixture.resolve.valid))
    await expect(client.resolvePermissions('orders-service', ['admin'])).resolves.toEqual({
      permissions: ['orders:read', 'orders:*', '*:*'],
    })
  })

  it('retries on failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(jsonResponse({ permissions: ['posts:read'] }))
    globalThis.fetch = fetchMock

    const result = await client.resolvePermissions('app-1', ['admin'])
    expect(result.permissions).toEqual(['posts:read'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([401, 403, 404])('does not retry terminal HTTP %s', async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(rawResponse('{}', status))
    globalThis.fetch = fetchMock
    await expect(client.resolvePermissions('app-1', ['admin'])).rejects.toThrow(`HTTP ${status}`)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['malformed JSON', '{'],
    ['contract response', '{"permissions":["orders"]}'],
  ])('does not retry %s', async (_name, body) => {
    const fetchMock = vi.fn().mockResolvedValue(rawResponse(body))
    globalThis.fetch = fetchMock
    await expect(client.resolvePermissions('app-1', ['admin'])).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['429', () => Promise.resolve(rawResponse('{}', 429))],
    ['500', () => Promise.resolve(rawResponse('{}', 500))],
    ['transport', () => Promise.reject(new TypeError('network unavailable'))],
  ])('retries retryable %s only within the four-request budget', async (_name, failure) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation(failure)
    globalThis.fetch = fetchMock
    const result = client.resolvePermissions('app-1', ['admin'])
    const assertion = expect(result).rejects.toThrow()
    await vi.runAllTimersAsync()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
    vi.useRealTimers()
  })

  it('does not retry an aborted request', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'))
    globalThis.fetch = fetchMock
    await expect(client.resolvePermissions('app-1', ['admin'])).rejects.toThrow(/aborted/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([200, 401])('keeps the deadline active while reading a never-ending HTTP %s body', async (status) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => Promise.resolve({
      ok: status === 200,
      status,
      text: () => new Promise<string>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('body timed out', 'AbortError')))
      }),
    }))
    globalThis.fetch = fetchMock
    const result = client.resolvePermissions('app-1', ['admin'])
    const assertion = expect(result).rejects.toThrow(/body timed out/)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('requestPasswordReset sends email client_id and redirect_uri', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    })
    globalThis.fetch = fetchMock

    await client.requestPasswordReset({
      email: 'user@example.com',
      redirectUri: 'https://app.example.com/reset-password',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.example.com/api/v1/auth/password/forgot')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      email: 'user@example.com',
      client_id: 'app-1',
      redirect_uri: 'https://app.example.com/reset-password',
    })
  })

  it('resetPassword sends token and newPassword', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    })
    globalThis.fetch = fetchMock

    await client.resetPassword({
      token: 'reset-token',
      newPassword: 'NewPassword123!',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://auth.example.com/api/v1/auth/password/reset')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body)).toEqual({
      token: 'reset-token',
      newPassword: 'NewPassword123!',
    })
  })
})
