import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { SignIn } from './SignIn'
import { storeTestTokens, makeTestJwt, testProviderProps } from '../test-utils'
import type { AuthMethodIdpProviderResponse, IdentityProviderOption, PublicAuthMethodsResponse } from '../core/types'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

const googleProvider: IdentityProviderOption = {
  id: 'idp-google',
  applicationId: 'app-1',
  providerType: 'GOOGLE',
  name: 'google',
  displayName: 'Google',
  enabled: true,
  protocol: 'OIDC',
  authorizationUrl: `${ISSUER}/api/v1/apps/test-app/identity-providers/idp-google/oidc/authorize`,
  samlAcsUrl: null,
  supportsBrokeredToken: true,
}

const githubProvider: IdentityProviderOption = {
  ...googleProvider,
  id: 'idp-github',
  providerType: 'GITHUB',
  name: 'github',
  displayName: 'GitHub',
  protocol: 'OAUTH2',
  authorizationUrl: `${ISSUER}/api/v1/apps/test-app/identity-providers/idp-github/oauth2/authorize`,
}

const samlProvider: IdentityProviderOption = {
  ...googleProvider,
  id: 'idp-saml',
  providerType: 'SAML',
  name: 'saml',
  displayName: 'SAML',
  protocol: 'SAML',
  authorizationUrl: null,
}

const googleAuthProvider: AuthMethodIdpProviderResponse = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  displayName: 'Google',
  enabled: true,
  configured: true,
  clickable: true,
  availableForLogin: true,
  availableForSignup: true,
  unavailableReason: null,
  authorizationUrl: `${ISSUER}/api/v1/apps/test-app/identity-providers/idp-google/oidc/authorize`,
}

const githubAuthProvider: AuthMethodIdpProviderResponse = {
  ...googleAuthProvider,
  id: 'idp-github',
  providerType: 'GITHUB',
  displayName: 'GitHub',
  authorizationUrl: `${ISSUER}/api/v1/apps/test-app/identity-providers/idp-github/oauth2/authorize`,
}

const unavailableSamlAuthProvider: AuthMethodIdpProviderResponse = {
  ...googleAuthProvider,
  id: 'idp-saml',
  providerType: 'SAML',
  displayName: 'SAML',
  availableForLogin: false,
  availableForSignup: false,
  authorizationUrl: null,
}

const defaultAuthMethods: PublicAuthMethodsResponse = {
  clientId: 'test-app',
  passwordLoginEnabled: true,
  emailMagicLinkEnabled: false,
  emailOtpEnabled: false,
  smsOtpEnabled: false,
  socialLoginEnabled: true,
  signupEnabled: true,
  selfRegistrationEnabled: true,
  emailVerificationMode: 'OFF',
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: null,
  postVerificationRedirectUri: null,
  methods: [
    {
      type: 'PASSWORD',
      enabled: true,
      configured: true,
      availableForLogin: true,
      availableForSignup: true,
      unavailableReason: null,
    },
  ],
  idpProviders: [],
  resend: {
    emailVerificationCooldownSeconds: 60,
  },
}

function renderWithProvider(ui: React.ReactElement, props = {}) {
  return render(createElement(IamProvider, { ...testProviderProps(), ...props }, ui))
}

type MockResponse = {
  ok: boolean
  status?: number
  json?: () => Promise<unknown>
  text?: () => Promise<string>
}

/** URL-aware fetch mock for embedded login tests */
function setupFetchMock(overrides: {
  loginResponse?: MockResponse
  authMethods?: PublicAuthMethodsResponse | MockResponse
  identityProviders?: IdentityProviderOption[] | MockResponse
  providerAuthorizeResponse?: MockResponse
  branding?: { logoUrl?: string; primaryColor?: string; backgroundColor?: string }
} = {}) {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('openid-configuration')) {
      return { ok: true, json: async () => mockOidcConfig }
    }
    if (url.includes('/branding')) {
      if (overrides.branding) return { ok: true, json: async () => overrides.branding }
      return { ok: false, status: 404 }
    }
    if (url.includes('/api/v1/apps/test-app/auth-methods')) {
      const authMethods = overrides.authMethods ?? defaultAuthMethods
      return 'ok' in authMethods ? authMethods : { ok: true, json: async () => authMethods }
    }
    if (url.includes('/api/v1/apps/test-app/identity-providers')) {
      if (init?.method === 'POST') {
        return overrides.providerAuthorizeResponse ?? {
          ok: true,
          json: async () => ({ authorizationUrl: 'https://provider.example.test/authorize' }),
        }
      }
      const providers = overrides.identityProviders ?? []
      return Array.isArray(providers) ? { ok: true, json: async () => providers } : providers
    }
    if (url.includes('/api/v1/auth/login')) {
      return overrides.loginResponse ?? { ok: false, status: 500, json: async () => ({ message: 'No login mock' }) }
    }
    if (url.includes('/api/v1/auth/email/verification/send')) {
      return { ok: true, json: async () => ({ message: 'Verification email sent' }) }
    }
    if (url.includes('/api/v1/auth/me/permissions')) {
      return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: ['admin'], permissions: ['orders:read', 'orders:create', 'users:*'] }) }
    }
    return { ok: false, status: 404 }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

