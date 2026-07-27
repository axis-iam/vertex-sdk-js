import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_LINK_STATE_KEY, storePendingAccountLink } from '../core/account-linking'
import type { AccountLoginMethod, LinkableIdentityProvider, OIDCConfiguration } from '../core/types'
import { IamProvider } from '../provider/IamProvider'
import { makeTestJwt, storeTestTokens, testProviderProps } from '../test-utils'
import { useAccountLinkCallback } from './useAccountLinkCallback'
import { useAccountLinking } from './useAccountLinking'
import { useAccountLoginMethods } from './useAccountLoginMethods'
import { useLinkableIdentityProviders } from './useLinkableIdentityProviders'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

const passwordMethod: AccountLoginMethod = {
  methodId: 'credential:PASSWORD',
  kind: 'CREDENTIAL',
  credentialType: 'PASSWORD',
  identityProviderId: null,
  providerKey: null,
  providerType: null,
  protocol: null,
  displayName: 'Password',
  linkedAt: '2026-06-27T10:15:30Z',
  providerUserId: null,
  unlinkable: false,
}

const googleMethod: AccountLoginMethod = {
  methodId: 'idp:idp-google',
  kind: 'IDENTITY_PROVIDER',
  credentialType: null,
  identityProviderId: 'idp-google',
  providerKey: 'GOOGLE:idp-google',
  providerType: 'GOOGLE',
  protocol: 'OIDC',
  displayName: 'Google',
  linkedAt: '2026-06-27T10:20:30Z',
  providerUserId: 'masked',
  unlinkable: true,
}

const googleProvider: LinkableIdentityProvider = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  protocol: 'OIDC',
  displayName: 'Google',
  enabled: true,
  linked: false,
  linkedAt: null,
  supportsAccountLinking: true,
}

