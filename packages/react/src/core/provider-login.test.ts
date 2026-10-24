import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { makeTestUser } from '../test-utils'
import { flowCapabilities } from './auth-flow-fixtures.test-support'
const issuer = 'https://iam.test',
  redirectUri = 'https://app.test/callback'
let client: OAuthClient,
  create: Record<string, string>,
  state: string,
  expire: string,
  calls: string[]
beforeEach(() => {
  sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
  state = 'AUTHENTICATING'
  expire = new Date(Date.now() + 600000).toISOString()
  calls = []
  client = new OAuthClient({
    issuerUri: issuer,
    clientId: 'flow-test',
    redirectUri,
  })
  vi.spyOn(client, 'discover').mockResolvedValue({
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    userinfo_endpoint: issuer + '/userinfo',
    jwks_uri: issuer + '/jwks',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      calls.push(input)
      const json = (v: unknown) => new Response(JSON.stringify(v))
      if (input.endsWith('/auth/transactions')) {
        create = JSON.parse(String(init.body))
        return json({
          transactionId: 'tx',
          controlSecret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
          expiresAt: expire,
          nextAction: 'authenticate',
        })
      }
      if (input.endsWith('/tx/authorize')) {
        expect(JSON.parse(String(init.body))).toEqual({
          providerId: 'provider',
        })
        return json({
          authorizationUrl: 'https://provider.test/login',
          expiresAt: expire,
        })
      }
      if (input.endsWith('/tx'))
        return json({
          transactionId: 'tx',
          state,
          expiresAt: expire,
          nextAction: state === 'MFA_REQUIRED' ? 'mfa' : 'none',
        })
      if (input.endsWith('/token'))
        return json({
          access_token: 'fixture-at',
          refresh_token: 'fixture-rt',
          token_type: 'Bearer',
          expires_in: 600,
        })
      if (input.endsWith('/mfa')) {
        state = 'AUTHENTICATED'
        return json({
          transactionId: 'tx',
          state,
          expiresAt: expire,
          nextAction: 'complete',
        })
      }
      if (input.endsWith('/complete'))
        return json({
          kind: 'authorization_code',
          code: 'after-mfa',
          state: create.state,
          expiresIn: 120,
        })
      if (input.endsWith('/me')) {
        const u = makeTestUser()
        u.authenticationContext.clientId = 'flow-test'
        return json(u)
      }
      if (input.endsWith('/permissions'))
        return json({
          applicationId: 'app-test',
          organizationId: null,
          roles: [],
          permissions: [],
        })
      throw new Error('unexpected route')
    }),
  )
})
afterEach(() => {
  client.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it.each([false, true])(
  'public client callback preserves transaction with MFA=%s',
  async (mfa) => {
    expect(
      await client.startProviderAuthorizationFlow(
        flowCapabilities.idpProviders[0],
      ),
    ).toBe('https://provider.test/login')
    state = mfa ? 'MFA_REQUIRED' : 'COMPLETED'
    const url =
      redirectUri +
      '?' +
      new URLSearchParams(
        mfa
          ? {
              kind: 'AUTH_CONTINUATION',
              auth_transaction_id: 'tx',
              state: create.state,
            }
          : { code: 'provider-code', state: create.state },
      )
    const result = await client.handleRedirectCallback({ url, cleanUrl: false })
    if (mfa) {
      expect(result.status).toBe('continuation')
      if (result.status !== 'continuation') throw new Error('continuation')
      expect(client.isAuthenticated()).toBe(false)
      await result.transaction.verifyMfa('TOTP', '123456')
      await client.completeAuthentication(result.transaction)
    } else expect(result.status).toBe('success')
    expect(client.isAuthenticated()).toBe(true)
    expect(calls.filter((path) => path.endsWith('/token'))).toHaveLength(1)
    expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
  },
)
it('Hosted uses the same bounded store and consumes exact callback once without legacy keys', async () => {
  // This case covers OAuth-only transport; OpenID validation has signed-ID-token cases.
  client.config.scopes = ['profile']
  const url = new URL(await client.startAuthorizationFlow())
  const saved = JSON.parse(
    sessionStorage.getItem('axis_iam_pending_authorization')!,
  )
  expect(saved.entryMode).toBe('HOSTED')
  expect(saved).not.toHaveProperty('controlSecret')
  expect(url.searchParams.get('state')).toBe(saved.state)
  expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()
  const callback =
    redirectUri +
    '?' +
    new URLSearchParams({ code: 'hosted-code', state: saved.state })
  expect(
    (await client.handleRedirectCallback({ url: callback, cleanUrl: false }))
      .status,
  ).toBe('success')
  expect(
    (await client.handleRedirectCallback({ url: callback, cleanUrl: false }))
      .status,
  ).toBe('error')
  expect(calls.filter((path) => path.endsWith('/token'))).toHaveLength(1)
})
it('storage failure rejects Hosted navigation and new-account callbacks do not replace tokens', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  await expect(client.startAuthorizationFlow()).rejects.toMatchObject({
    code: 'AUTH_PENDING_STORAGE_UNAVAILABLE',
  })
  vi.restoreAllMocks()
  vi.spyOn(client, 'discover').mockResolvedValue({
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    userinfo_endpoint: issuer + '/userinfo',
    jwks_uri: issuer + '/jwks',
  })
  await client.startProviderAuthorizationFlow(flowCapabilities.idpProviders[0])
  client.tokenManager.store(
    { access_token: 'new-owner', token_type: 'Bearer', expires_in: 600 },
    'OAUTH_AUTHORIZATION_CODE',
    null,
  )
  await expect(
    client.resumeProviderCallback(
      redirectUri + '?code=old&state=' + create.state,
    ),
  ).rejects.toThrow('signed-in account')
  expect(client.getAccessToken()).toBe('new-owner')
  expect(sessionStorage.length).toBe(0)
})
it.each([
  'wrong-state',
  'redirect',
  'expired',
  'storage-lost',
  'extra',
  'nonce',
])('Hosted rejects %s callbacks before token transport', async (mode) => {
  const target = new URL(await client.startAuthorizationFlow())
  const url = new URL(
    redirectUri +
      '?' +
      new URLSearchParams({
        code: 'hosted-code',
        state: target.searchParams.get('state')!,
      }),
  )
  if (mode === 'wrong-state') url.searchParams.set('state', 'wrong')
  if (mode === 'redirect') url.pathname = '/other'
  if (mode === 'expired')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001)
  if (mode === 'storage-lost') sessionStorage.clear()
  if (mode === 'extra') url.searchParams.set('access_token', 'no')
  if (mode === 'nonce')
    url.searchParams.append('state', target.searchParams.get('state')!)
  expect(
    (await client.handleRedirectCallback({ url: url.href, cleanUrl: false }))
      .status,
  ).toBe('error')
  expect(calls.some((path) => path.endsWith('/token'))).toBe(false)
})
it('late create after owner change cannot overwrite another pending flow', async () => {
  const base = globalThis.fetch
  let release!: (response: Response) => void
  vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
    url.endsWith('/auth/transactions')
      ? new Promise<Response>((resolve) => (release = resolve))
      : base(url, init),
  )
  const pending = client.startProviderAuthorizationFlow(
    flowCapabilities.idpProviders[0],
  )
  const rejected = expect(pending).rejects.toMatchObject({
    code: 'SESSION_INVALIDATED',
  })
  await vi.waitFor(() => expect(release).toBeDefined())
  client.tokenManager.clear()
  sessionStorage.setItem('axis_iam_pending_authorization', 'new-owner-record')
  release(
    new Response(
      JSON.stringify({
        transactionId: 'tx',
        controlSecret: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
        expiresAt: expire,
        nextAction: 'authenticate',
      }),
    ),
  )
  await rejected
  expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBe(
    'new-owner-record',
  )
  expect(calls.some((path) => path.endsWith('/tx/authorize'))).toBe(false)
})
