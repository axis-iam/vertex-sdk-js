import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { IamProvider } from './IamProvider'
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
      version: 3,
      roles: ['current-role'],
      permissions: ['orders:read'],
    })
  })
})
