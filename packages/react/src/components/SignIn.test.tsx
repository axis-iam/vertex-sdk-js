import { createHash, webcrypto } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { SignIn } from './SignIn'
import { storeTestTokens, makeTestJwt, makeTestUser, testProviderProps } from '../test-utils'
import type {
  AuthMethodIdpProviderResponse,
  IdentityProviderOption,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
} from '../core/types'

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
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: null,
  postVerificationRedirectUri: null,
  identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD'] }, { kind: 'PHONE', methods: ['PASSWORD'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }],
  defaultIdentifierKind: 'EMAIL',
  defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
  allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
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
function setupFetchMock(
  overrides: {
    mfa?: boolean
    tokenResponse?: Record<string,unknown>
    authPolicy?: Partial<PublicAuthPolicyResponse>
    loginResponse?: MockResponse
    authMethods?: PublicAuthMethodsResponse | MockResponse
    identityProviders?: IdentityProviderOption[] | MockResponse
    providerAuthorizeResponse?: MockResponse
    branding?: { logoUrl?: string; primaryColor?: string; backgroundColor?: string }
  } = {},
) {
  let created: Record<string,string>
  const expiresAt=new Date(Date.now()+600000).toISOString()
  const view=(state:'MFA_REQUIRED'|'AUTHENTICATED'='AUTHENTICATED')=>({transactionId:'transaction-1',expiresAt,state,nextAction:state==='MFA_REQUIRED'?'mfa':'complete'})
  const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status})
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('/auth-policy'))
      return {
        ok: true,
        json: async () => ({
          signupMode: 'OPEN',
          passwordLoginEnabled: overrides.authMethods?.passwordLoginEnabled ?? true,
          defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
          allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
          allowedRegistrationGrantTypes: [],
          idpAutoProvisioningEnabled: false,
          minPasswordLength: 8,
          requireUppercase: false,
          requireLowercase: false,
          requireDigit: false,
          requireSpecialChar: false,
          breachedPasswordCheck: false,
          ...overrides.authPolicy,
        }),
      }
    if (url.includes('openid-configuration')) {
      return { ok: true, json: async () => mockOidcConfig }
    }
    if (url.includes('/branding')) {
      if (overrides.branding) return { ok: true, json: async () => ({ showLogo: true, ...overrides.branding }) }
      return { ok: false, status: 404 }
    }
    if (url.includes('/api/v1/apps/test-app/auth-methods')) {
      const authMethods = overrides.authMethods ?? defaultAuthMethods
      return 'ok' in authMethods ? authMethods : { ok: true, json: async () => authMethods }
    }
    if (url.includes('/api/v1/apps/test-app/identity-providers')) {
      if (init?.method === 'POST') {
        return (
          overrides.providerAuthorizeResponse ?? {
            ok: true,
            json: async () => ({ authorizationUrl: 'https://provider.example.test/authorize' }),
          }
        )
      }
      const providers = overrides.identityProviders ?? []
      return Array.isArray(providers) ? { ok: true, json: async () => providers } : providers
    }
    if(url.endsWith('/auth/transactions')){created=JSON.parse(String(init?.body));return json({transactionId:'transaction-1',controlSecret:'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',expiresAt,nextAction:'authenticate'})}
    if(url.endsWith('/transactions/transaction-1/authorize')) return json({authorizationUrl:'https://accounts.example.test/o/oauth2/v2/auth',expiresAt})
    if(url.endsWith('/authenticate')){
      if(overrides.loginResponse && !overrides.loginResponse.ok)return json(await overrides.loginResponse.json!(),overrides.loginResponse.status)
      return json(view(overrides.mfa?'MFA_REQUIRED':'AUTHENTICATED'))
    }
    if(url.endsWith('/mfa'))return json(view())
    if(url.endsWith('/challenges'))return json({transactionId:'transaction-1',expiresAt,challengeExpiresAt:new Date(Date.now()+120000).toISOString(),cooldownSeconds:30,nextAction:'authenticate'})
    if(url.endsWith('/cancel'))return json({...view(),state:'CANCELLED',nextAction:'none'})
    if(url.endsWith('/complete'))return json({kind:'authorization_code',code:'one-code',state:created.state,expiresIn:120})
    if(url.endsWith('/token'))return json(overrides.tokenResponse??(overrides.loginResponse?.ok?await overrides.loginResponse.json!():{access_token:makeTestJwt(),token_type:'Bearer',refresh_token:'rt',expires_in:3600}))
    if (url.includes('/api/v1/auth/email/verification/send')) {
      return { ok: true, json: async () => ({ message: 'Verification email sent' }) }
    }
    if (url.endsWith('/api/v1/auth/me')) return {ok:true,json:async()=>makeTestUser()}
    if (url.includes('/api/v1/auth/me/permissions')) {
      return {
        ok: true,
        json: async () => ({
          applicationId: 'app-test',
          organizationId: null,
          roles: ['admin'],
          permissions: ['orders:read', 'orders:create', 'users:*'],
        }),
      }
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
    identifierMethods: ([
      { kind: 'EMAIL', methods: methods.filter(m => m.availableForLogin && ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK'].includes(m.type)).map(m => m.type as 'PASSWORD' | 'EMAIL_OTP' | 'EMAIL_MAGIC_LINK') },
      { kind: 'PHONE', methods: methods.filter(m => m.availableForLogin && ['PASSWORD', 'SMS_OTP'].includes(m.type)).map(m => m.type as 'PASSWORD' | 'SMS_OTP') },
      { kind: 'USERNAME', methods: methods.filter(m => m.availableForLogin && m.type === 'PASSWORD').map(() => 'PASSWORD' as const) },
    ] as PublicAuthMethodsResponse['identifierMethods']).filter(entry => entry.methods.length > 0),
    defaultIdentifierKind: options.password || options.magicLink || options.emailOtp ? 'EMAIL' : options.sms ? 'PHONE' : null,
    defaultLogin: options.password ? { identifierKind: 'EMAIL', method: 'PASSWORD' } : options.magicLink ? { identifierKind: 'EMAIL', method: 'EMAIL_MAGIC_LINK' } : options.emailOtp ? { identifierKind: 'EMAIL', method: 'EMAIL_OTP' } : options.sms ? { identifierKind: 'PHONE', method: 'SMS_OTP' } : null,
    methods,
    idpProviders: options.providers ?? [],
    resend: {
      emailVerificationCooldownSeconds: options.resendCooldownSeconds ?? 60,
    },
  }
}

function methodAvailability(
  type: PublicAuthMethodsResponse['methods'][number]['type'],
  available: boolean,
): PublicAuthMethodsResponse['methods'][number] {
  return {
    type,
    enabled: available,
    configured: available,
    availableForLogin: available,
    availableForSignup: available,
    unavailableReason: available ? null : 'DISABLED',
  }
}

async function continueWithIdentifier(value: string, kind: 'EMAIL' | 'PHONE' | 'USERNAME' = 'EMAIL') {
  const label = { EMAIL: 'Email', PHONE: 'Phone number', USERNAME: 'Username' }[kind]
  if (!screen.queryByLabelText(label)) {
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }))
  }
  const input = screen.getByLabelText(label)
  fireEvent.change(input, { target: { value } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
}

describe('SignIn', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto',{getRandomValues:webcrypto.getRandomValues.bind(webcrypto),subtle:{digest:async (_algorithm:string,data:Uint8Array)=>createHash('sha256').update(data).digest()}})
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    window.history.replaceState(null,'','/')
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('redirect mode (default)', () => {
    it('renders sign in button when not authenticated', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
    })

    it('renders forgot password URL when configured', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { forgotPasswordUrl: '/forgot-password' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Forgot password?').getAttribute('href')).toBe('/forgot-password')
    })

    it('shows signed-in state when authenticated', async () => {
      storeTestTokens()
      setupFetchMock()
      renderWithProvider(createElement(SignIn))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Signed in as test@example.com')).toBeTruthy()
    })
  })

  describe('embedded mode', () => {
    it('keeps registration kind explicit when switching from phone sign-in', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded' }))
      await act(async () => vi.advanceTimersByTimeAsync(10))
      fireEvent.click(screen.getByRole('button', { name: 'Phone number', exact: true }))
      fireEvent.click(screen.getByRole('button', { name: 'Sign up', exact: true }))
      expect(screen.getByRole('button', { name: 'Email', exact: true }).getAttribute('aria-pressed')).toBe('true')
      expect((screen.getByLabelText('Email') as HTMLInputElement).type).toBe('email')
      expect(screen.queryByLabelText('Phone number')).toBeNull()
    })
    it.each(['en', 'zh-CN'] as const)('owns one bidirectional registration footer in %s', async (locale) => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded' }), { locale })
      await act(async () => vi.advanceTimersByTimeAsync(10))
      const up = locale === 'en' ? 'Sign up' : '注册'
      const down = locale === 'en' ? 'Sign in' : '登录'
      expect(screen.getAllByRole('button', { name: up })).toHaveLength(1)
      expect(screen.getByText(locale === 'en' ? "Don't have an account?" : '还没有账户？')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: up }))
      expect(screen.getByLabelText(locale === 'en' ? 'Identifier type' : '标识类型')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: down })).toHaveLength(1)
      fireEvent.click(screen.getByRole('button', { name: down }))
      expect(screen.getByLabelText(locale === 'en' ? 'Email' : '邮箱')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: up })).toHaveLength(1)
    })

    it.each(['host', 'policy', 'capability', 'self-registration', 'method'] as const)(
      'hides the signup footer when the %s gate excludes it', async (gate) => {
        setupFetchMock({
          authPolicy: gate === 'policy' ? { signupMode: 'DISABLED' } : {},
          authMethods: {
            ...defaultAuthMethods,
            ...(gate === 'capability' ? { signupEnabled: false } : {}),
            ...(gate === 'self-registration' ? { selfRegistrationEnabled: false } : {}),
            ...(gate === 'method' ? { methods: defaultAuthMethods.methods.map((method) => ({ ...method, availableForSignup: false })) } : {}),
          },
        })
        renderWithProvider(createElement(SignIn, { mode: 'embedded', allowSignUp: gate !== 'host' }))
        await act(async () => vi.advanceTimersByTimeAsync(10))
        expect(screen.queryByRole('button', { name: 'Sign up' })).toBeNull()
      },
    )

    it('cancels the mounted signup view when the host disables allowSignUp', async () => {
      setupFetchMock()
      const view = renderWithProvider(createElement(SignIn, { mode: 'embedded' }))
      await act(async () => vi.advanceTimersByTimeAsync(10))
      fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
      expect(screen.getByLabelText('Confirm password')).toBeTruthy()
      view.rerender(createElement(IamProvider, testProviderProps(), createElement(SignIn, { mode: 'embedded', allowSignUp: false })))
      await act(async () => vi.advanceTimersByTimeAsync(10))
      expect(screen.queryByLabelText('Confirm password')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Sign up' })).toBeNull()
    })

    it('renders identifier above its actual credential method without an extra continue step', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy()

      await continueWithIdentifier('user@test.com')

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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'wrong-pass' },
      })

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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'correct-pass' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSuccess.mock.calls[0][0].id).toBe('user-1')

      const loginRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/transactions/transaction-1/authenticate')
      })
      expect(loginRequest?.[1]?.method).toBe('POST')
      const body = JSON.parse(loginRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toMatchObject({
        identifier: { kind: 'EMAIL', value: 'user@test.com' },
        password: 'correct-pass',
        method: 'PASSWORD',
      })
      expect(JSON.stringify(body)).not.toContain('clientSecret')
      expect(JSON.stringify(body)).not.toContain('client_secret')
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(sessionStorage.getItem('iam_permissions')).toBeNull()
    })

    it('continues a real-schema MFA challenge with camelCase proof and keeps it private', async () => {
      const onSuccess = vi.fn()
      const base = setupFetchMock({mfa:true})
      renderWithProvider(createElement(SignIn, { mode: 'embedded', onSuccess }), { tokenStorage: 'memory' })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-pass' } })
      await act(async () => {
        fireEvent.submit(screen.getByLabelText('Password').closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(screen.getByLabelText('Authenticator code')).toBeTruthy()
      expect(document.body.innerHTML).not.toContain('private-mfa-proof')
      expect(onSuccess).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } })
      await act(async () => {
        fireEvent.submit(screen.getByLabelText('Authenticator code').closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })
      const call = base.mock.calls.find((call) => String(call[0]).endsWith('/transactions/transaction-1/mfa'))
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({ method: 'TOTP', code: '123456' })
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
    })

    it('does not let an old password finally clear the new attempt input', async () => {
      let finish!: (value: MockResponse) => void
      const delayed = new Promise<MockResponse>((resolve) => {
        finish = resolve
      })
      const base = setupFetchMock()
      const implementation = base.getMockImplementation()!
      base.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith('/authenticate') ? delayed : implementation(input, init),
      )
      const onError = vi.fn()
      renderWithProvider(createElement(SignIn, { mode: 'embedded', onError }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      await continueWithIdentifier('user@test.com')
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'old-secret' } })
      await act(async () => {
        fireEvent.submit(screen.getByLabelText('Password').closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })
      fireEvent.click(screen.getByText('Change'))
      await continueWithIdentifier('new@test.com')
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'new-secret' } })
      await act(async () => {
        finish({ ok: false, status: 401, json: async () => ({ error: 'invalid_credentials' }) })
        await vi.advanceTimersByTimeAsync(10)
      })
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('new-secret')
      expect(onError).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('verify@test.com')
      fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
        target: { value: 'correct-pass' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter your password').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Verify your email before signing in.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Resend', exact: true })).toBeTruthy()
      expect(onError).toHaveBeenCalledTimes(1)
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Resend', exact: true }))
        await vi.advanceTimersByTimeAsync(100)
      })

      const resendRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('username-only')
      fireEvent.submit(screen.getByLabelText('Email').closest('form')!)

      expect(screen.getByText('Enter a valid email address or phone number.')).toBeTruthy()
      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Resend', exact: true })).toBeNull()
    })

    it('calls onForgotPassword when configured', async () => {
      const onForgotPassword = vi.fn()
      setupFetchMock()
      renderWithProvider(createElement(SignIn, { mode: 'embedded', onForgotPassword }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

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
      config: {
        authMethods?: string[]
        socialProviders?: Array<{ provider: string; displayName?: string }>
      } = {},
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
      render(
        createElement(
          IamProvider,
          { ...testProviderProps(), locale: 'zh-CN' },
          createElement(SignIn, { mode: 'embedded' }),
        ),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByAltText('应用标志')).toBeTruthy()
      const identifier = screen.getByLabelText('手机号')
      fireEvent.change(screen.getByLabelText('国家/地区'), { target: { value: 'CN' } })
      fireEvent.change(identifier, { target: { value: '+8613800138000' } })
      await act(async () => {
        fireEvent.submit(identifier.closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByLabelText('验证码')).toBeTruthy()
      expect(screen.queryByLabelText('手机号')).toBeNull()
    })

    it('keeps branding logo centered and bounded when host CSS makes images block-level', async () => {
      setupFetchMock({ branding: { logoUrl: 'https://assets.example.test/landscape.png' } })
      const { container } = render(
        createElement(IamProvider, testProviderProps(), createElement(SignIn, { mode: 'embedded' })),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
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
      renderEmbeddedWithAuthMethods(
        authMethodsWith({ password: true, sms: true, magicLink: true, emailOtp: true }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')

      const buttons = screen.getAllByRole('button').map((button) => button.textContent)
      expect(buttons).toContain('Password')
      expect(buttons).toContain('Email code')
      expect(buttons).toContain('Magic link')
      expect(buttons).not.toContain('SMS code')
    })

    it('offers SMS and password for an explicitly selected phone identifier', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ password: true, sms: true }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('+8613800138000', 'PHONE')

      expect(screen.getByLabelText('Phone number')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Password', exact: true })).toBeTruthy()
      expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('13800138000')
      expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'SMS code', exact: true }))
      expect(screen.getByText('Send code')).toBeTruthy()
    })

    it('sends SMS code with client_id and no application context header', async () => {
      const fetchMock = setupFetchMock({authMethods:authMethodsWith({sms:true})})

      const props = { ...testProviderProps(), authMethods: ['password'] as string[] }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('+8613800138000', 'PHONE')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByPlaceholderText('Enter 6-digit code')).toBeTruthy()
      const smsRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/transactions/transaction-1/challenges')
      })
      expect(smsRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method:'SMS_OTP',identifier:{kind:'PHONE',value:'+8613800138000'} }),
      })
      expect(smsRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
    })

    it('verifies SMS code with client_id and stores snake_case tokens when sessionStorage is opted in', async () => {
      const onSuccess = vi.fn()
      const jwt = makeTestJwt()
      const fetchMock = setupFetchMock({authMethods:authMethodsWith({sms:true}),tokenResponse:{access_token:jwt,refresh_token:'sms-rt',token_type:'Bearer',expires_in:3600}})

      const props = {
        ...testProviderProps(),
        authMethods: ['password'] as string[],
        tokenStorage: 'sessionStorage' as const,
      }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded', onSuccess })))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('+8613800138000', 'PHONE')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })
      fireEvent.change(screen.getByPlaceholderText('Enter 6-digit code'), { target: { value: '123456' } })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter 6-digit code').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const verifyRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/transactions/transaction-1/authenticate')
      })
      expect(verifyRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method:'SMS_OTP',identifier:{kind:'PHONE',value:'+8613800138000'},proof:'123456' }),
      })
      expect(verifyRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
        version: 6,
        expiresAt: expect.any(Number),
        tokens: { access_token: jwt, refresh_token: 'sms-rt', token_type: 'Bearer', expires_in: 3600 },
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      })
      const expiresAt = JSON.parse(sessionStorage.getItem('axis_iam_session')!).expiresAt as number
      expect(expiresAt).toBeGreaterThan(Date.now() + 3599_000)
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })

    it('restores original-tab Magic fragment through rendered MFA recovery and scrubs the proof', async () => {
      const fetchMock = setupFetchMock({authMethods:authMethodsWith({magicLink:true}),mfa:true})
      const onSuccess = vi.fn()
      const first = renderWithProvider(createElement(SignIn,{mode:'embedded'}))
      await act(async()=>{await vi.advanceTimersByTimeAsync(10)})
      await continueWithIdentifier('user@test.com')
      await act(async()=>{
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(20)
      })
      const create = fetchMock.mock.calls.find(call=>String(call[0]).endsWith('/auth/transactions'))!
      const binding = JSON.parse(String(create[1]?.body))
      const fragment = new URLSearchParams({kind:'AUTH_PROOF',auth_transaction_id:'transaction-1',method:'EMAIL_MAGIC_LINK',state:binding.state,proof:'magic-private-proof'})
      first.unmount()
      expect(sessionStorage.getItem('axis_iam_pending_authorization')).not.toBeNull()
      window.history.replaceState(null,'',`${binding.redirect_uri}#${fragment}`)
      renderWithProvider(createElement(SignIn,{mode:'embedded',onSuccess}))
      await act(async()=>{await vi.advanceTimersByTimeAsync(10)})
      await continueWithIdentifier('user@test.com')
      await act(async()=>{
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(20)
      })
      expect(window.location.hash).toBe('')
      expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
      expect(onSuccess).not.toHaveBeenCalled()
      fireEvent.change(screen.getByRole('combobox',{name:'Credential'}),{target:{value:'RECOVERY_CODE'}})
      const recovery = screen.getByLabelText('Recovery code')
      expect(recovery.getAttribute('type')).toBe('password')
      fireEvent.change(recovery,{target:{value:'recovery-private-proof'}})
      await act(async()=>{
        fireEvent.submit(recovery.closest('form')!)
        await vi.advanceTimersByTimeAsync(20)
      })
      expect(onSuccess).toHaveBeenCalledOnce()
      const mfa = fetchMock.mock.calls.find(call=>String(call[0]).endsWith('/mfa'))!
      expect(JSON.parse(String(mfa[1]?.body))).toEqual({method:'RECOVERY_CODE',code:'recovery-private-proof'})
      expect(document.body.innerHTML).not.toMatch(/magic-private-proof|recovery-private-proof|controlSecret/)
    })

    it('renders a returned Provider continuation through original control and recovery MFA',async()=>{
      const onSuccess=vi.fn(),fetchMock=setupFetchMock({mfa:true})
      const expiresAt=new Date(Date.now()+600000).toISOString(),secret='BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
      sessionStorage.setItem('axis_iam_pending_authorization',JSON.stringify({version:1,issuer:ISSUER,clientId:'test-app',redirectUri:new URL('/callback',window.location.origin).href,entryMode:'CUSTOM',flowOwner:secret,state:secret,verifier:secret,transactionId:'transaction-1',controlSecret:secret,expiresAt}))
      const base=fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(async(input:RequestInfo|URL,init?:RequestInit)=>{
        if(String(input).endsWith('/transaction-1'))return new Response(JSON.stringify({transactionId:'transaction-1',expiresAt,state:'MFA_REQUIRED',nextAction:'mfa'}))
        if(String(input).endsWith('/complete'))return new Response(JSON.stringify({kind:'authorization_code',code:'provider-mfa',state:secret,expiresIn:120}))
        return base(input,init)
      })
      window.history.replaceState(null,'','/callback?'+new URLSearchParams({kind:'AUTH_CONTINUATION',auth_transaction_id:'transaction-1',state:secret}))
      renderWithProvider(createElement(SignIn,{mode:'embedded',onSuccess}))
      await act(async()=>{await vi.advanceTimersByTimeAsync(10)})
      expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
      await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Continue'}));await vi.advanceTimersByTimeAsync(20)})
      expect(screen.getByLabelText('Authenticator code')).toBeTruthy()
      expect(window.location.search).toBe('')
      expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
      expect(onSuccess).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText('Authenticator code'),{target:{value:'123456'}})
      await act(async()=>{fireEvent.submit(screen.getByLabelText('Authenticator code').closest('form')!);await vi.advanceTimersByTimeAsync(20)})
      expect(onSuccess).toHaveBeenCalledOnce()
    })

    it('renders magic link form', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ magicLink: true }), { authMethods: ['password'] })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')

      expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
      expect(screen.getByText('Send magic link')).toBeTruthy()
    })

    it('sends magic link with client_id and no application context header', async () => {
      const fetchMock = setupFetchMock({authMethods:authMethodsWith({magicLink:true})})

      const props = { ...testProviderProps(), authMethods: ['password'] as string[] }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded' })))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Check your email')).toBeTruthy()
      expect(screen.getByText('We sent a sign-in link to user@test.com.')).toBeTruthy()
      const magicLinkRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/transactions/transaction-1/challenges')
      })
      expect(magicLinkRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method:'EMAIL_MAGIC_LINK',identifier:{kind:'EMAIL',value:'user@test.com'} }),
      })
      expect(magicLinkRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
    })

    it('renders backend-discovered provider buttons', async () => {
      renderEmbeddedWithAuthMethods(
        authMethodsWith({
          password: true,
          providers: [googleAuthProvider, githubAuthProvider, unavailableSamlAuthProvider],
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

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
        expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/transactions/transaction-1/authorize'))).toBe(
          true,
        )
      })
      const providerRequest = fetchMock.mock.calls.find(
        (call) => String(call[0]).endsWith('/transactions/transaction-1/authorize'),
      )
      expect(providerRequest?.[1]?.method).toBe('POST')

      const body = JSON.parse(providerRequest?.[1]?.body as string) as Record<string, string>
      expect(body).toEqual({providerId:'idp-google'})
      expect(JSON.parse(sessionStorage.getItem('axis_iam_pending_authorization')!).entryMode).toBe('CUSTOM')
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
      renderEmbeddedWithConfig(
        {
          socialProviders: [{ provider: 'google', displayName: 'Google' }],
        },
        {
          authMethods: authMethodsWith({ password: true, providers: [] }),
        },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.queryByText(/Continue with Google/)).toBeNull()
    })

    it('uses deprecated static config only as a display override for discovered providers', async () => {
      renderEmbeddedWithConfig(
        {
          socialProviders: [{ provider: 'google', displayName: 'Acme Google' }],
        },
        {
          authMethods: authMethodsWith({ password: true, providers: [googleAuthProvider] }),
        },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText(/Continue with Acme Google/)).toBeTruthy()
      expect(screen.queryByText(/Continue with Google$/)).toBeNull()
    })

    it('supports custom provider button rendering', async () => {
      setupFetchMock({ authMethods: authMethodsWith({ password: true, providers: [googleAuthProvider] }) })
      const props = { ...testProviderProps() }
      render(
        createElement(
          IamProvider,
          props,
          createElement(SignIn, {
            mode: 'embedded',
            renderProviderButton: ({ provider, label, disabled, onClick }) =>
              createElement(
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
        ),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByTestId('custom-idp-google').textContent).toBe('Custom Continue with Google')
    })

    it('shows a sanitized auth-methods discovery error', async () => {
      renderEmbeddedWithConfig(
        {},
        {
          authMethods: {
            ok: false,
            status: 500,
            json: async () => ({ message: 'raw provider backend details' }),
          },
        },
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Sign-in options are unavailable right now.')).toBeTruthy()
      expect(screen.queryByText(/raw provider backend details/)).toBeNull()
    })

    it('shows actual credential choices under the identifier before submission', async () => {
      renderEmbeddedWithAuthMethods(
        authMethodsWith({ password: true, sms: true, magicLink: true, emailOtp: true }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByRole('button', { name: 'Sign in', exact: true })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Password', exact: true })).toBeTruthy()
      expect(screen.queryByText('SMS code')).toBeNull()
      expect(screen.getByRole('button', { name: 'Magic link', exact: true })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Email code', exact: true })).toBeTruthy()
    })

    it('does not create visible methods from deprecated IamConfig authMethods', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({ password: true }), {
        authMethods: ['password', 'sms', 'magic_link'],
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')

      expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy()
      expect(screen.queryByText('SMS code')).toBeNull()
      expect(screen.queryByText('Magic link')).toBeNull()
    })

    it('does not fall back to password when no sign-in method is available', async () => {
      renderEmbeddedWithAuthMethods(authMethodsWith({}))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('No sign-in method is currently available.')).toBeTruthy()
      expect(screen.queryByPlaceholderText('Enter your password')).toBeNull()
    })

    it('sends and verifies email OTP with client_id and stores tokens when sessionStorage is opted in', async () => {
      const onSuccess = vi.fn()
      const jwt = makeTestJwt()
      const fetchMock = setupFetchMock({authMethods:authMethodsWith({emailOtp:true}),tokenResponse:{access_token:jwt,refresh_token:'email-otp-rt',id_token:'id-token',token_type:'Bearer',expires_in:3600}})

      const props = {
        ...testProviderProps(),
        authMethods: ['password'] as string[],
        tokenStorage: 'sessionStorage' as const,
      }
      render(createElement(IamProvider, props, createElement(SignIn, { mode: 'embedded', onSuccess })))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      await continueWithIdentifier('user@test.com')
      await act(async () => {
        fireEvent.click(screen.getByText('Send code'))
        await vi.advanceTimersByTimeAsync(100)
      })
      fireEvent.change(screen.getByPlaceholderText('Enter 6-digit code'), { target: { value: '123456' } })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('Enter 6-digit code').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const sendRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.endsWith('/api/v1/auth/transactions/transaction-1/challenges')
      })
      expect(sendRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method:'EMAIL_OTP',identifier:{kind:'EMAIL',value:'user@test.com'} }),
      })
      expect(sendRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')

      const verifyRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.endsWith('/api/v1/auth/transactions/transaction-1/authenticate')
      })
      expect(verifyRequest?.[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ method:'EMAIL_OTP',identifier:{kind:'EMAIL',value:'user@test.com'},proof:'123456' }),
      })
      expect(verifyRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(JSON.parse(sessionStorage.getItem('axis_iam_session') ?? '{}')).toMatchObject({
        version: 6,
        expiresAt: expect.any(Number),
        tokens: {
          access_token: jwt,
          refresh_token: 'email-otp-rt',
          id_token: 'id-token',
          token_type: 'Bearer',
          expires_in: 3600,
        },
        authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
        refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
      })
      const expiresAt = JSON.parse(sessionStorage.getItem('axis_iam_session')!).expiresAt as number
      expect(expiresAt).toBeGreaterThan(Date.now() + 3599_000)
      expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(screen.queryByText('Send magic link')).toBeNull()
    })

    it('hides providers when social login is disabled by auth-methods', async () => {
      renderEmbeddedWithAuthMethods(
        authMethodsWith({
          password: true,
          socialLoginEnabled: false,
          providers: [googleAuthProvider],
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.queryByText(/Continue with Google/)).toBeNull()
    })
  })
})
