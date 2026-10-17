import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import * as context from '../provider/IamProvider'
import { IamUiProvider } from '../provider/IamUiProvider'
import { OAuthClient } from '../core/oauth-client'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { makeTestJwt } from '../test-utils'
import { buildHostedSignupUrl, SignUp } from './SignUp'
import { testProviderProps } from '../test-utils'
import type {
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantInput,
} from '../core/types'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

function renderWithProvider(
  ui: React.ReactElement,
  props: Partial<ReturnType<typeof testProviderProps>> = {},
) {
  return render(createElement(IamProvider, { ...testProviderProps(), ...props }, ui))
}

type MockResponse = {
  ok: boolean
  status?: number
  json?: () => Promise<unknown>
  statusText?: string
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

const defaultAuthPolicy: PublicAuthPolicyResponse = {
  passwordLoginEnabled: true,
  passwordlessEnabled: false,
  minPasswordLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
  breachedPasswordCheck: false,
  totpEnabled: false,
  webauthnEnabled: false,
  mfaEnforcement: 'OPTIONAL',
  stepUpEnabled: false,
  stepUpTriggers: [],
  deviceTrustDays: 0,
  maxTrustedDevices: 0,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  progressiveLockout: false,
  emailVerificationMode: 'OFF',
  idpAutoProvisioningEnabled: false,
  signupMode: 'OPEN',
  allowedRegistrationGrantTypes: ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'],
}

function setupFetchMock(
  overrides: {
    signupResponse?: MockResponse
    authMethods?: MockResponse | Partial<PublicAuthMethodsResponse>
    authPolicy?: MockResponse | Partial<PublicAuthPolicyResponse>
    resendResponse?: MockResponse
  } = {},
) {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('openid-configuration')) {
      return { ok: true, json: async () => mockOidcConfig }
    }
    if (url.includes('/branding')) {
      return { ok: false, status: 404 }
    }
    if (url.includes('/api/v1/apps/test-app/auth-methods')) {
      const authMethods = overrides.authMethods ?? {}
      if ('ok' in authMethods) return authMethods
      return { ok: true, json: async () => ({ ...defaultAuthMethods, ...authMethods }) }
    }
    if (url.includes('/api/v1/apps/test-app/auth-policy')) {
      const authPolicy = overrides.authPolicy ?? {}
      if ('ok' in authPolicy) return authPolicy
      return { ok: true, json: async () => ({ ...defaultAuthPolicy, ...authPolicy }) }
    }
    if (url.includes('/api/v1/auth/signup')) {
      return (
        overrides.signupResponse ?? {
          ok: true,
          json: async () => ({
            id: 'user-123',
            email: 'new@user.com',
            username: null,
            status: 'ACTIVE',
            emailVerified: false,
            roles: [],
            metadata: {},
          }),
        }
      )
    }
    if (url.includes('/api/v1/auth/email/verification/send')) {
      return (
        overrides.resendResponse ?? {
          ok: true,
          json: async () => ({ message: 'Verification email sent' }),
        }
      )
    }
    return { ok: false, status: 404 }
  })
  globalThis.fetch = fetchMock
  return fetchMock
}

