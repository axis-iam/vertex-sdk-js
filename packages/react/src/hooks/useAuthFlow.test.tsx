import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { OAuthClient } from '../core/oauth-client'
import * as pkce from '../core/pkce'
import { useAuthFlow, AuthFlowStateError } from './useAuthFlow'
import { flowCapabilities, flowPolicy } from '../core/auth-flow-fixtures.test-support'
import { makeTestJwt } from '../test-utils'
import type { UseAuthFlowOptions } from './useAuthFlow'
vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client: currentClient }) }))
let currentClient: OAuthClient
const tokens = () => ({
  access_token: makeTestJwt(),
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh',
})
const user = { id: 'u', email: 'u@example.invalid', status: 'ACTIVE', emailVerified: false, roles: [] }
const response = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const fetchMock = vi.fn<typeof fetch>()
async function setup(options: UseAuthFlowOptions = {}) {
  const hook = renderHook(() => useAuthFlow(options))
  await waitFor(() => expect(hook.result.current.state.step).not.toBe('loading'))
  return hook
}
async function identify(hook: Awaited<ReturnType<typeof setup>>, id = 'u@example.invalid') {
  act(() => hook.result.current.actions.continueWithIdentifier(id))
}
beforeEach(() => {
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
  vi.spyOn(currentClient, 'getPublicAuthMethods').mockResolvedValue(structuredClone(flowCapabilities))
  vi.spyOn(currentClient, 'getPublicAuthPolicy').mockResolvedValue({ ...flowPolicy })
  fetchMock.mockReset().mockResolvedValue(response(tokens()))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  currentClient.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('public Direct Auth flow', () => {
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
      finish(response(tokens()))
      await first
    })
    expect(onSignInSuccess).toHaveBeenCalledOnce()
    expect(h.result.current.state.step).toBe('success')
    expect(currentClient.tokenManager.getAuthenticationProvenance()).toBe('DIRECT_AUTH')
    expect(sessionStorage.getItem('axis_iam_session')).toBeNull()
  })
  it.each(['cancel', 'back', 'intent', 'method', 'unmount', 'logout', 'dispose', 'new-login'] as const)(
    'rejects old completion after %s',
    async (kind) => {
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
      const rejected = expect(promise).rejects.toBeInstanceOf(SessionInvalidatedError)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
      act(() => {
        if (kind === 'unmount') h.unmount()
        else if (kind === 'logout') currentClient.tokenManager.clear()
        else if (kind === 'dispose') currentClient.dispose()
        else if (kind === 'new-login')
          currentClient.tokenManager.store(tokens(), 'DIRECT_AUTH', 'DIRECT_AUTH')
        else if (kind === 'intent') h.result.current.actions.setIntent('sign-up')
        else if (kind === 'method') h.result.current.actions.selectMethod('email_otp')
        else h.result.current.actions[kind]()
      })
      await act(async () => {
        finish(response(tokens()))
        await rejected
      })
      expect(onSignInSuccess).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      if (kind !== 'unmount') expect(h.result.current.state.pending).toBeNull()
      expect(currentClient.tokenManager.getAccessToken() !== null).toBe(kind === 'new-login')
    },
  )
  it('does not store malformed final OTP responses or treat repeated challenges as tokens', async () => {
    const h=await setup();await identify(h);act(()=>h.result.current.actions.selectMethod('email_otp'))
    await act(async()=>{await h.result.current.actions.sendCode()})
    fetchMock.mockResolvedValue(response({access_token:'malformed',token_type:'Bearer',expires_in:3600}))
    await act(async()=>{await expect(h.result.current.actions.verifyCode('123456')).rejects.toMatchObject({name:'IamConfigurationError'})})
    expect(currentClient.getAccessToken()).toBeNull()
    fetchMock.mockResolvedValue(response({mfa_required:true,mfa_token:'unexpected-proof',mfa_methods:['totp']}))
    await act(async()=>{await expect(h.result.current.actions.verifyCode('123456')).rejects.toMatchObject({name:'IamConfigurationError'})})
    expect(currentClient.getAccessToken()).toBeNull()
  })
  it('continues private MFA with camelCase proof and does not expose it in state', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({ mfa_required: true, mfa_token: 'private-proof', mfa_methods: ['totp'] }),
      )
      .mockResolvedValueOnce(response({ error: 'UNAUTHORIZED' }, 401))
      .mockResolvedValueOnce(response(tokens()))
    const onSignInSuccess = vi.fn(),
      onError = vi.fn()
    const h = await setup({ onSignInSuccess, onError })
    await identify(h)
    await act(async () => {
      await h.result.current.actions.submitPassword('p')
    })
    expect(h.result.current.state.step).toBe('mfa')
    expect(JSON.stringify(h.result.current.state)).not.toContain('private-proof')
    expect(currentClient.tokenManager.getAccessToken()).toBeNull()
    await act(async () => {
      await expect(h.result.current.actions.verifyMfa('wrong')).rejects.toMatchObject({ status: 401 })
    })
    expect(h.result.current.state.step).toBe('mfa')
    await act(async () => {
      await h.result.current.actions.verifyMfa('123456')
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      mfaToken: 'private-proof',
      code: '123456',
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
        await expect(h.result.current.actions.sendCode()).rejects.toBeInstanceOf(AuthFlowStateError)
      })
      await act(async () => {
        await h.result.current.actions.verifyCode('123456')
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[1][0]).toContain(method === 'sms' ? '/sms/verify' : '/email-otp/verify')
    },
  )
  it.each(['send-code', 'magic-link', 'sign-up', 'resend-verification', 'provider'] as const)(
    'invalidates a pending %s without stale state or callbacks',
    async (name) => {
      const onSignUpSuccess = vi.fn(),
        onError = vi.fn()
      const h = await setup({
        initialIntent: name === 'sign-up' || name === 'resend-verification' ? 'sign-up' : 'sign-in',
        onSignUpSuccess,
        onError,
      })
      if (name === 'resend-verification') {
        fetchMock.mockResolvedValue(response({ ...user, status: 'PENDING' }))
        await act(async () => {
          await h.result.current.actions.signUp({ email: user.email, password: 'ValidPassword123!' })
        })
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
        onSignUpSuccess.mockClear()
        fetchMock.mockClear()
      }
      if (name === 'send-code' || name === 'magic-link') {
        await identify(h)
        act(() => h.result.current.actions.selectMethod(name === 'send-code' ? 'email_otp' : 'magic_link'))
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
                ? a.signUp({ email: user.email, password: 'ValidPassword123!' })
                : name === 'resend-verification'
                  ? a.resendVerification()
                  : a.startProvider('provider')
      })
      const rejected = expect(pending).rejects.toBeInstanceOf(SessionInvalidatedError)
      await waitFor(() => expect(finish).toBeDefined())
      act(() => h.result.current.actions.cancel())
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
  it('cancels provider PKCE generation before old storage or navigation can escape', async () => {
    let finish!: (value: pkce.PKCEPair) => void
    vi.spyOn(pkce, 'generatePKCEPair').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const onError = vi.fn()
    const h = await setup({ onError })
    let pending!: Promise<string>
    act(() => {
      pending = h.result.current.actions.startProvider('provider')
    })
    const rejected = expect(pending).rejects.toBeInstanceOf(SessionInvalidatedError)
    await waitFor(() => expect(finish).toBeDefined())
    act(() => h.result.current.actions.cancel())
    sessionStorage.setItem('iam_oauth_state', 'new-state')
    sessionStorage.setItem('iam_pkce_verifier', 'new-verifier')
    await act(async () => {
      finish({ codeVerifier: 'old-verifier', codeChallenge: 'old-challenge' })
      await rejected
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('iam_oauth_state')).toBe('new-state')
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBe('new-verifier')
  })
  it('uses signup provider availability independently from login availability', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({
      ...flowCapabilities,
      idpProviders: [
        { ...flowCapabilities.idpProviders[0], availableForLogin: false, availableForSignup: true },
      ],
    })
    const h = await setup({ initialIntent: 'sign-up' })
    expect(h.result.current.state.providers).toHaveLength(1)
    fetchMock.mockResolvedValue(response({ authorizationUrl: 'https://provider.example/authorize' }))
    await act(async () => {
      expect(await h.result.current.actions.startProvider('provider')).toBe(
        'https://provider.example/authorize',
      )
    })
  })
  it('completes existing magic-link producer from public action', async () => {
    const h = await setup()
    await identify(h)
    act(() => h.result.current.actions.selectMethod('magic_link'))
    await act(async () => {
      await h.result.current.actions.sendMagicLink()
    })
    await act(async () => {
      await h.result.current.actions.completeMagicLink('private-link-proof')
    })
    expect(fetchMock.mock.calls[1][0]).toContain('/magic-link/verify')
    expect(h.result.current.state.step).toBe('success')
  })
  it('signup uses policy/grants, emits profile success without token authentication', async () => {
    fetchMock.mockResolvedValue(response({ ...user, status: 'PENDING' }))
    const onSignUpSuccess = vi.fn()
    const h = await setup({ initialIntent: 'sign-up', onSignUpSuccess })
    await act(async () => {
      await expect(
        h.result.current.actions.signUp({ email: user.email, password: 'weak' }),
      ).rejects.toMatchObject({ code: 'PASSWORD_POLICY_VIOLATION' })
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => {
      await h.result.current.actions.signUp({ email: user.email, password: 'ValidPassword123!' })
    })
    expect(h.result.current.state).toMatchObject({
      step: 'verification',
      result: { verificationMode: 'REQUIRED' },
      retryAfterSeconds: 30,
    })
    expect(onSignUpSuccess).toHaveBeenCalledOnce()
    expect(currentClient.tokenManager.getAccessToken()).toBeNull()
  })
  it('rejects conflict between option and action grant, and disabled registration', async () => {
    const h = await setup({
      initialIntent: 'sign-up',
      registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'a' },
    })
    await act(async () => {
      await expect(
        h.result.current.actions.signUp({
          email: user.email,
          password: 'ValidPassword123!',
          registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'b' },
        }),
      ).rejects.toMatchObject({ code: 'REGISTRATION_GRANT_INVALID' })
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('filters unavailable signup providers and preserves safe retry metadata', async () => {
    vi.mocked(currentClient.getPublicAuthMethods).mockResolvedValue({
      ...flowCapabilities,
      idpProviders: flowCapabilities.idpProviders.map((x) => ({ ...x, availableForSignup: false })),
    })
    const h = await setup({ initialIntent: 'sign-up' })
    expect(h.result.current.state.providers).toHaveLength(0)
    act(() => h.result.current.actions.setIntent('sign-in'))
    await identify(h)
    fetchMock.mockResolvedValue(
      response({ error: 'RATE_LIMITED', message: 'try later' }, 429, { 'Retry-After': '7' }),
    )
    await act(async () => {
      await expect(h.result.current.actions.submitPassword('p')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        retryAfterSeconds: 7,
      })
    })
    expect(h.result.current.state.retryAfterSeconds).toBe(7)
  })
})

describe('AC-01 public registration proof policy', () => {
  it.each(['open-none','open-code','required-missing','disallowed','disabled','conflict'] as const)('enforces %s before transport', async kind => {
    vi.mocked(currentClient.getPublicAuthPolicy).mockResolvedValue({...flowPolicy,
      signupMode: kind==='required-missing'?'INVITE_REQUIRED':kind==='disabled'?'DISABLED':'OPEN',
      allowedRegistrationGrantTypes:kind==='disallowed'?['EMAIL_LINK']:['ACCESS_CODE','EMAIL_LINK'],
    })
    const h=await setup({initialIntent:'sign-up',...(kind==='conflict'?{registrationGrant:{type:'EMAIL_LINK',registrationGrantToken:'proof'} as const}:{})})
    fetchMock.mockResolvedValue(response(user))
    await act(async()=>{
      const promise=h.result.current.actions.signUp({email:user.email,password:'ValidPassword123!',...(kind==='open-none'||kind==='required-missing'?{}:{registrationGrant:{type:'ACCESS_CODE',registrationAccessCode:'code'} as const})})
      if(kind==='open-none'||kind==='open-code') await promise
      else await expect(promise).rejects.toMatchObject({code:kind==='required-missing'?'REGISTRATION_GRANT_REQUIRED':kind==='disallowed'?'REGISTRATION_GRANT_TYPE_NOT_ALLOWED':kind==='conflict'?'REGISTRATION_GRANT_INVALID':'AUTH_FLOW_STATE_INVALID'})
    })
    expect(fetchMock).toHaveBeenCalledTimes(kind==='open-none'||kind==='open-code'?1:0)
  })
})
