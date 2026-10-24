import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { AuthenticationTransaction } from './authentication-transaction.js'
import {
  PendingAuthorizationStore,
  authorizationRandom,
} from './pending-authorization.js'
const config = {
  issuer: 'https://iam.test',
  tokenEndpoint: 'https://iam.test/token',
  clientId: 'public',
  redirectUri: 'https://app.test/callback?fixed=one',
  scopes: ['openid'],
}
const storage = new Map<string, string>()
let state: string,
  expiresAt: string,
  binding: Record<string, string>,
  calls: { url: string; init: RequestInit }[]
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  storage.clear()
  calls = []
  state = 'AUTHENTICATING'
  expiresAt = new Date(Date.now() + 600000).toISOString()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/auth/transactions')) {
        binding = JSON.parse(String(init.body))
        return json({
          transactionId: 'tx',
          controlSecret: authorizationRandom(),
          expiresAt,
          nextAction: 'authenticate',
        })
      }
      if (url.endsWith('/authorize')) {
        expect(JSON.parse(String(init.body))).toEqual({
          providerId: 'provider-1',
        })
        expect(
          new Headers(init.headers).has('Authentication-Transaction'),
        ).toBe(true)
        state = 'AWAITING_PROVIDER'
        return json({
          authorizationUrl: 'https://provider.test/authorize?state=broker',
          expiresAt,
        })
      }
      if (url.endsWith('/tx'))
        return json({
          transactionId: 'tx',
          state,
          expiresAt,
          nextAction: {
            AWAITING_PROVIDER: 'authorize',
            MFA_REQUIRED: 'mfa',
            COMPLETED: 'none',
            AUTHENTICATED: 'complete',
          }[state],
        })
      if (url.endsWith('/mfa')) {
        state = 'AUTHENTICATED'
        return json({
          transactionId: 'tx',
          state,
          expiresAt,
          nextAction: 'complete',
        })
      }
      if (url.endsWith('/complete'))
        return json({
          kind: 'authorization_code',
          code: 'after-mfa',
          state: binding.state,
          expiresIn: 120,
        })
      if (url.endsWith('/token'))
        return json({
          access_token: 'fixture-at',
          token_type: 'Bearer',
          expires_in: 300,
        })
      throw new Error('unexpected route')
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const callback = (mfa: boolean) =>
  config.redirectUri +
  '&' +
  new URLSearchParams(
    mfa
      ? {
          kind: 'AUTH_CONTINUATION',
          auth_transaction_id: 'tx',
          state: binding.state,
        }
      : { code: 'provider-code', state: binding.state },
  )
it.each([false, true])(
  'restores provider callback with MFA=%s using original control then one code exchange',
  async (mfa) => {
    const tx = await AuthenticationTransaction.start(config)
    await tx.authorizeProvider('provider-1')
    const saved = storage.get('axis_iam_pending_authorization')!
    expect(saved).not.toMatch(/access_token|password|proof|email/)
    tx.invalidate(true)
    state = mfa ? 'MFA_REQUIRED' : 'COMPLETED'
    const resumed = AuthenticationTransaction.restoreProvider(
      config,
      callback(mfa),
    )
    const result = await resumed.completeProviderCallback(callback(mfa))
    expect(storage.size).toBe(0)
    expect(() =>
      AuthenticationTransaction.restoreProvider(config, callback(mfa)),
    ).toThrow('AUTH_CONTROL_LOST')
    if (mfa) {
      expect(result).toMatchObject({ state: 'MFA_REQUIRED' })
      expect(calls.some((c) => c.url.endsWith('/token'))).toBe(false)
      await resumed.verifyMfa('RECOVERY_CODE', 'fixture')
      await resumed.exchange()
    }
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(1)
    const body = new URLSearchParams(
      String(calls.find((c) => c.url.endsWith('/token'))!.init.body),
    )
    expect(body.get('code')).toBe(mfa ? 'after-mfa' : 'provider-code')
    expect(body.get('code_verifier')).toBe(JSON.parse(saved).verifier)
  },
)
it.each([
  'state',
  'redirect',
  'id',
  'mixed',
  'duplicate',
  'new-tab',
  'expired',
  'client',
] as const)('rejects %s before callback I/O', async (mode) => {
  const tx = await AuthenticationTransaction.start(config)
  await tx.authorizeProvider('provider-1')
  const url = new URL(callback(true))
  if (mode === 'state') url.searchParams.set('state', 'other')
  if (mode === 'redirect') url.pathname = '/other'
  if (mode === 'id') url.searchParams.set('auth_transaction_id', 'other')
  if (mode === 'mixed') url.searchParams.set('code', 'early')
  if (mode === 'duplicate') url.searchParams.append('state', binding.state)
  if (mode === 'new-tab') storage.clear()
  if (mode === 'expired')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt))
  const before = calls.length
  expect(() =>
    AuthenticationTransaction.restoreProvider(
      { ...config, clientId: mode === 'client' ? 'other' : config.clientId },
      url.href,
    ),
  ).toThrow()
  expect(calls).toHaveLength(before)
})
it('fails closed on storage refusal before provider authorization', async () => {
  const tx = await AuthenticationTransaction.start(config)
  vi.stubGlobal('sessionStorage', {
    setItem() {
      throw new Error('denied')
    },
  })
  await expect(tx.authorizeProvider('provider-1')).rejects.toMatchObject({
    code: 'AUTH_PENDING_STORAGE_UNAVAILABLE',
  })
  expect(calls).toHaveLength(1)
})
it('rejects continuation before MFA state and late owner responses without exchange', async () => {
  let active = true
  const tx = await AuthenticationTransaction.start({
    ...config,
    assertOwner: () => {
      if (!active) throw new Error('owner')
    },
  })
  await tx.authorizeProvider('provider-1')
  await expect(
    tx.completeProviderCallback(callback(true)),
  ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_STATE_INVALID' })
  active = false
  await expect(tx.completeProviderCallback(callback(true))).rejects.toThrow(
    'owner',
  )
  expect(calls.some((c) => c.url.endsWith('/token'))).toBe(false)
})
it('shares the finite store with HOSTED but never accepts transaction control there', () => {
  const pending = {
    version: 1 as const,
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    entryMode: 'HOSTED' as const,
    flowOwner: authorizationRandom(),
    state: authorizationRandom(),
    verifier: authorizationRandom(),
    expiresAt,
  }
  PendingAuthorizationStore.save(pending)
  expect(PendingAuthorizationStore.read(pending)).toEqual(pending)
  expect(() =>
    PendingAuthorizationStore.save({
      ...pending,
      controlSecret: authorizationRandom(),
    }),
  ).toThrow('AUTH_CONTROL_LOST')
  expect(() =>
    PendingAuthorizationStore.save({
      ...pending,
      access_token: 'never',
    } as never),
  ).toThrow('AUTH_CONTROL_LOST')
})