const samlProvider: LinkableIdentityProvider = {
  ...googleProvider,
  id: 'idp-saml',
  providerType: 'SAML',
  protocol: 'SAML',
  displayName: 'SAML',
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

function setupFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/.well-known/openid-configuration')) {
      return { ok: true, json: async () => mockOidcConfig }
    }
    if (url.includes('/api/v1/auth/me/permissions')) {
      return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: ['orders:read'] }) }
    }
    if (url.endsWith('/api/v1/auth/me/login-methods') && init?.method !== 'DELETE') {
      return { ok: true, json: async () => [passwordMethod, googleMethod] }
    }
    if (url.includes('/api/v1/auth/me/linkable-identity-providers')) {
      return { ok: true, json: async () => [googleProvider, samlProvider] }
    }
    if (url.includes('/api/v1/auth/me/identity-providers/idp-google/link/authorize')) {
      const body = JSON.parse(init?.body as string) as { state: string }
      return {
        ok: true,
        json: async () => ({
          authorizationUrl: 'https://accounts.example.test/oauth2/auth',
          state: body.state,
          expiresAt: '2026-06-27T10:25:30Z',
        }),
      }
    }
    if (url.includes('/api/v1/auth/me/identity-providers/link-ticket/exchange')) {
      return { ok: true, json: async () => ({ method: googleMethod }) }
    }
    if (url.includes('/api/v1/auth/me/login-methods/idp%3Aidp-google')) {
      return { ok: true, json: async () => ({}) }
    }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('account-linking hooks', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useRealTimers()
    setupFetch()
    window.history.replaceState({}, document.title, '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads account login methods for an authenticated user', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const { result } = renderHook(() => useAccountLoginMethods(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.methods).toEqual([passwordMethod, googleMethod])
  })

  it('loads linkable providers and filters actionable providers', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const { result } = renderHook(() => useLinkableIdentityProviders(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.providers).toEqual([googleProvider, samlProvider])
    expect(result.current.actionableProviders).toEqual([googleProvider])
  })

  it('returns typed unauthenticated errors without making account API calls', async () => {
    const fetchMock = setupFetch()
    const { result } = renderHook(() => useAccountLoginMethods(), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/me/login-methods'))).toBe(false)
  })

  it('starts account linking, stores separate pending state, and redirects after state match', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const navigate = vi.fn()
    const { result } = renderHook(() => useAccountLinking(), { wrapper })

    await act(async () => {
      await result.current.startLink(googleProvider, {
        redirectUri: 'https://app.example.test/account-link/callback',
        navigate,
      })
    })

    expect(navigate).toHaveBeenCalledWith('https://accounts.example.test/oauth2/auth')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toContain('idp-google')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).not.toContain('link_ticket')
    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
  })

  it('fails closed when start response state does not match', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const fetchMock = setupFetch()
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/.well-known/openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
      if (url.includes('/api/v1/auth/me/permissions')) return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: ['orders:read'] }) }
      if (url.includes('/link/authorize')) {
        return {
          ok: true,
          json: async () => ({
            authorizationUrl: 'https://accounts.example.test/oauth2/auth',
            state: 'wrong-state',
            expiresAt: '2026-06-27T10:25:30Z',
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    })
    const navigate = vi.fn()
    const { result } = renderHook(() => useAccountLinking(), { wrapper })

    await expect(result.current.startLink(googleProvider, { navigate })).rejects.toMatchObject({
      code: 'ACCOUNT_LINK_STATE_MISMATCH',
    })
    expect(navigate).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
  })

  it('unlinks with stable encoded method id', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    const fetchMock = setupFetch()
    const onAfterChange = vi.fn()
    const { result } = renderHook(() => useAccountLinking({ onAfterChange }), { wrapper })

    await act(async () => {
      await result.current.unlink('idp:idp-google')
    })

    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/me/login-methods/idp%3Aidp-google'))).toBe(true)
    expect(onAfterChange).toHaveBeenCalledTimes(1)
  })

  it('handles successful callback by scrubbing URL, exchanging ticket, and clearing pending state', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    storePendingAccountLink('client-state')
    window.history.replaceState({}, document.title, '/account-link/callback?link_ticket=fake-ticket&state=client-state')
    const fetchMock = setupFetch()
    const onSuccess = vi.fn()

    const { result } = renderHook(() => useAccountLinkCallback({ onSuccess }), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.result?.method).toEqual(googleMethod)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
    const exchangeCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/link-ticket/exchange'))
    expect(exchangeCall).toBeTruthy()
    expect(JSON.parse(exchangeCall?.[1]?.body as string)).toEqual({
      linkTicket: 'fake-ticket',
      state: 'client-state',
    })
  })

  it('does not reprocess a successful callback when inline callbacks change identity', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    storePendingAccountLink('client-state')
    window.history.replaceState({}, document.title, '/account-link/callback?link_ticket=fake-ticket&state=client-state')
    const fetchMock = setupFetch()

    const { result, rerender } = renderHook(
      ({ successId }: { successId: number }) => useAccountLinkCallback({
        onSuccess: () => successId,
      }),
      { wrapper, initialProps: { successId: 1 } },
    )

    await waitFor(() => expect(result.current.status).toBe('success'))
    rerender({ successId: 2 })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('/link-ticket/exchange'))).toHaveLength(1)
    expect(result.current.result?.method).toEqual(googleMethod)
    expect(result.current.error).toBeNull()
  })

  it('rejects callback state mismatch without exchange and without exposing ticket in state', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    storePendingAccountLink('client-state')
    window.history.replaceState({}, document.title, '/account-link/callback?link_ticket=fake-ticket&state=wrong-state')
    const fetchMock = setupFetch()

    const { result } = renderHook(() => useAccountLinkCallback(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'ACCOUNT_LINK_STATE_MISMATCH' })
    expect(result.current.result).toBeNull()
    expect(String(result.current.error?.message)).not.toContain('fake-ticket')
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/link-ticket/exchange'))).toBe(false)
  })

  it('scrubs provider failure callbacks and returns safe error state', async () => {
    storeTestTokens(makeTestJwt(), ['orders:read'])
    storePendingAccountLink('client-state')
    window.history.replaceState({}, document.title, '/account-link/callback?account_link=failed&error=account_link_failed&state=client-state')
    const fetchMock = setupFetch()

    const { result } = renderHook(() => useAccountLinkCallback(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({ code: 'ACCOUNT_LINK_FAILED' })
    expect(String(result.current.error?.message)).toBe('Account linking was not completed')
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/link-ticket/exchange'))).toBe(false)
  })

  it('fails unauthenticated callback closed after scrubbing URL', async () => {
    storePendingAccountLink('client-state')
    window.history.replaceState({}, document.title, '/account-link/callback?link_ticket=fake-ticket&state=client-state')
    const fetchMock = setupFetch()

    const { result } = renderHook(() => useAccountLinkCallback(), { wrapper })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(window.location.search).toBe('')
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/link-ticket/exchange'))).toBe(false)
  })
})
