import { webcrypto } from 'node:crypto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { OAuthClient } from '../core/oauth-client'
import { useAuthFlow, AuthFlowStateError } from './useAuthFlow'
import {
  flowCapabilities,
  flowPolicy,
} from '../core/auth-flow-fixtures.test-support'
import { makeTestJwt, makeTestUser } from '../test-utils'
import type { UseAuthFlowOptions } from './useAuthFlow'
vi.mock('../provider/IamProvider', () => ({
  useIamContext: () => ({ client: currentClient }),
}))
let currentClient: OAuthClient
const tokens = () => ({
  access_token: makeTestJwt(),
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh',
})
const user = {
  email: 'u@example.invalid',
  registrationId: 'registration-1',
  status: 'PENDING_VERIFICATION',
  expiresAt: '2026-10-20T00:00:00Z',
  nextAction: 'VERIFY_EMAIL',
  controlSecret: 'private-control',
}
const response = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
const fetchMock = vi.fn<typeof fetch>()
let created: Record<string, string>
let transactionState:
  | 'AUTHENTICATING'
  | 'MFA_REQUIRED'
  | 'AUTHENTICATED'
  | 'COMPLETED'
let transactionExpiry: string
const transactionView = (state = transactionState) => ({
  transactionId: 'transaction-1',
  expiresAt: transactionExpiry,
  state,
  nextAction: {
    AUTHENTICATING: 'authenticate',
    MFA_REQUIRED: 'mfa',
    AUTHENTICATED: 'complete',
    COMPLETED: 'none',
  }[state],
})
const magicCallback = () =>
  `https://app.test/callback#${new URLSearchParams({ kind: 'AUTH_PROOF', auth_transaction_id: 'transaction-1', method: 'EMAIL_MAGIC_LINK', state: created.state, proof: 'private-link-proof' })}`

