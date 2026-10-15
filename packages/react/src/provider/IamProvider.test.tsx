import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, StrictMode, type ReactNode } from 'react'
import { IamProvider, useIamContext } from './IamProvider'
import { useAuth } from '../hooks/useAuth'
import { makeTestJwt, setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function defaultMemoryProps() {
  const { tokenStorage: _tokenStorage, ...props } = testProviderProps()
  return props
}

function wrapper(props = {}) {
  return ({ children }: { children: ReactNode }) => createElement(
    IamProvider,
    { ...testProviderProps(), ...props },
    children,
  )
}

describe('IamProvider token storage policy', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not restore sessionStorage tokens by default', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const existingSession = sessionStorage.getItem('axis_iam_session')
    expect(existingSession).not.toBeNull()

    const { result } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => createElement(IamProvider, defaultMemoryProps(), children),
    })

    await waitFor(() => expect(result.current.isLoaded).toBe(true))

    expect(result.current.isAuthenticated).toBe(false)
    expect(result.current.getAccessToken()).toBeNull()
    expect(sessionStorage.getItem('axis_iam_session')).toBe(existingSession)
    expect(sessionStorage.getItem('iam_tokens')).toBeNull()
    expect(sessionStorage.getItem('iam_permissions')).toBeNull()
  })

  it('restores sessionStorage tokens only when explicitly enabled', async () => {
    const jwt = makeTestJwt()
    storeTestTokens(jwt, ['orders:read'])

    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper({ tokenStorage: 'sessionStorage' }),
    })

    await waitFor(() => expect(result.current.isLoaded).toBe(true))

    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.getAccessToken()).toBe(jwt)
    expect(result.current.user?.permissions).toEqual(['orders:read', 'orders:create', 'users:*'])
  })

  it('replaces persisted roles and permissions with the canonical summary on reload', async () => {
    const jwt = makeTestJwt({ roles: ['jwt-stale-role'] })
    storeTestTokens(jwt, ['persisted:stale'], ['persisted-stale-role'])
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/api/v1/auth/me/permissions')) {
        return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['current-role'], permissions: ['orders:read'] }) }
      }
      return { ok: true, json: async () => ({
        issuer: 'https://auth.test.com',
        authorization_endpoint: 'https://auth.test.com/authorize',
        token_endpoint: 'https://auth.test.com/token',
        userinfo_endpoint: 'https://auth.test.com/userinfo',
        jwks_uri: 'https://auth.test.com/oauth2/jwks',
      }) }
    }) as unknown as typeof fetch

    const { result } = renderHook(() => useAuth(), { wrapper: wrapper({ tokenStorage: 'sessionStorage' }) })

    await waitFor(() => expect(result.current.isLoaded).toBe(true))
    expect(result.current.user).toMatchObject({ roles: ['current-role'], permissions: ['orders:read'] })
    expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
      version: 4, expiresAt: expect.any(Number),
      roles: ['current-role'],
      permissions: ['orders:read'],
    })
  })

  it('keeps initialization usable across StrictMode effect replay and unmount cleanup', async () => {
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => createElement(
        StrictMode,
        null,
        createElement(IamProvider, defaultMemoryProps(), children),
      ),
    })

    await waitFor(() => expect(result.current.isLoaded).toBe(true))
    expect(result.current.initializationError).toBeNull()
    unmount()
  })
})

describe('Provider pending refresh ownership', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear() })
  it('StrictMode preserves persisted sessions without orphan refresh timers', async () => {
    vi.useFakeTimers()
    setupMockFetch()
    storeTestTokens()
    const { result, unmount } = renderHook(() => useAuth(), {
      wrapper: ({ children }) => createElement(StrictMode, null, createElement(IamProvider, testProviderProps(), children)),
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.isAuthenticated).toBe(true)
    expect(result.current.initializationError).toBeNull()
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(sessionStorage.getItem('axis_iam_session')).not.toBeNull()
  })

  it('unmount invalidates a sent refresh and prevents replay or persisted resurrection', async () => {
    vi.useFakeTimers()
    setupMockFetch()
    storeTestTokens()
    const { result, unmount } = renderHook(() => useIamContext(), { wrapper: wrapper() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    let complete!: (value: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => { complete = resolve }))
    globalThis.fetch = fetchMock
    const client = result.current.client
    const pending = client.refreshToken()
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
    await act(async () => { await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledOnce()
    unmount()
    complete(new Response(JSON.stringify({ access_token: makeTestJwt(), refresh_token: 'rotated', token_type: 'Bearer', expires_in: 3600 })))
    await rejected
    expect(client.getAccessToken()).toBeNull()
    expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(vi.getTimerCount()).toBe(0)
  })
})