function authMethodsWith(options: {
  password?: boolean
  sms?: boolean
  magicLink?: boolean
  emailOtp?: boolean
  socialLoginEnabled?: boolean
  providers?: AuthMethodIdpProviderResponse[]
  resendCooldownSeconds?: number
}): PublicAuthMethodsResponse {
  const methods = [
    methodAvailability('PASSWORD', options.password ?? false),
    methodAvailability('SMS_OTP', options.sms ?? false),
    methodAvailability('EMAIL_MAGIC_LINK', options.magicLink ?? false),
    methodAvailability('EMAIL_OTP', options.emailOtp ?? false),
  ]
  return {
    ...defaultAuthMethods,
    passwordLoginEnabled: options.password ?? false,
    smsOtpEnabled: options.sms ?? false,
    emailMagicLinkEnabled: options.magicLink ?? false,
    emailOtpEnabled: options.emailOtp ?? false,
    socialLoginEnabled: options.socialLoginEnabled ?? true,
    methods,
    idpProviders: options.providers ?? [],
    resend: {
      emailVerificationCooldownSeconds: options.resendCooldownSeconds ?? 60,
    },
  }
}

function methodAvailability(type: PublicAuthMethodsResponse['methods'][number]['type'], available: boolean): PublicAuthMethodsResponse['methods'][number] {
  return {
    type,
    enabled: available,
    configured: available,
    availableForLogin: available,
    availableForSignup: available,
    unavailableReason: available ? null : 'DISABLED',
  }
}