describe('SignUp', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('redirect mode (default)', () => {
    it('renders create account button', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignUp))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Create account')).toBeTruthy()
      expect(screen.getByText('Sign up')).toBeTruthy()
    })

    it.each([
      [{ type: 'EMAIL_LINK', registrationGrantToken: 'email-link-proof' }, 'registrationGrantToken'],
      [{ type: 'ACCESS_CODE', registrationAccessCode: '12345678' }, 'registrationAccessCode'],
    ] as const)(
      'builds the backend hosted signup URL for supported proof',
      (registrationGrant, expectedField) => {
        const url = new URL(buildHostedSignupUrl(ISSUER, 'test-app', registrationGrant))
        expect(url.pathname).toBe('/signup')
        expect(url.searchParams.get('client_id')).toBe('test-app')
        expect(url.searchParams.get(expectedField)).toBe(Object.values(registrationGrant)[1])
        expect(url.searchParams.has('organizationInvitationToken')).toBe(false)
        expect(url.pathname).not.toBe('/authorize')
      },
    )

    it('rejects an unknown hosted proof instead of generating a client-id-only URL', () => {
      expect(() =>
        buildHostedSignupUrl(ISSUER, 'test-app', {
          type: 'UNKNOWN',
          proof: 'untrusted-proof',
        } as unknown as RegistrationGrantInput),
      ).toThrow(expect.objectContaining({ code: 'REGISTRATION_GRANT_INVALID' }))
    })

    it('fails Organization invitation redirect before navigation and reports onError', async () => {
      const onError = vi.fn()
      setupFetchMock()
      renderWithProvider(
        createElement(SignUp, {
          registrationGrant: { type: 'ORG_INVITATION', organizationInvitationToken: 'invite-proof' },
          onError,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      await act(async () => fireEvent.click(screen.getByText('Sign up')))

      expect(screen.getByText('This registration invitation or access code is unavailable.')).toBeTruthy()
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED' }),
      )
    })

    it('fails redirect proof excluded by the public policy before hosted navigation', async () => {
      const onError = vi.fn()
      const fetchMock = setupFetchMock({ authPolicy: { allowedRegistrationGrantTypes: ['EMAIL_LINK'] } })
      renderWithProvider(
        createElement(SignUp, {
          registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: '12345678' },
          onError,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      const callsBeforeClick = fetchMock.mock.calls.length
      await act(async () => fireEvent.click(screen.getByText('Sign up')))

      expect(screen.getByText('This registration invitation or access code is unavailable.')).toBeTruthy()
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED' }),
      )
      expect(fetchMock.mock.calls).toHaveLength(callsBeforeClick + 1)
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/auth-policy')
    })
  })

  describe('embedded mode', () => {
    it('renders email, password, and confirm password fields', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
      expect(screen.getByLabelText('Password')).toBeTruthy()
      expect(screen.getByPlaceholderText('Confirm your password')).toBeTruthy()
    })

    it('shows error when passwords do not match', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'different' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Passwords do not match')).toBeTruthy()
    })

    it('shows error when password is too short', async () => {
      setupFetchMock()
      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'a@b.com' } })
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'short' } })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByRole('alert')).toBeTruthy()
    })

    it('does not POST signup when backend disables self-registration', async () => {
      const fetchMock = setupFetchMock({
        authMethods: {
          signupEnabled: true,
          selfRegistrationEnabled: false,
        },
      })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Sign-up is unavailable right now.')).toBeTruthy()
      expect(
        fetchMock.mock.calls.some((call) => {
          const url =
            typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
          return url.includes('/api/v1/auth/signup')
        }),
      ).toBe(false)
    })

    it('renders invite-required access-code entry without issuing a doomed signup request', async () => {
      const fetchMock = setupFetchMock({ authPolicy: { signupMode: 'INVITE_REQUIRED' } })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('An invitation or registration access code is required.')).toBeTruthy()
      expect(screen.getByPlaceholderText('Enter access code')).toBeTruthy()
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/signup'))).toBe(false)
    })

    it('does not offer an access-code field when invite-required policy excludes ACCESS_CODE', async () => {
      setupFetchMock({
        authPolicy: {
          signupMode: 'INVITE_REQUIRED',
          allowedRegistrationGrantTypes: ['EMAIL_LINK', 'ORG_INVITATION'],
        },
      })
      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('An invitation is required to create an account.')).toBeTruthy()
      expect(screen.queryByPlaceholderText('Enter access code')).toBeNull()
    })

    it('fails before signup when supplied proof type is excluded by policy', async () => {
      const onError = vi.fn()
      const fetchMock = setupFetchMock({ authPolicy: { allowedRegistrationGrantTypes: ['EMAIL_LINK'] } })
      renderWithProvider(
        createElement(SignUp, {
          mode: 'embedded',
          registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: '12345678' },
          onError,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })
      await act(async () => fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!))

      expect(screen.getByRole('alert')).toBeTruthy()
      expect(onError).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/signup'))).toBe(false)
    })

    it('rejects a blank embedded proof instead of submitting a proof-less signup request', async () => {
      const onError = vi.fn()
      const fetchMock = setupFetchMock()
      renderWithProvider(
        createElement(SignUp, {
          mode: 'embedded',
          registrationGrant: { type: 'EMAIL_LINK', registrationGrantToken: '  ' },
          onError,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })
      await act(async () => fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!))

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'REGISTRATION_GRANT_INVALID' }))
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/signup'))).toBe(false)
    })

    it('does not render or submit when registration is disabled', async () => {
      const fetchMock = setupFetchMock({ authPolicy: { signupMode: 'DISABLED' } })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      expect(screen.getByText('Sign-up is unavailable right now.')).toBeTruthy()
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/v1/auth/signup'))).toBe(false)
    })

    it.each([
      [
        { type: 'EMAIL_LINK', registrationGrantToken: 'email-link-proof' },
        { registrationGrantToken: 'email-link-proof' },
      ],
      [{ type: 'ACCESS_CODE', registrationAccessCode: '12345678' }, { registrationAccessCode: '12345678' }],
      [
        { type: 'ORG_INVITATION', organizationInvitationToken: 'organization-invitation-proof' },
        { organizationInvitationToken: 'organization-invitation-proof' },
      ],
    ] as const)(
      'submits exactly one supplied proof for open registration',
      async (registrationGrant, proofBody) => {
        const fetchMock = setupFetchMock()
        renderWithProvider(createElement(SignUp, { mode: 'embedded', registrationGrant }))
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10)
        })

        fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
          target: { value: 'new@user.com' },
        })
        fireEvent.change(screen.getByLabelText('Password'), {
          target: { value: 'password123' },
        })
        fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
          target: { value: 'password123' },
        })
        await act(async () => {
          fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
          await vi.advanceTimersByTimeAsync(100)
        })

        const signupRequest = fetchMock.mock.calls.find((call) =>
          String(call[0]).includes('/api/v1/auth/signup'),
        )
        expect(JSON.parse((signupRequest?.[1] as RequestInit).body as string)).toEqual({
          email: 'new@user.com',
          password: 'password123',
          client_id: 'test-app',
          ...proofBody,
        })
        expect(sessionStorage.getItem('registrationGrantToken')).toBeNull()
        expect(sessionStorage.getItem('registrationAccessCode')).toBeNull()
        expect(sessionStorage.getItem('organizationInvitationToken')).toBeNull()
      },
    )

    it('submits the invite-required access code from component memory', async () => {
      const fetchMock = setupFetchMock({ authPolicy: { signupMode: 'INVITE_REQUIRED' } })
      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByPlaceholderText('Enter access code'), { target: { value: '12345678' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const signupRequest = fetchMock.mock.calls.find((call) =>
        String(call[0]).includes('/api/v1/auth/signup'),
      )
      expect(JSON.parse((signupRequest?.[1] as RequestInit).body as string)).toMatchObject({
        registrationAccessCode: '12345678',
      })
      expect(screen.queryByPlaceholderText('Enter access code')).toBeNull()
      expect(sessionStorage.getItem('registrationAccessCode')).toBeNull()
    })

    it('sends client_id for end-user signup without application context header', async () => {
      const onSuccess = vi.fn()
      const fetchMock = setupFetchMock()

      renderWithProvider(createElement(SignUp, { mode: 'embedded', onSuccess }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      const signupRequest = fetchMock.mock.calls.find((call) => {
        const url =
          typeof call[0] === 'string' ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url
        return url.includes('/api/v1/auth/signup')
      })
      expect(signupRequest).toEqual([
        `${ISSUER}/api/v1/auth/signup`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: 'new@user.com', password: 'password123', client_id: 'test-app' }),
        },
      ])
      const [, init] = signupRequest ?? []
      expect((init as RequestInit | undefined)?.headers).not.toHaveProperty('X-Application-Id')
    })

    it('handles user-info response without storing tokens', async () => {
      const onSuccess = vi.fn()
      setupFetchMock({
        signupResponse: {
          ok: true,
          json: async () => ({
            id: 'user-123',
            email: 'new@user.com',
            username: 'newuser',
            status: 'ACTIVE',
            emailVerified: false,
            roles: [],
            metadata: { source: 'signup' },
          }),
        },
      })

      renderWithProvider(createElement(SignUp, { mode: 'embedded', onSuccess }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onSuccess).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'new@user.com',
        username: 'newuser',
        status: 'ACTIVE',
        emailVerified: false,
        roles: [],
        metadata: { source: 'signup' },
      })
      expect(sessionStorage.getItem('iam_tokens')).toBeNull()
      expect(screen.getByText('Account created')).toBeTruthy()
      expect(screen.getByText('new@user.com can now sign in.')).toBeTruthy()
      expect(screen.getByText('Sign in')).toBeTruthy()
    })

    it('shows optional verification next step without blocking sign in', async () => {
      setupFetchMock({ authMethods: { emailVerificationMode: 'OPTIONAL' } })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Account created')).toBeTruthy()
      expect(screen.getByText(/You can sign in now and verify your email when you are ready/)).toBeTruthy()
      expect(screen.getByText('Resend in 60s')).toBeTruthy()
      expect(screen.getByText('Sign in')).toBeTruthy()
    })

    it('shows required verification next step and does not imply immediate sign in', async () => {
      setupFetchMock({ authMethods: { emailVerificationMode: 'REQUIRED' } })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Check your email')).toBeTruthy()
      expect(screen.getByText(/Verify your email before signing in/)).toBeTruthy()
      expect(screen.getByText('Resend in 60s')).toBeTruthy()
      expect(screen.queryByText('Sign in')).toBeNull()
    })

    it('treats PENDING signup response as required even when auth methods mode is off', async () => {
      setupFetchMock({
        authMethods: { emailVerificationMode: 'OFF' },
        signupResponse: {
          ok: true,
          json: async () => ({
            id: 'user-123',
            email: 'pending@user.com',
            username: null,
            status: 'PENDING',
            emailVerified: false,
            roles: [],
            metadata: {},
          }),
        },
      })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
        target: { value: 'pending@user.com' },
      })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Check your email')).toBeTruthy()
      expect(screen.getByText(/Verify your email before signing in/)).toBeTruthy()
      expect(screen.queryByText('Sign in')).toBeNull()
    })

    it('resends verification email with client_id and no application context header', async () => {
      const fetchMock = setupFetchMock({ authMethods: { emailVerificationMode: 'REQUIRED' } })

      renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000)
      })
      await act(async () => {
        fireEvent.click(screen.getByText('Resend verification email'))
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
        body: JSON.stringify({ email: 'new@user.com', client_id: 'test-app' }),
      })
      expect(resendRequest?.[1]?.headers).not.toHaveProperty('X-Application-Id')
      expect(screen.getByText('Verification email sent.')).toBeTruthy()
    })

    it('shows API error response', async () => {
      const onError = vi.fn()
      setupFetchMock({
        signupResponse: {
          ok: false,
          status: 409,
          json: async () => ({ message: 'Email already exists' }),
        },
      })

      renderWithProvider(createElement(SignUp, { mode: 'embedded', onError }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })

      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })

      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('We could not create your account. Please try again.')).toBeTruthy()
      expect(screen.queryByText('Email already exists')).toBeNull()
      expect(onError).toHaveBeenCalledTimes(1)
    })

    it('maps registration rate limits without leaking backend error details', async () => {
      const onError = vi.fn()
      setupFetchMock({
        signupResponse: {
          ok: false,
          status: 429,
          json: async () => ({
            error: 'REGISTRATION_GRANT_ATTEMPT_RATE_LIMITED',
            message: 'internal proof state',
          }),
        },
      })
      renderWithProvider(
        createElement(SignUp, {
          mode: 'embedded',
          registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: '12345678' },
          onError,
        }),
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      })
      fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
        target: { value: 'password123' },
      })
      await act(async () => {
        fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(screen.getByText('Too many requests. Please try again later.')).toBeTruthy()
      expect(onError).toHaveBeenCalledTimes(1)
    })
  })
})