async function setup(options: UseAuthFlowOptions = {}) {
  const hook = renderHook(() => useAuthFlow(options))
  await waitFor(() =>
    expect(hook.result.current.state.step).not.toBe('loading'),
  )
  return hook
}
async function identify(
  hook: Awaited<ReturnType<typeof setup>>,
  id = 'u@example.invalid',
) {
  act(() =>
    hook.result.current.actions.continueWithIdentifier({
      kind: id.startsWith('+') ? 'PHONE' : 'EMAIL',
      value: id,
    }),
  )
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  sessionStorage.clear()
  transactionState = 'AUTHENTICATING'
  transactionExpiry = new Date(Date.now() + 600000).toISOString()
  currentClient = new OAuthClient({
    issuerUri: 'https://auth.test.com',
    clientId: 'flow-test',
    redirectUri: 'https://app.test/callback',
  })
  vi.spyOn(currentClient, 'discover').mockResolvedValue({
    issuer: 'https://auth.test.com',
    authorization_endpoint: 'https://auth.test.com/authorize',
    token_endpoint: 'https://auth.test.com/token',
    userinfo_endpoint: 'https://auth.test.com/userinfo',
    jwks_uri: 'https://auth.test.com/jwks',
  })
  vi.spyOn(currentClient, 'getPublicAuthMethods').mockResolvedValue(
    structuredClone(flowCapabilities),
  )
  vi.spyOn(currentClient, 'getPublicAuthPolicy').mockResolvedValue({
    ...flowPolicy,
  })
  fetchMock
    .mockReset()
    .mockImplementation(async (input) =>
      String(input).endsWith('/challenges')
        ? response({
            transactionId: 'transaction-1',
            expiresAt: transactionExpiry,
            challengeExpiresAt: new Date(
              Math.min(Date.now() + 120000, Date.parse(transactionExpiry)),
            ).toISOString(),
            cooldownSeconds: 30,
            nextAction: 'authenticate',
          })
        : response(transactionView('AUTHENTICATED')),
    )
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/me')) {
        const u = makeTestUser()
        u.authenticationContext.clientId = 'flow-test'
        return response(u)
      }
      if (String(input).endsWith('/me/permissions'))
        return response({
          applicationId: 'app-test',
          organizationId: null,
          roles: [],
          permissions: [],
        })
      const url = String(input)
      if (url.endsWith('/auth/transactions')) {
        created = JSON.parse(String(init?.body))
        return response({
          transactionId: 'transaction-1',
          controlSecret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
          expiresAt: transactionExpiry,
          nextAction: 'authenticate',
        })
      }
      if (url.endsWith('/cancel'))
        return response({
          ...transactionView(),
          state: 'CANCELLED',
          nextAction: 'none',
        })
      if (url.endsWith('/complete')) {
        transactionState = 'COMPLETED'
        return response({
          kind: 'authorization_code',
          code: 'one-code',
          state: created.state,
          expiresIn: 120,
        })
      }
      if (url.endsWith('/token')) return response(tokens())
      if (url.endsWith('/transaction-1')) return response(transactionView())
      return fetchMock(input, init)
    },
  )
})
afterEach(() => {
  currentClient.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('public primary transaction flow', () => {
  it('binds duplicate provider labels to exact IDs and refuses name/type aliases', async () => {
    const provider = flowCapabilities.idpProviders[0]!
    const second = { ...provider, id: 'provider-second', availableForSignup: false }
    const blocked = { ...provider, id: 'provider-disabled', enabled: false }
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({ ...flowCapabilities, idpProviders: [provider, second, blocked] })
    const h = await setup()
    expect(h.result.current.state.providers).toEqual([provider, second])
    for (const alias of [provider.displayName, provider.providerType, blocked.id]) {
      await act(async () => {
        await expect(h.result.current.actions.startProvider(alias)).rejects.toThrow()
      })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(response({ authorizationUrl: 'https://provider.test/login', expiresAt: transactionExpiry }))
    await act(async () => { await h.result.current.actions.startProvider(second.id) })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ providerId: second.id })
  })

  it('uses explicit identifier capabilities and keeps PHONE password independent of SMS readiness', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({
      ...flowCapabilities, smsOtpEnabled: false,
      identifierMethods: [{ kind: 'PHONE', methods: ['PASSWORD'] }],
      defaultLogin: { identifierKind: 'PHONE', method: 'PASSWORD' }, defaultIdentifierKind: 'PHONE',
    })
    const h = await setup()
    expect(() => act(() => h.result.current.actions.continueWithIdentifier({ kind: 'EMAIL', value: 'sample@example.invalid' }))).toThrow(/kind is unavailable/)
    act(() => h.result.current.actions.continueWithIdentifier({ kind: 'PHONE', value: '+12025550123' }))
    expect(h.result.current.state).toMatchObject({ step: 'method', methods: ['password'], loginIdentifier: { kind: 'PHONE', value: '+12025550123' } })
    await act(async () => h.result.current.actions.submitPassword('fixture-password'))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.identifier).toEqual({ kind: 'PHONE', value: '+12025550123' })
  })
  it('fails closed on absent capability metadata and retries only through an explicit action', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValueOnce({ ...flowCapabilities, defaultIdentifierKind: null })
    const h = await setup()
    expect(h.result.current.state.step).toBe('unavailable')
    expect(h.result.current.state.error).not.toBeNull()
    await act(async () => h.result.current.actions.retryOptions())
    await waitFor(() => expect(h.result.current.state.step).toBe('identifier'))
    expect(currentClient.getPublicAuthMethods).toHaveBeenCalledTimes(2)
  })
  it('shares duplicate submission, rejects conflicting action, completes exactly once', async () => {
    let finish!: (r: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const onSignInSuccess = vi.fn()
    const h = await setup({ onSignInSuccess })
    await identify(h)
    let first!: Promise<void>
    let duplicate!: Promise<void>
    let conflict!: Promise<void>
    act(() => {
      first = h.result.current.actions.submitPassword('p')
      duplicate = h.result.current.actions.submitPassword('p')
      conflict = h.result.current.actions.sendCode()
    })
    expect(duplicate).toBe(first)
    await expect(conflict).rejects.toBeInstanceOf(AuthFlowStateError)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    await act(async () => {
      finish(response(transactionView('AUTHENTICATED')))
      await first
    })
    expect(onSignInSuccess).toHaveBeenCalledOnce()
    expect(h.result.current.state.step).toBe('success')
    expect(currentClient.tokenManager.getAuthenticationProvenance()).toBe(
      'OAUTH_AUTHORIZATION_CODE',
    )
    expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
  })
  it.each([
    'cancel',
    'back',
    'intent',
    'method',
    'unmount',
    'logout',
    'dispose',
    'new-login',
  ] as const)('rejects old completion after %s', async (kind) => {
    let finish!: (r: Response) => void
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const onSignInSuccess = vi.fn(),
      onError = vi.fn()
    const h = await setup({ onSignInSuccess, onError })
    await identify(h)
    let promise!: Promise<void>
    act(() => {
      promise = h.result.current.actions.submitPassword('p')
    })
    const rejected = expect(promise).rejects.toBeInstanceOf(
      SessionInvalidatedError,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    act(() => {
      if (kind === 'unmount') h.unmount()
      else if (kind === 'logout') currentClient.tokenManager.clear()
      else if (kind === 'dispose') currentClient.dispose()
      else if (kind === 'new-login')
        currentClient.tokenManager.store(tokens(), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
      else if (kind === 'intent') h.result.current.actions.setIntent('sign-up')
      else if (kind === 'method')
        h.result.current.actions.selectMethod('email_otp')
      else h.result.current.actions[kind]()
    })
    await act(async () => {
      finish(response(transactionView('AUTHENTICATED')))
      await rejected
    })
    expect(onSignInSuccess).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    if (kind !== 'unmount') expect(h.result.current.state.pending).toBeNull()
    expect(currentClient.tokenManager.getAccessToken() !== null).toBe(
      kind === 'new-login',
    )
  })
  it('does not store invalid expiry final OTP responses or treat repeated challenges as tokens', async () => {
    const h = await setup()
    await identify(h)
    act(() => h.result.current.actions.selectMethod('email_otp'))
    await act(async () => {
      await h.result.current.actions.sendCode()
    })
    fetchMock.mockResolvedValue(
      response({
        access_token: 'fixture-bytes',
        token_type: 'Bearer',
        expires_in: 0,
      }),
    )
    await act(async () => {
      await expect(
        h.result.current.actions.verifyCode('123456'),
      ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_BINDING_MISMATCH' })
    })
    expect(currentClient.getAccessToken()).toBeNull()
    fetchMock.mockResolvedValue(
      response({
        mfa_required: true,
        mfa_token: 'unexpected-proof',
        mfa_methods: ['totp'],
      }),
    )
    await act(async () => {
      await expect(
        h.result.current.actions.verifyCode('123456'),
      ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_BINDING_MISMATCH' })
    })
    expect(currentClient.getAccessToken()).toBeNull()
  })
  it('continues transaction MFA with recovery proof and keeps control private', async () => {
    fetchMock
      .mockResolvedValueOnce(response(transactionView('MFA_REQUIRED')))
      .mockResolvedValueOnce(response({ error: 'UNAUTHORIZED' }, 401))
      .mockResolvedValueOnce(response(transactionView('AUTHENTICATED')))
    const onSignInSuccess = vi.fn(),
      onError = vi.fn()
    const h = await setup({ onSignInSuccess, onError })
    await identify(h)
    await act(async () => {
      await h.result.current.actions.submitPassword('p')
    })
    expect(h.result.current.state.step).toBe('mfa')
    expect(JSON.stringify(h.result.current.state)).not.toContain(
      'private-proof',
    )
    expect(currentClient.tokenManager.getAccessToken()).toBeNull()
    await act(async () => {
      await expect(
        h.result.current.actions.verifyMfa('wrong'),
      ).rejects.toMatchObject({ status: 401 })
    })
    expect(h.result.current.state.step).toBe('mfa')
    await act(async () => {
      await h.result.current.actions.verifyMfa('recovery-code', 'RECOVERY_CODE')
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      method: 'RECOVERY_CODE',
      code: 'recovery-code',
    })
    expect(onSignInSuccess).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
  })
  it.each(['email_otp', 'sms'] as const)(
    'sends/verifies %s with authoritative identifier context and blocks cooldown',
    async (method) => {
      const h = await setup()
      await identify(h, method === 'sms' ? '+15555550123' : 'u@example.invalid')
      act(() => h.result.current.actions.selectMethod(method))
      await act(async () => {
        await h.result.current.actions.sendCode()
      })
      await act(async () => {
        await expect(
          h.result.current.actions.sendCode(),
        ).rejects.toBeInstanceOf(AuthFlowStateError)
      })
      await act(async () => {
        await h.result.current.actions.verifyCode('123456')
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][0]).toContain(
        '/transactions/transaction-1/authenticate',
      )
    },
  )
  it.each([
    'send-code',
    'magic-link',
    'sign-up',
    'resend-verification',
    'provider',
  ] as const)(
    'invalidates a pending %s without stale state or callbacks',
    async (name) => {
      const onSignUpSuccess = vi.fn(),
        onError = vi.fn()
      const h = await setup({
        initialIntent:
          name === 'sign-up' || name === 'resend-verification'
            ? 'sign-up'
            : 'sign-in',
        onSignUpSuccess,
        onError,
      })
      if (name === 'resend-verification') {
        fetchMock.mockResolvedValue(response(user))
        await act(async () => {
          await h.result.current.actions.signUp({
            identifier: { kind: 'EMAIL', value: user.email },
            password: 'ValidPassword123!',
          })
        })
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
        onSignUpSuccess.mockClear()
        fetchMock.mockClear()
      }
      if (name === 'send-code' || name === 'magic-link') {
        await identify(h)
        act(() =>
          h.result.current.actions.selectMethod(
            name === 'send-code' ? 'email_otp' : 'magic_link',
          ),
        )
      }
      let finish!: (response: Response) => void
      fetchMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      let pending!: Promise<unknown>
      act(() => {
        const a = h.result.current.actions
        pending =
          name === 'send-code'
            ? a.sendCode()
            : name === 'magic-link'
              ? a.sendMagicLink()
              : name === 'sign-up'
                ? a.signUp({
                    identifier: { kind: 'EMAIL', value: user.email },
                    password: 'ValidPassword123!',
                  })
                : name === 'resend-verification'
                  ? a.resendVerification()
                  : a.startProvider('provider')
      })
      const rejected = expect(pending).rejects.toBeInstanceOf(
        SessionInvalidatedError,
      )
      await waitFor(() => expect(finish).toBeDefined())
      await act(async () => {
        await h.result.current.actions.cancel()
      })
      await act(async () => {
        finish(
          response(
            name === 'sign-up'
              ? user
              : name === 'provider'
                ? { authorizationUrl: 'https://provider.example/authorize' }
                : {},
          ),
        )
        await rejected
      })
      expect(h.result.current.state.pending).toBeNull()
      expect(h.result.current.state.error).toBeNull()
      expect(h.result.current.state.retryAfterSeconds).toBe(0)
      expect(onSignUpSuccess).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
    },
  )
  it('sends delivered provider registration access-code wire', async () => {
    const h=await setup({initialIntent:'sign-up',registrationGrant:{type:'ACCESS_CODE',registrationAccessCode:'signup-gate'}})
    fetchMock.mockResolvedValueOnce(response({authorizationUrl:'https://provider.test/login',expiresAt:transactionExpiry}))
    await act(async()=>{expect(await h.result.current.actions.startProvider('provider')).toBe('https://provider.test/login')})
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({providerId:'provider',registrationAccessCode:'signup-gate'})
  })
  it('uses the transaction provider route and restores original control for MFA continuation',async()=>{
    const h=await setup()
    fetchMock.mockResolvedValueOnce(response({authorizationUrl:'https://provider.test/login',expiresAt:transactionExpiry}))
    await act(async()=>{expect(await h.result.current.actions.startProvider('provider')).toBe('https://provider.test/login')})
    expect(String(fetchMock.mock.calls[0][0])).toContain('/transactions/transaction-1/authorize')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({providerId:'provider'})
    h.unmount()
    transactionState='MFA_REQUIRED'
    const resumed=await setup()
    const callback='https://app.test/callback?'+new URLSearchParams({kind:'AUTH_CONTINUATION',auth_transaction_id:'transaction-1',state:created.state})
    await act(async()=>{await resumed.result.current.actions.resumeProviderCallback(callback)})
    expect(resumed.result.current.state.step).toBe('mfa')
    expect(currentClient.getAccessToken()).toBeNull()
    fetchMock.mockResolvedValueOnce(response(transactionView('AUTHENTICATED')))
    await act(async()=>{await resumed.result.current.actions.verifyMfa('recovery','RECOVERY_CODE')})
    expect(resumed.result.current.state.step).toBe('success')
  })
  it('completes original-tab magic-link proof through the transaction', async () => {
    const h = await setup()
    await identify(h)
    act(() => h.result.current.actions.selectMethod('magic_link'))
    await act(async () => {
      await h.result.current.actions.sendMagicLink()
    })
    await act(async () => {
      await h.result.current.actions.completeMagicLink(magicCallback())
    })
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/transactions/transaction-1/authenticate',
    )
    expect(h.result.current.state.step).toBe('success')
  })
  it('signup uses policy/grants and waits for verification without User/session', async () => {
    fetchMock.mockResolvedValue(response(user))
    const onSignUpSuccess = vi.fn()
    const h = await setup({ initialIntent: 'sign-up', onSignUpSuccess })
    await act(async () => {
      await expect(
        h.result.current.actions.signUp({
          identifier: { kind: 'EMAIL', value: user.email },
          password: 'weak',
        }),
      ).rejects.toMatchObject({ code: 'PASSWORD_POLICY_VIOLATION' })
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => {
      await h.result.current.actions.signUp({
        identifier: { kind: 'EMAIL', value: user.email },
        password: 'ValidPassword123!',
      })
    })
    expect(h.result.current.state).toMatchObject({
      step: 'verification',
      registration: { status: 'PENDING_VERIFICATION' },
    })
    expect(onSignUpSuccess).not.toHaveBeenCalled()
    expect(currentClient.tokenManager.getAccessToken()).toBeNull()
  })
  it('retains live registration control after uncertain cancel and blocks reset until reconciliation', async () => {
    const live = { ...user, expiresAt: new Date(Date.now() + 600000).toISOString() }
    fetchMock.mockImplementation(async () => response(live))
    const h = await setup({ initialIntent: 'sign-up' })
    await act(async () => h.result.current.actions.signUp({
      identifier: { kind: 'EMAIL', value: live.email }, password: 'ValidPassword123!',
    }))
    vi.spyOn(currentClient.identity, 'registrationAction').mockRejectedValueOnce(new TypeError('fixture response lost'))
    await act(async () => { await expect(h.result.current.actions.cancelRegistration()).rejects.toThrow() })
    expect(h.result.current.state).toMatchObject({ step: 'verification', registrationCancelUnconfirmed: true, registration: { registrationId: live.registrationId } })
    await act(async () => { await expect(h.result.current.actions.reset()).rejects.toThrow(/explicitly cancel/) })
    expect(h.result.current.state.step).toBe('verification')
    await act(async () => h.result.current.actions.resumeRegistration(live.registrationId))
    expect(h.result.current.state.registrationCancelUnconfirmed).toBe(false)
    const last = fetchMock.mock.calls.at(-1)!
    expect(String(last[0])).toContain(`/signup/operations/${live.registrationId}`)
    expect(new Headers(last[1]?.headers).get('Registration-Control')).toBe(live.controlSecret)
    expect(JSON.stringify(h.result.current.state)).not.toContain(live.controlSecret)
  })
  it('applies the actual initial registration resend deadline without a synthetic cooldown', async () => {
    const deadline = new Date(Date.now() + 10000).toISOString()
    fetchMock.mockImplementation(async () => response({ ...user, expiresAt: new Date(Date.now() + 600000).toISOString(), nextChallengeAt: deadline }))
    const h = await setup({ initialIntent: 'sign-up' })
    await act(async () => h.result.current.actions.signUp({ identifier: { kind: 'EMAIL', value: user.email }, password: 'ValidPassword123!' }))
    expect(h.result.current.state.verificationResendDeadline).toBe(Date.parse(deadline))
    expect(h.result.current.state.retryAfterSeconds).toBeGreaterThan(0)
    expect(h.result.current.state.retryAfterSeconds).toBeLessThanOrEqual(10)
    await act(async () => { await expect(h.result.current.actions.resendVerification()).rejects.toThrow(/Wait/) })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('rejects conflict between option and action grant, and disabled registration', async () => {
    const h = await setup({
      initialIntent: 'sign-up',
      registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'a' },
    })
    await act(async () => {
      await expect(
        h.result.current.actions.signUp({
          identifier: { kind: 'EMAIL', value: user.email },
          password: 'ValidPassword123!',
          registrationGrant: {
            type: 'ACCESS_CODE',
            registrationAccessCode: 'b',
          },
        }),
      ).rejects.toMatchObject({ code: 'REGISTRATION_GRANT_INVALID' })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('filters unavailable signup providers and preserves safe retry metadata', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({
      ...flowCapabilities,
      idpProviders: flowCapabilities.idpProviders.map((x) => ({
        ...x,
        availableForSignup: false,
      })),
    })
    const h = await setup({ initialIntent: 'sign-up' })
    expect(h.result.current.state.providers).toHaveLength(0)
    await act(async () => {
      await h.result.current.actions.setIntent('sign-in')
    })
    await identify(h)
    fetchMock.mockResolvedValue(
      response({ error: 'RATE_LIMITED', message: 'try later' }, 429, {
        'Retry-After': '7',
      }),
    )
    await act(async () => {
      await expect(
        h.result.current.actions.submitPassword('p'),
      ).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterSeconds: 7,
      })
    })
    expect(h.result.current.state.retryAfterSeconds).toBe(7)
  })
})

describe('AC-01 public registration proof policy', () => {
  it.each([
    'open-none',
    'open-code',
    'required-missing',
    'disallowed',
    'disabled',
    'conflict',
  ] as const)('enforces %s before transport', async (kind) => {
    vi.mocked(currentClient.getPublicAuthPolicy).mockResolvedValue({
      ...flowPolicy,
      signupMode:
        kind === 'required-missing'
          ? 'INVITE_REQUIRED'
          : kind === 'disabled'
            ? 'DISABLED'
            : 'OPEN',
      allowedRegistrationGrantTypes:
        kind === 'disallowed' ? ['EMAIL_LINK'] : ['ACCESS_CODE', 'EMAIL_LINK'],
    })
    const h = await setup({
      initialIntent: 'sign-up',
      ...(kind === 'conflict'
        ? {
            registrationGrant: {
              type: 'EMAIL_LINK',
              registrationGrantToken: 'proof',
            } as const,
          }
        : {}),
    })
    fetchMock.mockResolvedValue(response(user))
    await act(async () => {
      const promise = h.result.current.actions.signUp({
        identifier: { kind: 'EMAIL', value: user.email },
        password: 'ValidPassword123!',
        ...(kind === 'open-none' || kind === 'required-missing'
          ? {}
          : {
              registrationGrant: {
                type: 'ACCESS_CODE',
                registrationAccessCode: 'code',
              } as const,
            }),
      })
      if (kind === 'open-none' || kind === 'open-code') await promise
      else
        await expect(promise).rejects.toMatchObject({
          code:
            kind === 'required-missing'
              ? 'REGISTRATION_GRANT_REQUIRED'
              : kind === 'disallowed'
                ? 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED'
                : kind === 'conflict'
                  ? 'REGISTRATION_GRANT_INVALID'
                  : 'AUTH_FLOW_STATE_INVALID',
        })
    })
    expect(fetchMock).toHaveBeenCalledTimes(
      kind === 'open-none' || kind === 'open-code' ? 1 : 0,
    )
  })
})

describe('Custom flow required session views', () => {
  it.each([
    'complete',
    'cancel',
    'unmount',
    'failure',
    'unauthorized',
  ] as const)(
    'holds success during views and handles %s explicitly',
    async (mode) => {
      let release!: (response: Response) => void
      const base = globalThis.fetch
      vi.stubGlobal(
        'fetch',
        async (input: RequestInfo | URL, init?: RequestInit) =>
          String(input).endsWith('/me')
            ? new Promise<Response>((done) => {
                release = done
              })
            : base(input, init),
      )
      const onSignInSuccess = vi.fn(),
        onError = vi.fn()
      const h = await setup({ onSignInSuccess, onError })
      await identify(h)
      let pending!: Promise<void>
      act(() => {
        pending = h.result.current.actions.submitPassword('p')
      })
      await waitFor(() => expect(release).toBeDefined())
      expect(onSignInSuccess).not.toHaveBeenCalled()
      expect(currentClient.isAuthenticated()).toBe(false)
      const u = makeTestUser()
      u.authenticationContext.clientId = 'flow-test'
      if (mode === 'cancel')
        await act(async () => {
          await h.result.current.actions.cancel()
        })
      if (mode === 'unmount') h.unmount()
      const outcome =
        mode === 'cancel' || mode === 'unmount'
          ? expect(pending).rejects.toMatchObject({
              code: 'SESSION_INVALIDATED',
            })
          : mode === 'failure' || mode === 'unauthorized'
            ? expect(pending).rejects.toMatchObject({
                status: mode === 'unauthorized' ? 401 : 503,
              })
            : expect(pending).resolves.toBeUndefined()
      await act(async () => {
        release(
          response(
            u,
            mode === 'unauthorized' ? 401 : mode === 'failure' ? 503 : 200,
          ),
        )
        await outcome
      })
      expect(onSignInSuccess).toHaveBeenCalledTimes(mode === 'complete' ? 1 : 0)
      expect(onError).toHaveBeenCalledTimes(
        mode === 'failure' || mode === 'unauthorized' ? 1 : 0,
      )
      if (mode === 'failure' || mode === 'unauthorized')
        expect(currentClient.isAuthenticated()).toBe(false)
    },
  )
})

describe('transaction recovery and cancellation boundaries', () => {
  it('recovers lost completion with status and the original key without resending primary proof', async () => {
    const base = globalThis.fetch
    const keys: string[] = []
    let lost = true
    vi.stubGlobal(
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/complete')) {
          keys.push(new Headers(init?.headers).get('Idempotency-Key')!)
          if (lost) {
            lost = false
            transactionState = 'COMPLETED'
            throw new TypeError('lost response')
          }
        }
        return base(input, init)
      },
    )
    const onSignInSuccess = vi.fn()
    const h = await setup({ onSignInSuccess })
    await identify(h)
    await act(async () => {
      await expect(
        h.result.current.actions.submitPassword('p'),
      ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_UNCERTAIN' })
    })
    expect(h.result.current.state.completionPending).toBe(true)
    expect(currentClient.getAccessToken()).toBeNull()
    await act(async () => {
      await h.result.current.actions.retryCompletion()
    })
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).endsWith('/authenticate'),
      ),
    ).toHaveLength(1)
    expect(h.result.current.state.step).toBe('success')
    expect(onSignInSuccess).toHaveBeenCalledOnce()
  })
  it('makes cancellation refusal observable while immediately discarding local authority', async () => {
    const h = await setup()
    await identify(h)
    act(() => h.result.current.actions.selectMethod('email_otp'))
    await act(async () => {
      await h.result.current.actions.sendCode()
    })
    const base = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith('/cancel')
        ? Promise.resolve(response({ error: 'CANCEL_DENIED' }, 409))
        : base(input, init),
    )
    await act(async () => {
      await expect(h.result.current.actions.cancel()).rejects.toMatchObject({
        code: 'CANCEL_DENIED',
      })
    })
    expect(h.result.current.state).toMatchObject({
      step: 'identifier',
      cancellationUnconfirmed: true,
    })
    expect(currentClient.getAccessToken()).toBeNull()
  })
  it('expires at the original parent deadline and never creates a replacement implicitly', async () => {
    transactionExpiry = new Date(Date.now() + 200).toISOString()
    const h = await setup()
    await identify(h)
    act(() => h.result.current.actions.selectMethod('email_otp'))
    await act(async () => {
      await h.result.current.actions.sendCode()
    })
    await waitFor(() =>
      expect(h.result.current.state.error).toMatchObject({
        code: 'AUTH_TRANSACTION_EXPIRED',
      }),
    )
    expect(h.result.current.state.step).toBe('identifier')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(currentClient.getAccessToken()).toBeNull()
  })
  it('rejects a saved navigation flow after switching to an authenticated account', async () => {
    const tx = await currentClient.beginAuthentication()
    tx.persistForNavigation()
    currentClient.tokenManager.store(
      tokens(),
      'OAUTH_AUTHORIZATION_CODE',
      'OAUTH_TOKEN_ENDPOINT',
    )
    await expect(
      currentClient.resumeMagicLink(magicCallback()),
    ).rejects.toThrow('signed-in account')
    expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
  })
})

