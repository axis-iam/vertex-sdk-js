// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { OAuthClient } from './oauth-client'
import { makeTestUser } from '../test-utils'

const redirect = 'https://app.test/callback'
let issuer: string,
  close: () => Promise<void>,
  nonce: string,
  mode: string,
  tokenRequests: number
const clients: OAuthClient[] = []
function client(scopes?: string[]) {
  const c = new OAuthClient({
    issuerUri: issuer,
    clientId: 'test-app',
    redirectUri: redirect,
    ...(scopes ? { scopes } : {}),
  })
  clients.push(c)
  return c
}
beforeEach(async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  })
  nonce = ''
  mode = 'valid'
  tokenRequests = 0
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  })
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    alg: 'ES256',
    kid: 'fixture',
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/.well-known/openid-configuration')
      return res.end(
        JSON.stringify({
          issuer,
          authorization_endpoint: issuer + '/authorize',
          token_endpoint: issuer + '/token',
          jwks_uri: issuer + '/jwks',
        }),
      )
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [jwk] }))
    if (req.url === '/token') {
      tokenRequests++
      const encode = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString('base64url')
      const unsigned =
        encode({ alg: 'ES256', kid: 'fixture' }) +
        '.' +
        encode({
          ...(mode === 'missing-nonce'
            ? {}
            : { nonce: mode === 'wrong-nonce' ? 'wrong' : nonce }),
          iss: issuer,
          aud: 'test-app',
          sub: 'user-1',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
        })
      const id =
        unsigned +
        '.' +
        sign('sha256', Buffer.from(unsigned), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url')
      return res.end(
        JSON.stringify({
          access_token: 'opaque-shaped',
          token_type: 'Bearer',
          expires_in: 300,
          ...(mode === 'missing-id' ? {} : { id_token: id }),
        }),
      )
    }
    if (req.url === '/api/v1/auth/me')
      return res.end(JSON.stringify(makeTestUser()))
    if (req.url === '/api/v1/auth/me/permissions')
      return res.end(
        JSON.stringify({
          applicationId: 'app-test',
          organizationId: null,
          roles: [],
          permissions: [],
        }),
      )
    if (req.url === '/api/v1/auth/logout') {
      res.writeHead(204)
      return res.end()
    }
    res.writeHead(404)
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('fixture address')
  issuer = `http://127.0.0.1:${address.port}`
  close = () => new Promise<void>((resolve) => server.close(() => resolve()))
})
afterEach(async () => {
  clients.splice(0).forEach((c) => c.dispose())
  await close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function authorize(c = client()) {
  const url = new URL(await c.startAuthorizationFlow())
  nonce = url.searchParams.get('nonce')!
  return { c, url, state: url.searchParams.get('state')! }
}
it('binds fresh nonce/state/S256, restores across navigation and consumes once before exchange', async () => {
  const { c, state, url } = await authorize()
  expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
  const pending = JSON.parse(
    sessionStorage.getItem('axis_iam_pending_authorization')!,
  )
  expect(pending.nonce).toBe(nonce)
  expect(nonce).not.toBe(state)
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  c.dispose()
  const restored = client()
  await restored.handleCallback('code', state)
  expect(restored.getAccessToken()).toBe('opaque-shaped')
  expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
  await expect(client().handleCallback('code', state)).rejects.toMatchObject({
    code: 'AUTH_CONTROL_LOST',
  })
  expect(tokenRequests).toBe(1)
})
it.each(['wrong-nonce', 'missing-nonce', 'missing-id'])(
  'rejects %s before storing any OAuth session',
  async (failure) => {
    const { c, state } = await authorize()
    mode = failure
    await expect(c.handleCallback('code', state)).rejects.toMatchObject({
      code: 'OIDC_ID_TOKEN_INVALID',
    })
    expect(c.getAccessToken()).toBeNull()
    expect(sessionStorage.getItem('axis_iam_pending_authorization')).toBeNull()
    await expect(c.handleCallback('code', state)).rejects.toMatchObject({
      code: 'AUTH_CONTROL_LOST',
    })
    expect(tokenRequests).toBe(1)
  },
)
it('fails lost nonce, expiry, wrong state and cancellation closed without deleting a newer owner', async () => {
  const first = await authorize()
  const newer = await authorize()
  await expect(first.c.handleCallback('old', first.state)).rejects.toThrow(
    'state mismatch',
  )
  expect(
    JSON.parse(sessionStorage.getItem('axis_iam_pending_authorization')!).state,
  ).toBe(newer.state)
  const pending = JSON.parse(
    sessionStorage.getItem('axis_iam_pending_authorization')!,
  )
  delete pending.nonce
  sessionStorage.setItem(
    'axis_iam_pending_authorization',
    JSON.stringify(pending),
  )
  await expect(
    newer.c.handleCallback('code', newer.state),
  ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' })
  const expired = await authorize()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600001)
  await expect(
    expired.c.handleCallback('code', expired.state),
  ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_EXPIRED' })
  vi.restoreAllMocks()
  const cancelled = await authorize()
  await expect(cancelled.c.logout({ redirect: false })).rejects.toThrow(
    'Logout requires',
  )
  await expect(
    cancelled.c.handleCallback('code', cancelled.state),
  ).rejects.toMatchObject({ code: 'AUTH_CONTROL_LOST' })
  expect(tokenRequests).toBe(0)
})
it('non-OpenID scopes do not invent a nonce or require an ID Token', async () => {
  const { c, state, url } = await authorize(client(['profile']))
  expect(url.searchParams.has('nonce')).toBe(false)
  mode = 'missing-id'
  await c.handleCallback('code', state)
  expect(c.getAccessToken()).toBe('opaque-shaped')
})
it('rejects an in-flight old callback when another instance starts a newer pending owner', async () => {
  const first = await authorize()
  const originalFetch = globalThis.fetch
  let release!: () => void, reached!: () => void
  const barrier = new Promise<void>((resolve) => {
    release = resolve
  })
  const responseReady = new Promise<void>((resolve) => {
    reached = resolve
  })
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const response = await originalFetch(url, init)
    if (url.endsWith('/token')) {
      reached()
      await barrier
    }
    return response
  })
  const oldCallback = first.c.handleCallback('code', first.state)
  const rejected = expect(oldCallback).rejects.toMatchObject({
    code: 'AUTH_CONTROL_LOST',
  })
  await responseReady
  const newer = await authorize()
  release()
  await rejected
  expect(first.c.getAccessToken()).toBeNull()
  expect(
    JSON.parse(sessionStorage.getItem('axis_iam_pending_authorization')!).state,
  ).toBe(newer.state)
})