describe('Hosted SignUp operation ownership', () => {
  let client: OAuthClient
  const clients: OAuthClient[] = []
  const createClient = () => {
    const next = new OAuthClient({ issuerUri: ISSUER, clientId: 'test-app', redirectUri: 'https://app.test/callback' })
    clients.push(next)
    return next
  }
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
  }
  const grant = { type: 'ACCESS_CODE', registrationAccessCode: 'fixture-proof' } as const
  const tree = (onError = vi.fn()) => createElement(IamUiProvider, {
    children: createElement(SignUp, { registrationGrant: grant, onError }),
  })
  beforeEach(() => {
    client = createClient()
    vi.spyOn(context, 'useIamContext').mockImplementation(() => ({ client, login: vi.fn() } as ReturnType<typeof context.useIamContext>))
    vi.spyOn(client, 'getPublicAuthPolicy').mockResolvedValue(defaultAuthPolicy)
    vi.spyOn(client, 'discover').mockResolvedValue(mockOidcConfig)
    const realWindow = window
    const location = { assign: vi.fn() }
    vi.stubGlobal('window', new Proxy(realWindow, { get: (target, key) => key === 'location' ? location : Reflect.get(target, key) }))
  })
  afterEach(() => {
    clients.splice(0).forEach((next) => next.dispose())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  const invalidate = (reason: 'logout' | 'new-login' | 'dispose') => {
    if (reason === 'logout') client.tokenManager.clear()
    if (reason === 'dispose') client.dispose()
    if (reason === 'new-login') client.tokenManager.store({ access_token: makeTestJwt({ sub: 'new-session' }), refresh_token: 'fixture', token_type: 'Bearer', expires_in: 3600 }, 'DIRECT_AUTH', 'DIRECT_AUTH')
  }
  it.each(['logout', 'new-login', 'dispose'] as const)('suppresses old policy errors after %s', async (reason) => {
    const policy = deferred<PublicAuthPolicyResponse>()
    vi.mocked(client.getPublicAuthPolicy).mockReturnValue(policy.promise)
    const onError = vi.fn()
    render(tree(onError))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    invalidate(reason)
    await act(async () => policy.reject(new Error('old failure')))
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(client.discover).not.toHaveBeenCalled()
  })
  it.each(['logout', 'new-login', 'dispose'] as const)('suppresses old discovery navigation after %s', async (reason) => {
    const discovery = deferred<typeof mockOidcConfig>()
    vi.mocked(client.discover).mockReturnValue(discovery.promise)
    render(tree())
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign up' })))
    invalidate(reason)
    await act(async () => discovery.resolve(mockOidcConfig))
    expect(window.location.assign).not.toHaveBeenCalled()
  })
  it.each(['client replacement', 'new generation'] as const)('discards old work after %s and stale finally cannot clear a new operation', async (change) => {
    const oldPolicy = deferred<PublicAuthPolicyResponse>()
    vi.mocked(client.getPublicAuthPolicy).mockReturnValue(oldPolicy.promise)
    const oldClient = client
    const onError = vi.fn()
    const view = render(tree(onError))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    if (change === 'client replacement') client = createClient()
    else client.tokenManager.clear()
    const newPolicy = deferred<PublicAuthPolicyResponse>()
    const policySpy = change === 'client replacement'
      ? vi.spyOn(client, 'getPublicAuthPolicy').mockReturnValue(newPolicy.promise)
      : vi.mocked(client.getPublicAuthPolicy).mockReturnValue(newPolicy.promise)
    if (change === 'client replacement') vi.spyOn(client, 'discover').mockResolvedValue(mockOidcConfig)
    policySpy.mockClear()
    view.rerender(tree(onError))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await act(async () => oldPolicy.resolve(defaultAuthPolicy))
    expect(oldClient.discover).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Redirecting...' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Redirecting...' }))
    expect(policySpy).toHaveBeenCalledOnce()
    expect(window.location.assign).not.toHaveBeenCalled()
    await act(async () => newPolicy.resolve(defaultAuthPolicy))
    expect(window.location.assign).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
  })
  it('does not show typed session cancellation as an auth error', async () => {
    vi.mocked(client.getPublicAuthPolicy).mockRejectedValue(new SessionInvalidatedError())
    const onError = vi.fn()
    render(tree(onError))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign up' })))
    expect(onError).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign up' }).hasAttribute('disabled')).toBe(false)
  })
})