describe('auth experience producer contract', () => {
  it('selects the actual ordered method and preserves the typed identifier through method switches', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({ ...flowCapabilities,
      identifierMethods: [{ kind: 'PHONE', methods: ['SMS_OTP', 'PASSWORD'] }, { kind: 'EMAIL', methods: ['PASSWORD'] }],
      defaultIdentifierKind: 'PHONE', defaultLogin: { identifierKind: 'PHONE', method: 'SMS_OTP' },
    })
    const h = await setup()
    act(() => h.result.current.actions.continueWithIdentifier({ kind: 'PHONE', value: '+8613800138000' }))
    expect(h.result.current.state).toMatchObject({ method: 'sms', methods: ['sms', 'password'], phase: 'credentials' })
    act(() => h.result.current.actions.selectMethod('password'))
    expect(h.result.current.state).toMatchObject({ loginIdentifier: { kind: 'PHONE', value: '+8613800138000' }, method: 'password' })
  })
  it('enters code phase only after the successful challenge and clears it on method changes', async () => {
    const h = await setup(); await identify(h)
    act(() => h.result.current.actions.selectMethod('email_otp'))
    fetchMock.mockRejectedValueOnce(new Error('fixture network failure'))
    await act(async () => { await expect(h.result.current.actions.sendCode()).rejects.toThrow() })
    expect(h.result.current.state).toMatchObject({ phase: 'credentials', codeSent: false })
    await act(async () => h.result.current.actions.sendCode())
    expect(h.result.current.state).toMatchObject({ phase: 'code', codeSent: true, retryAfterSeconds: 30 })
    act(() => h.result.current.actions.selectMethod('password'))
    expect(h.result.current.state).toMatchObject({ phase: 'credentials', codeSent: false, challengeExpiresAt: null })
  })
  it('rejects disabled EMAIL and PHONE signup before transport, and sends USERNAME without an email', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({ ...flowCapabilities, allowedSignupIdentifierKinds: ['USERNAME'] })
    fetchMock.mockResolvedValue(response({ ...user, status: 'COMPLETED', nextAction: 'LOGIN' }))
    const h = await setup({ initialIntent: 'sign-up' })
    for (const identifier of [{ kind: 'EMAIL', value: 'member@example.invalid' }, { kind: 'PHONE', value: '+8613800138000' }] as const) {
      await act(async () => { await expect(h.result.current.actions.signUp({ identifier, password: 'Fixture_123!' })).rejects.toThrow() })
    }
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => h.result.current.actions.signUp({ identifier: { kind: 'USERNAME', value: 'member' }, password: 'Fixture_123!' }))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.identifier).toEqual({ kind: 'USERNAME', value: 'member' })
    expect(body).not.toHaveProperty('email')
  })
})

