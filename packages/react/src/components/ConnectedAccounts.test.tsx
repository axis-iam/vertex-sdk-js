import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_LINK_STATE_KEY } from '../core/account-linking'
import type { AccountLoginMethod, LinkableIdentityProvider, OIDCConfiguration } from '../core/types'
import { IamProvider } from '../provider/IamProvider'
import { makeTestJwt, storeTestTokens, testProviderProps } from '../test-utils'
import { ConnectedAccounts } from './ConnectedAccounts'

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

const githubProvider: LinkableIdentityProvider = {
  id: 'idp-github',
  providerType: 'GITHUB',
  protocol: 'OAUTH2',
  displayName: 'GitHub',
  enabled: true,
  linked: false,
  linkedAt: null,
  supportsAccountLinking: true,
}

const samlProvider: LinkableIdentityProvider = {
  ...githubProvider,
  id: 'idp-saml',
  providerType: 'SAML',
  protocol: 'SAML',
  displayName: 'SAML',
}

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

function setupFetch(options: {
  methods?: AccountLoginMethod[]
  providers?: LinkableIdentityProvider[]
  stepUpOn?: 'start' | 'unlink'
} = {}) {
  const methods = options.methods ?? [passwordMethod, googleMethod]
  const providers = options.providers ?? [githubProvider, samlProvider]
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/.well-known/openid-configuration')) {
      return { ok: true, json: async () => mockOidcConfig }
    }
    if (url.includes('/api/v1/auth/me/permissions')) {
      return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: ['orders:read'] }) }
    }
    if (url.endsWith('/api/v1/auth/me/login-methods') && init?.method !== 'DELETE') {
      return { ok: true, json: async () => methods }
    }
    if (url.includes('/api/v1/auth/me/linkable-identity-providers')) {
      return { ok: true, json: async () => providers }
    }
    if (url.includes('/api/v1/auth/me/identity-providers/idp-github/link/authorize')) {
      if (options.stepUpOn === 'start') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            status: 403,
            error: 'STEP_UP_REQUIRED',
            message: 'Step-up authentication required',
            details: { trigger: 'MFA_CHANGE', methods: ['TOTP'] },
          }),
        }
      }
      const body = JSON.parse(init?.body as string) as { state: string }
      return {
        ok: true,
        json: async () => ({
          authorizationUrl: 'https://github.example.test/login/oauth/authorize',
          state: body.state,
          expiresAt: '2026-06-27T10:25:30Z',
        }),
      }
    }
    if (url.includes('/api/v1/auth/me/login-methods/idp%3Aidp-google')) {
      if (options.stepUpOn === 'unlink') {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            status: 403,
            error: 'STEP_UP_REQUIRED',
            message: 'Step-up authentication required',
            details: { trigger: 'MFA_CHANGE', methods: ['TOTP'] },
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }
    return { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('ConnectedAccounts', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useRealTimers()
    storeTestTokens(makeTestJwt(), ['orders:read'])
    setupFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders current methods and actionable linkable providers', async () => {
    renderWithProvider(createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }))
    await waitFor(() => expect(screen.getByText('Password')).toBeTruthy())

    expect(screen.getByText('Google')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect(screen.queryByLabelText('Connect SAML')).toBeNull()
    expect((screen.getByLabelText('Disconnect Password') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('This is required to keep account access available.')).toBeTruthy()
  })

  it('uses the Chinese credential catalog instead of SDK-generated English enum labels', async () => {
    render(createElement(
      IamProvider,
      { ...testProviderProps(), locale: 'zh-CN' },
      createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }),
    ))

    await waitFor(() => expect(screen.getByText('密码')).toBeTruthy())
    expect(screen.queryByText('Password')).toBeNull()
  })

  it('uses Chinese provider, protocol, and step-up method labels without exposing enum codes', async () => {
    setupFetch({ stepUpOn: 'unlink' })
    render(createElement(
      IamProvider,
      { ...testProviderProps(), locale: 'zh-CN' },
      createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }),
    ))

    await waitFor(() => expect(screen.getByText('GitHub（OAuth 2.0）')).toBeTruthy())
    expect(screen.queryByText('Github (OAUTH2)')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByLabelText('解除 Google 的关联'))
    })

    expect(screen.getByRole('alert').textContent).toBe('请再次验证后继续。可用方式：身份验证器应用。')
    expect(screen.getByRole('alert').textContent).not.toContain('TOTP')
  })

  it('starts link only after response state match and stores account-link pending state', async () => {
    const onLinkStarted = vi.fn()
    renderWithProvider(createElement(ConnectedAccounts, {
      confirmDisconnect: false,
      redirect: false,
      redirectUri: 'https://app.example.test/account-link/callback',
      onLinkStarted,
    }))
    await waitFor(() => expect(screen.getByLabelText('Connect GitHub')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Connect GitHub'))
    })

    expect(onLinkStarted).toHaveBeenCalledWith(githubProvider, 'https://github.example.test/login/oauth/authorize')
    const pending = sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)
    expect(pending).toContain('idp-github')
    expect(pending).not.toContain('link_ticket')
    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
  })

  it('unlinks using URL-encoded methodId', async () => {
    const fetchMock = setupFetch()
    renderWithProvider(createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }))
    await waitFor(() => expect(screen.getByLabelText('Disconnect Google')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Disconnect Google'))
    })

    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/me/login-methods/idp%3Aidp-google'))).toBe(true)
  })

  it('shows safe step-up copy without raw backend JSON', async () => {
    setupFetch({ stepUpOn: 'unlink' })
    renderWithProvider(createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }))
    await waitFor(() => expect(screen.getByLabelText('Disconnect Google')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Disconnect Google'))
    })

    expect(screen.getByRole('alert').textContent).toBe('Verify again to continue. Available methods: Authenticator app.')
    expect(screen.getByRole('alert').textContent).not.toContain('STEP_UP_REQUIRED')
    expect(screen.getByRole('alert').textContent).not.toContain('MFA_CHANGE')
  })

  it('shows empty states without exposing endpoint details', async () => {
    setupFetch({ methods: [], providers: [] })
    renderWithProvider(createElement(ConnectedAccounts, { confirmDisconnect: false, redirect: false }))

    await waitFor(() => expect(screen.getByText('No sign-in methods are available.')).toBeTruthy())
    expect(screen.getByText('No providers are available to connect.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('/api/v1/auth/me')
  })
})