it('sends an optional username through the public signup action', async () => {
  vi.useFakeTimers()
  const fetchMock = setupFetchMock()
  renderWithProvider(createElement(SignUp, { mode: 'embedded' }))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10)
  })
  fireEvent.change(screen.getByPlaceholderText('Choose a username'), { target: { value: 'new-user' } })
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@user.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'password123' } })
  await act(async () => {
    fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!)
    await vi.advanceTimersByTimeAsync(100)
  })
  const request = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/v1/auth/signup'))
  expect(JSON.parse((request?.[1] as RequestInit).body as string)).toMatchObject({ username: 'new-user' })
  vi.useRealTimers()
})


describe('Hosted SignUp retry with the actual provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(['reject', 'resolve'] as const)(
    'releases the canceled policy slot on %s and permits retry without a forced rerender',
    async (completion) => {
      setupFetchMock()
      let auth!: ReturnType<typeof context.useIamContext>
      function Probe() {
        auth = context.useIamContext()
        return null
      }
      const onError = vi.fn()
      renderWithProvider(
        createElement('div', null,
          createElement(Probe),
          createElement(SignUp, {
            registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'fixture-proof' },
            onError,
          }),
        ),
        { tokenStorage: 'memory' },
      )
      await waitFor(() => expect(auth.isLoaded).toBe(true))
      const realWindow = window
      const location = { assign: vi.fn() }
      vi.stubGlobal('window', new Proxy(realWindow, {
        get: (target, key) => key === 'location' ? location : Reflect.get(target, key),
      }))
      let resolve!: (policy: PublicAuthPolicyResponse) => void
      let reject!: (error: Error) => void
      const pendingPolicy = new Promise<PublicAuthPolicyResponse>((yes, no) => {
        resolve = yes
        reject = no
      })
      const policy = vi.spyOn(auth.client, 'getPublicAuthPolicy')
        .mockReturnValueOnce(pendingPolicy)
        .mockResolvedValue(defaultAuthPolicy)
      fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
      expect(screen.getByRole('button', { name: 'Redirecting...' }).hasAttribute('disabled')).toBe(true)
      await act(async () => {
        await expect(auth.logout({ redirect: false })).rejects.toThrow('Logout requires an authenticated session')
      })
      await act(async () => {
        if (completion === 'reject') reject(new Error('old canceled policy'))
        else resolve(defaultAuthPolicy)
      })
      expect(onError).not.toHaveBeenCalled()
      expect(screen.queryByRole('alert')).toBeNull()
      expect(location.assign).not.toHaveBeenCalled()
      const retry = screen.getByRole('button', { name: 'Sign up' })
      expect(retry.hasAttribute('disabled')).toBe(false)
      await act(async () => fireEvent.click(retry))
      expect(policy).toHaveBeenCalledTimes(2)
      expect(location.assign).toHaveBeenCalledOnce()
      expect(location.assign).toHaveBeenCalledWith(
        buildHostedSignupUrl(ISSUER, 'test-app', { type: 'ACCESS_CODE', registrationAccessCode: 'fixture-proof' }, 'en'),
      )
    },
  )
})