async function continueWithIdentifier(value: string) {
  const input = screen.getByPlaceholderText('you@example.com or +86 13800138000')
  fireEvent.change(input, { target: { value } })
  await act(async () => {
    fireEvent.submit(input.closest('form')!)
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe('SignIn', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('redirect mode (default)', () => {
    it('renders sign in button when not authenticated', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    })

    it('renders forgot password URL when configured', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { forgotPasswordUrl: '/forgot-password' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText('Forgot password?').getAttribute('href')).toBe('/forgot-password')
    })

    it('shows signed-in state when authenticated', async () => {
      storeTestTokens()
      setupFetchMock()
      renderWithProvider(createElement(SignIn))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText('Signed in as test@example.com')).toBeTruthy()
    })
  })

  describe('embedded mode', () => {
    it('renders identifier-first form and then password challenge for an email', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy()
      expect(screen.queryByPlaceholderText('Enter your password')).toBeNull()

      await continueWithIdentifier('user@test.com')

      expect(screen.getByText(/Signing in as/)).toBeTruthy()
      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy()
    })

    it('shows error on login failure', async () => {
      const onError = vi.fn()
      setupFetchMock({
        loginResponse: {
          ok: false,
          status: 401,
          json: async () => ({ message: 'Invalid credentials' }),
        },
      })

      renderWithProvider(createElement(SignIn, { mode: 'embedded', onError }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'wrong-pass' } })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Please sign in and try again.')).toBeTruthy()
      expect(onError).toHaveBeenCalled()
    })

    it('sends client_id, keeps tokens memory-only by default, and calls onSuccess after snake_case token login response', async () => {
      const onSuccess = vi.fn()
      const jwt = makeTestJwt()
      const fetchMock = setupFetchMock({
        loginResponse: {
          ok: true,
          json: async () => ({
            access_token: jwt,
            refresh_token: 'rt',
            id_token: 'id-token',
            token_type: 'Bearer',
            expires_in: 3600,
            permissions: ['orders:read', 'orders:create', 'users:*'],
          }),
        },
      })

      renderWithProvider(createElement(SignIn, { mode: 'embedded', onSuccess }), { tokenStorage: 'memory' })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'correct-pass' } })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSuccess.mock.calls[0][0].id).toBe('user-1')

      const loginRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/login')
      })
      expect(loginRequest?.[1]?.method).toBe('POST')
      const body = JSON.parse(loginRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toMatchObject({
        identifier: 'user@test.com',
        password: 'correct-pass',
        client_id: 'test-app',
      })
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('does not store an MFA challenge as tokens', async () => {
      const onError = vi.fn()
      const onSuccess = vi.fn()
      setupFetchMock({
        loginResponse: {
          ok: true,
          json: async () => ({
            mfa_required: true,
            mfa_token: 'mfa_test',
            methods: ['totp'],
            message: 'MFA verification required',
          }),
        },
      })

      renderWithProvider(createElement(SignIn, { mode: 'embedded', onError, onSuccess }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'correct-pass' } })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Sign-in failed. Please try again.')).toBeTruthy()
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onSuccess).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
    })

    it('handles EMAIL_VERIFICATION_REQUIRED and resends when identifier is email', async () => {
      const onError = vi.fn()
      const fetchMock = setupFetchMock({
        loginResponse: {
          ok: false,
          status: 403,
          json: async () => ({
            error: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Email verification is required before sign in.',
          }),
        },
      })

      renderWithProvider(createElement(SignIn, { mode: 'embedded', onError }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('verify@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'correct-pass' } })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Verify your email before signing in.')).toBeTruthy()
      expect(screen.getByText('Resend verification email')).toBeTruthy()
      expect(onError).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()

      await act(async () => {
        fireEvent.click(screen.getByText('Resend verification email'))
        await vi.advanceTimersByTimeAsync(100)
      })

      const resendRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/email/verification/send')
      })
      expect(resendRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'verify@test.com', client_id: 'test-app' }),
      })
      expect(resendRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(screen.getByText('Verification email sent.')).toBeTruthy()
    })

    it('rejects identifiers that are neither email nor phone-like', async () => {
      setupFetchMock()

      renderWithProvider(createElement(SignIn, { mode: 'embedded' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('username-only')

      expect(screen.getByText('Enter a valid email address or phone number.')).toBeTruthy()
      expect(screen.queryByPlaceholderText('Enter your password')).toBeNull()
      expect(screen.queryByText('Resend verification email')).toBeNull()
    })

    it('calls onForgotPassword when configured', async () => {
      const onForgotPassword = vi.fn()
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded', onForgotPassword }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      fireEvent.click(screen.getByText('Forgot password?'))
      expect(onForgotPassword).toHaveBeenCalledTimes(1)
    })
  })

  describe('embedded mode — multi-method', () => {
    function renderEmbeddedWithConfig(
      config: { authMethods?: string[]; socialProviders?: Array<{ provider: string; displayName?: string }> },
      fetchOverrides: Parameters<typeof setupFetchMock>[0] = {},
    ) {
      setupFetchMock(fetchOverrides)
      const props = {
        ...testProviderProps(),
        authMethods: config.authMethods,
        socialProviders: config.socialProviders,
      }
      return render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
    }

    function renderEmbeddedWithAuthMethods(
      authMethods: PublicAuthMethodsResponse,
      config: { authMethods?: string[]; socialProviders?: Array<{ provider: string; displayName?: string }> } = {},
      fetchOverrides: Omit<Parameters<typeof setupFetchMock>[0], 'authMethods'> = {},
    ) {
      setupFetchMock({ ...fetchOverrides, authMethods })
      const props = {
        ...testProviderProps(),
        authMethods: config.authMethods,
        socialProviders: config.socialProviders,
      }
      return render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
    }

    it('uses Chinese catalog copy for the logo alt text and SMS phone placeholder', async () => {
      setupFetchMock({
        authMethods: authMethodsWith({ sms: true }),
        branding: { logoUrl: 'https://assets.example.test/logo.png' },
      })
      render(createElement(
        IamProvider,
        { ...testProviderProps(), locale: 'zh-CN' },
        createElement(SignIn, { mode: 'embedded' }),
      ))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByAltText('应用标志')).toBeTruthy()
      const identifier = screen.getByPlaceholderText('you@example.com 或 +86 13800138000')
      fireEvent.change(identifier, { target: { value: '+8613800138000' } })
      await act(async () => {
        fireEvent.submit(identifier.closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('手机号')).toBeTruthy()
      expect(screen.getByPlaceholderText('+86 13800138000')).toBeTruthy()
      expect(screen.getByText('发送验证码')).toBeTruthy()
    })

    it('keeps branding logo centered and bounded when host CSS makes images block-level', async () => {
      setupFetchMock({ branding: { logoUrl: 'https://assets.example.test/landscape.png' } })
      const { container } = render(createElement(IamProvider, testProviderProps(), createElement(SignIn, { mode: 'embedded' })))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.getByAltText('Application logo')).toBeTruthy()

      const hostReset = document.createElement('style')
      hostReset.textContent = 'img { display: block; max-width: 100%; }'
      document.head.appendChild(hostReset)
      const logo = container.querySelector('img') as HTMLImageElement
      expect(logo.style.display).toBe('block')
      expect(logo.style.marginInline).toBe('auto')
      expect(logo.style.maxWidth).toBe('100%')
      expect(logo.style.maxHeight).toBe('48px')
      expect(logo.style.objectFit).toBe('contain')
    })

    it('shows only email-compatible actions for an email identifier', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ password: true, sms: true, magicLink: true, emailOtp: true }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')

      const buttons = screen.getAllByRole('button').map((button) => button.textContent)
      expect(buttons).toContain('Password')
      expect(buttons).toContain('Email code')
      expect(buttons).toContain('Magic link')
      expect(buttons).not.toContain('SMS code')
    })

    it('shows only SMS action for a phone-like identifier', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ password: true, sms: true }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('+8613800138000')

      expect(screen.getByText('Phone number')).toBeTruthy()
      expect(screen.queryByText('Password')).toBeNull()
      expect(screen.getByPlaceholderText('+86 13800138000')).toBeTruthy()
      expect(screen.getByText('Send code')).toBeTruthy()
    })

    it('sends SMS code with client_id and no application context header', async () => {
      const fetchMock = setupFetchMock()
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
        if (url.includes('/branding')) return { ok: false, status: 404 }
        if (url.includes('/api/v1/apps/test-app/auth-methods')) return { ok: true, json: async () => authMethodsWith({ sms: true }) }
        if (url.includes('/api/v1/auth/sms/send')) return { ok: true, json: async () => ({ sent: true }) }
        return { ok: false, status: 404 }
      })

      const props = { ...testProviderProps(), authMethods: ['password'] as string[] }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('+8613800138000')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByPlaceholderText('Enter 6-digit code')).toBeTruthy()
      const smsRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/sms/send')
      })
      expect(smsRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: '+8613800138000', client_id: 'test-app' }),
      })
      expect(smsRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
    })

    it('verifies SMS code with client_id and stores snake_case tokens when sessionStorage is opted in', async () => {
      const onSuccess = vi.fn()
      const jwt = makeTestJwt()
      const fetchMock = setupFetchMock()
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
        if (url.includes('/branding')) return { ok: false, status: 404 }
        if (url.includes('/api/v1/apps/test-app/auth-methods')) return { ok: true, json: async () => authMethodsWith({ sms: true }) }
        if (url.includes('/api/v1/auth/sms/send')) return { ok: true, json: async () => ({ sent: true }) }
        if (url.includes('/api/v1/auth/sms/verify')) {
          return {
            ok: true,
            json: async () => ({
              access_token: jwt,
              refresh_token: 'sms-rt',
              token_type: 'Bearer',
              expires_in: 3600,
              permissions: ['orders:read'],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const props = {
        ...testProviderProps(),
        authMethods: ['password'] as string[],
        tokenStorage: 'sessionStorage' as const,
      }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded', onSuccess })))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('+8613800138000')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })
      fireEvent.change(screen.getByPlaceholderText('Enter 6-digit code'), { target: { value: '123456' } })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('+86 13800138000').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const verifyRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/sms/verify')
      })
      expect(verifyRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone: '+8613800138000', code: '123456', client_id: 'test-app' }),
      })
      expect(verifyRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
        version: 3,
        tokens: { access_token: jwt, refresh_token: 'sms-rt', token_type: 'Bearer', expires_in: 3600 },
        authenticationProvenance: 'DIRECT_AUTH',
        refreshProvenance: 'DIRECT_AUTH',
      })
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })

    it('renders magic link form', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ magicLink: true }), { authMethods: ['password'] })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')

      expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
      expect(screen.getByText('Send magic link')).toBeTruthy()
    })

    it('sends magic link with client_id and no application context header', async () => {
      const fetchMock = setupFetchMock()
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
        if (url.includes('/branding')) return { ok: false, status: 404 }
        if (url.includes('/api/v1/apps/test-app/auth-methods')) return { ok: true, json: async () => authMethodsWith({ magicLink: true }) }
        if (url.includes('/magic-link')) return { ok: true, json: async () => ({}) }
        return { ok: false, status: 404 }
      })

      const props = { ...testProviderProps(), authMethods: ['password'] as string[] }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Check your email')).toBeTruthy()
      expect(screen.getByText('We sent a sign-in link to user@test.com.')).toBeTruthy()
      const magicLinkRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/passwordless/magic-link')
      })
      expect(magicLinkRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@test.com', client_id: 'test-app' }),
      })
      expect(magicLinkRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
    })

    it('renders backend-discovered provider buttons', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({
        password: true,
        providers: [googleAuthProvider, githubAuthProvider, unavailableSamlAuthProvider],
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText(/Continue with Google/)).toBeTruthy()
      expect(screen.getByText(/Continue with GitHub/)).toBeTruthy()
      expect(screen.queryByText(/Continue with SAML/)).toBeNull()
    })

    it('starts selected provider authorize flow instead of standard hosted login', async () => {
      vi.useRealTimers()
      const fetchMock = setupFetchMock({
        authMethods: authMethodsWith({ password: true, providers: [googleAuthProvider] }),
        providerAuthorizeResponse: {
          ok: true,
          json: async () => ({ authorizationUrl: 'https://accounts.example.test/o/oauth2/v2/auth' }),
        },
      })
      const props = {
        ...testProviderProps(),
      }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
      const googleButton = await screen.findByText(/Continue with Google/)

      const originalLocation = window.location
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { ...originalLocation, href: '' },
      })

      fireEvent.click(googleButton)

      await waitFor(() => {
        expect(fetchMock.mock.calls.some((call) => call[0] === googleAuthProvider.authorizationUrl)).toBe(true)
      })
      const providerRequest = fetchMock.mock.calls.find((call) => call[0] === googleAuthProvider.authorizationUrl)
      expect(providerRequest?.[1]?.method).toBe('POST')

      const body = JSON.parse(providerRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toMatchObject({
        completionMode: 'AUTHORIZATION_CODE',
        scope: 'openid profile email offline_access',
        codeChallengeMethod: 'S256',
      })
      expect(body.state).toBeTruthy()
      expect(body.codeChallenge).toBeTruthy()
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
      expect(window.location.href).toBe('https://accounts.example.test/o/oauth2/v2/auth')
      expect(window.location.href).not.toContain('/oauth2/authorization/')
      expect(window.location.href).not.toContain('/oauth2/authorize/social/')

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      })
    })

    it('does not create clickable providers from deprecated static config', async () => {
      renderEmbeddedWithConfig({
        socialProviders: [
          { provider: 'google', displayName: 'Google' },
        ],
      }, {
        authMethods: authMethodsWith({ password: true, providers: [] }),
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.queryByText(/Continue with Google/)).toBeNull()
    })

    it('uses deprecated static config only as a display override for discovered providers', async () => {
      renderEmbeddedWithConfig({
        socialProviders: [
          { provider: 'google', displayName: 'Acme Google' },
        ],
      }, {
        authMethods: authMethodsWith({ password: true, providers: [googleAuthProvider] }),
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText(/Continue with Acme Google/)).toBeTruthy()
      expect(screen.queryByText(/Continue with Google$/)).toBeNull()
    })

    it('supports custom provider button rendering', async () => {
      setupFetchMock({ authMethods: authMethodsWith({ password: true, providers: [googleAuthProvider] }) })
      const props = { ...testProviderProps() }
      render(createElement(
        IamProvider,
        props,
        createElement(SignIn, {
          mode: 'embedded',
          renderProviderButton: ({ provider, label, disabled, onClick }) => createElement(
            'button',
            {
              type: 'button',
              disabled,
              onClick: () => void onClick(),
              'data-testid': `custom-${provider.id}`,
            },
            `Custom ${label}`,
          ),
        }),
      ))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByTestId('custom-idp-google').textContent).toBe('Custom Continue with Google')
    })

    it('shows a sanitized auth-methods discovery error', async () => {
      renderEmbeddedWithConfig({}, {
        authMethods: {
          ok: false,
          status: 500,
          json: async () => ({ message: 'raw provider backend details' }),
        },
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText('Sign-in options are unavailable right now.')).toBeTruthy()
      expect(screen.queryByText(/raw provider backend details/)).toBeNull()
    })

    it('does not show credential method actions before identifier continue', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ password: true, sms: true, magicLink: true, emailOtp: true }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText('Continue')).toBeTruthy()
      expect(screen.queryByText('Password')).toBeNull()
      expect(screen.queryByText('SMS code')).toBeNull()
      expect(screen.queryByText('Magic link')).toBeNull()
      expect(screen.queryByText('Email code')).toBeNull()
    })

    it('does not create visible methods from deprecated IamConfig authMethods', async () => {
      renderEmbeddedWithAuthMethods(
        authMethodsWith({ password: true }),
        { authMethods: ['password', 'sms', 'magic_link'] },
      )
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')

      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy()
      expect(screen.queryByText('SMS code')).toBeNull()
      expect(screen.queryByText('Magic link')).toBeNull()
    })

    it('does not fall back to password when no sign-in method is available', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({}))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.getByText('No sign-in method is currently available.')).toBeTruthy()
      expect(screen.queryByPlaceholderText('Enter your password')).toBeNull()
    })

    it('sends and verifies email OTP with client_id and stores tokens when sessionStorage is opted in', async () => {
      const onSuccess = vi.fn()
      const jwt = makeTestJwt()
      const fetchMock = setupFetchMock()
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('openid-configuration')) return { ok: true, json: async () => mockOidcConfig }
        if (url.includes('/branding')) return { ok: false, status: 404 }
        if (url.includes('/api/v1/apps/test-app/auth-methods')) return { ok: true, json: async () => authMethodsWith({ emailOtp: true }) }
        if (url.endsWith('/api/v1/auth/passwordless/email-otp')) return { ok: true, json: async () => ({ sent: true }) }
        if (url.endsWith('/api/v1/auth/passwordless/email-otp/verify')) {
          return {
            ok: true,
            json: async () => ({
              access_token: jwt,
              refresh_token: 'email-otp-rt',
              id_token: 'id-token',
              token_type: 'Bearer',
              expires_in: 3600,
              permissions: ['orders:read'],
            }),
          }
        }
        return { ok: false, status: 404 }
      })

      const props = {
        ...testProviderProps(),
        authMethods: ['password'] as string[],
        tokenStorage: 'sessionStorage' as const,
      }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded', onSuccess })))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      await continueWithIdentifier('user@test.com')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })
      fireEvent.change(screen.getByPlaceholderText('Enter 6-digit code'), { target: { value: '123456' } })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const sendRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.endsWith('/api/v1/auth/passwordless/email-otp')
      })
      expect(sendRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@test.com', client_id: 'test-app' }),
      })
      expect(sendRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')

      const verifyRequest = fetchMock.mock.calls.find((call) => {
        const url = typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.endsWith('/api/v1/auth/passwordless/email-otp/verify')
      })
      expect(verifyRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'user@test.com', code: '123456', client_id: 'test-app' }),
      })
      expect(verifyRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
        version: 3,
        tokens: { access_token: jwt, refresh_token: 'email-otp-rt', id_token: 'id-token', token_type: 'Bearer', expires_in: 3600 },
        authenticationProvenance: 'DIRECT_AUTH',
        refreshProvenance: 'DIRECT_AUTH',
      })
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Send magic link')).toBeNull()
    })

    it('hides providers when social login is disabled by auth-methods', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({
        password: true,
        socialLoginEnabled: false,
        providers: [googleAuthProvider],
      }))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })

      expect(screen.queryByText(/Continue with Google/)).toBeNull()
    })
  })
})