it('waits for old challenge cancellation before a different credential may create a transaction', async () => {
  const h = await setup(); await identify(h)
  act(() => h.result.current.actions.selectMethod('email_otp'))
  await act(async () => h.result.current.actions.sendCode())
  const original = globalThis.fetch
  let finish!: () => void
  let cancellationStarted = false
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/cancel')) { cancellationStarted = true; await new Promise<void>(resolve => { finish = resolve }) }
    return original(input, init)
  })
  act(() => h.result.current.actions.selectMethod('password'))
  const before = fetchMock.mock.calls.length
  let pending!: Promise<void>
  act(() => { pending = h.result.current.actions.submitPassword('{{SECRET_vw9kk7bz}}') })
  await act(async () => { await Promise.resolve() })
  expect(cancellationStarted).toBe(true)
  expect(fetchMock.mock.calls.length).toBe(before)
  await act(async () => { finish(); await pending })
  expect(h.result.current.state.step).toBe('success')
})

it('fails closed after a credential-switch cancellation refusal and exposes explicit retry', async () => {
  const h = await setup()
  await identify(h)
  act(() => h.result.current.actions.selectMethod('email_otp'))
  await act(async () => h.result.current.actions.sendCode())
  const original = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/cancel')
      ? response({ error: 'TEMPORARILY_UNAVAILABLE' }, 503)
      : original(input, init),
  )
  act(() => h.result.current.actions.selectMethod('password'))
  await waitFor(() => expect(h.result.current.state).toMatchObject({
    step: 'unavailable', cancellationUnconfirmed: true,
  }))
  const before = fetchMock.mock.calls.length
  await act(async () => {
    await expect(h.result.current.actions.submitPassword('test-only-password')).rejects.toThrow()
  })
  expect(fetchMock.mock.calls.length).toBe(before)
  await act(async () => h.result.current.actions.retryOptions())
  await waitFor(() => expect(h.result.current.state.step).toBe('identifier'))
  expect(h.result.current.state.cancellationUnconfirmed).toBe(false)
})
