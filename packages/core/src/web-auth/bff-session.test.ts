import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { BffSessionClient } from './bff-session.js'
import { MemorySessionProvider } from './memory-session-provider.js'
import { parseServerSession } from '../client/server-session.js'
import type { BffSessionProvider } from './session-provider.js'

const resources: MemorySessionProvider[] = []
afterEach(async () => { await Promise.all(resources.splice(0).map(p => p.close())) })
const c0 = JSON.parse(readFileSync(new URL('../../../../docs/connected-app-bff/c0/c0-v1.json', import.meta.url), 'utf8'))
const profile = c0.viewVectors[0].value.profile
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
function fixture() {
  let now = 1_800_000_000_000, refresh = 0, token = 0
  const provider = new MemorySessionProvider({ now: () => now }); resources.push(provider)
  const calls: { path: string; init?: RequestInit }[] = []
  const wire = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname
    calls.push({ path, init })
    if (path.endsWith('openid-configuration')) return json({ issuer: 'https://iam.test', authorization_endpoint: 'https://iam.test/oauth2/authorize',
      token_endpoint: 'https://iam.test/oauth2/token', jwks_uri: 'https://iam.test/jwks' })
    if (path === '/oauth2/token') {
      const form = new URLSearchParams(String(init?.body))
      if (form.get('grant_type') === 'refresh_token') refresh++
      return json({ access_token: 'opaque-at-' + ++token, refresh_token: 'opaque-rt-' + token, token_type: 'Bearer', expires_in: 60 })
    }
    if (path.endsWith('/me')) return json(profile)
    if (path.endsWith('/permissions')) return json({ applicationId: profile.authenticationContext.applicationId, organizationId: null, roles: ['reader'], permissions: ['documents:read'] })
    if (path.endsWith('/validity')) return json({ sessionId: profile.authenticationContext.sessionId, clientId: 'connected-web',
      applicationId: profile.authenticationContext.applicationId, expiresAt: new Date(now + 7200000).toISOString(),
      idleExpiresAt: new Date(now + 7200000).toISOString(), accessExpiresAt: new Date(now + 60000).toISOString() })
    if (path.endsWith('/logout')) return new Response(null, { status: 204 })
    if (path === '/oauth2/revoke') return new Response(null, { status: 200 })
    return json({ error: 'VALIDATION_ERROR' }, 400)
  })
  const config = { issuer: 'https://iam.test', clientId: 'connected-web', clientSecret: 'fixture-confidential',
    audience: 'resource', applicationOrigin: 'https://app.test', redirectUri: 'https://app.test/auth/callback',
    successRedirect: '/done', postLogoutRedirect: '/out', scopes: ['profile'], provider, fetch: wire,
    now: () => now, sessionTtlSeconds: 3600 }
  const client = new BffSessionClient(config)
  async function login() {
    const pre = await client.bootstrap()
    const url = new URL(await client.hostedLogin(pre.id))
    const result = await client.callback(pre.id, new URLSearchParams({ code: 'one-use', state: url.searchParams.get('state')! }))
    return { ...result, pre, url }
  }
  return { client, provider, wire, calls, config, login, advance: (ms: number) => { now += ms }, refreshCount: () => refresh }
}
it('BFF-JS-CORE: executes frozen safe-view acceptance and denial vectors', () => {
  for (const vector of c0.viewVectors) {
    if (vector.accept) expect(() => parseServerSession(vector.value), vector.id).not.toThrow()
    else expect(() => parseServerSession(vector.value), vector.id).toThrow()
  }
})
it('BFF-JS-HTTP: bootstrap-bound Hosted, strict callback branches, one exchange and safe view', async () => {
  const f = fixture()
  await expect(f.client.hostedLogin('missing')).rejects.toMatchObject({ status: 401 })
  const a = await f.login()
  const view = await f.client.session(a.id)
  expect(view).toMatchObject({ state: 'AUTHENTICATED', profile })
  expect(JSON.stringify(view)).not.toMatch(/opaque-at|opaque-rt|fixture-confidential|codeVerifier|controlSecret/)
  expect(a.url.searchParams.has('audience')).toBe(false)
  await expect(f.client.callback(a.pre.id, new URLSearchParams({ code: 'one-use', state: a.url.searchParams.get('state')! }))).rejects.toMatchObject({ status: 401 })
  const b = await f.client.bootstrap()
  const state = new URL(await f.client.hostedLogin(b.id)).searchParams.get('state')!
  await expect(f.client.callback(b.id, new URLSearchParams('code=a&code=b&state=' + state))).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  await expect(f.client.callback(b.id, new URLSearchParams({ code: 'a', state: 'wrong' }))).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  await expect(f.client.verifyCsrf(b.id, 'https://other.test', b.view.csrfToken)).rejects.toMatchObject({ status: 403 })
  expect(f.calls.filter(c => c.path === '/oauth2/token')).toHaveLength(1)
})
it('BFF-JS-CORE: concurrent clients share refresh exclusion before send and absolute deadline is fixed', async () => {
  const f = fixture(), a = await f.login(), before = await f.provider.read(a.id)
  f.advance(45000)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const original = f.config.fetch
  const other = new BffSessionClient({ ...f.config, fetch: async (url, init) => {
    if (String(url).endsWith('/oauth2/token')) await held
    return original(url, init)
  } })
  const pending = other.protect(a.id)
  await vi.waitFor(async () => expect((await f.provider.read(a.id))?.lifecycle).toBe('SEND_INTENT'))
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ code: 'SESSION_ACTION_PENDING', status: 409 })
  release(); await pending
  expect(f.refreshCount()).toBe(1)
  expect((await f.provider.read(a.id))!.absoluteExpiresAt).toBe(before!.absoluteExpiresAt)
})
it('BFF-JS-CORE: lease expiry after send and late refresh cannot replay or resurrect logout', async () => {
  const f = fixture(), a = await f.login()
  f.advance(45000)
  let release!: () => void
  const held = new Promise<void>(r => { release = r })
  const client = new BffSessionClient({ ...f.config, fetch: async (url, init) => {
    if (String(url).endsWith('/oauth2/token')) await held
    return f.wire(url, init)
  } })
  const pending = client.protect(a.id)
  const observed = pending.catch(e => e)
  await vi.waitFor(async () => expect((await f.provider.read(a.id))?.lifecycle).toBe('SEND_INTENT'))
  f.advance(16000)
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ code: 'REFRESH_UNCERTAIN', status: 401 })
  release()
  expect(await observed).toMatchObject({ code: 'REFRESH_UNCERTAIN' })
  expect(await f.provider.read(a.id)).toBeNull()
  expect(f.refreshCount()).toBe(1)
})
it('BFF-JS-CORE: successful refresh followed by failed commit cannot restore the old RT', async () => {
  const f = fixture(), a = await f.login()
  f.advance(45000)
  const cas = f.provider.compareAndSet.bind(f.provider)
  vi.spyOn(f.provider, 'compareAndSet').mockImplementation((id, old, next) =>
    old.lifecycle === 'SEND_INTENT' && next.tokens !== old.tokens ? Promise.reject(new Error('storage outage')) : cas(id, old, next))
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ code: 'REFRESH_UNCERTAIN' })
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  expect(f.refreshCount()).toBe(1)
})
it('BFF-JS-HTTP: dependency and store faults stay 503; no-RT expiry requires authorization', async () => {
  const f = fixture(), a = await f.login()
  f.wire.mockImplementationOnce(async () => json({ error: 'upstream-internal-secret' }, 503))
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ status: 503, code: 'IAM_UNAVAILABLE' })
  expect(await f.provider.read(a.id)).not.toBeNull()
  const spy = vi.spyOn(f.provider, 'read').mockRejectedValueOnce(new Error('private-database'))
  await expect(f.client.session(a.id)).rejects.toMatchObject({ status: 503, code: 'SESSION_STORE_UNAVAILABLE' })
  spy.mockRestore()
  const r = (await f.provider.read(a.id))!
  await f.provider.compareAndSet(a.id, r, { ...r, version: r.version + 1, tokens: { ...r.tokens!, refreshToken: undefined } })
  f.advance(61000)
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ status: 401 })
  expect(f.refreshCount()).toBe(0)
})
it('BFF-JS-HTTP: logout invalidates first, distinguishes valid AT / expired AT / no RT and remote faults', async () => {
  const f = fixture(), a = await f.login()
  expect(await f.client.logout(a.id)).toMatchObject({ local: 'INVALIDATED', remote: 'SESSION_REVOKED', sso: 'NOT_REQUESTED' })
  const b = await f.login(); f.advance(61000)
  expect(await f.client.logout(b.id)).toMatchObject({ remote: 'REFRESH_FAMILY_REVOKED' })
  const c = await f.login(), r = (await f.provider.read(c.id))!
  await f.provider.compareAndSet(c.id, r, { ...r, version: r.version + 1, tokens: { ...r.tokens!, refreshToken: undefined } })
  f.advance(61000)
  expect(await f.client.logout(c.id)).toMatchObject({ remote: 'NOT_ATTEMPTED' })
  const d = await f.login()
  f.wire.mockRejectedValueOnce(new Error('remote-secret'))
  expect(await f.client.logout(d.id)).toMatchObject({ local: 'INVALIDATED', remote: 'UNCONFIRMED' })
  expect(await f.provider.read(d.id)).toBeNull()
})
it('BFF-JS-HOST: explicitly selected replacement provider and deployment capabilities', async () => {
  const f = fixture()
  const wrapped: BffSessionProvider = {
    scope: 'shared', create: (...v) => f.provider.create(...v), read: (...v) => f.provider.read(...v),
    compareAndSet: (...v) => f.provider.compareAndSet(...v), rotate: (...v) => f.provider.rotate(...v),
    invalidate: (...v) => f.provider.invalidate(...v), close: () => f.provider.close(),
  }
  const client = new BffSessionClient({ ...f.config, provider: wrapped, replicas: 2 })
  expect((await client.bootstrap()).view.state).toBe('PRELOGIN')
  expect(() => new BffSessionClient({ ...f.config, replicas: 2 })).toThrow()
  expect(() => new BffSessionClient({ ...f.config, provider: undefined! })).toThrow()
  // Controlled wrapper proves dispatch/interface replacement, not a production shared backend.
})

function customFixture() {
  const f = fixture()
  const original = f.wire.getMockImplementation()!
  let transaction: Record<string, unknown> = {}, state = 'AUTHENTICATING'
  const transactionId = '019b0000-0000-7000-8000-000000000099'
  const expiresAt = () => new Date(f.config.now() + 300000).toISOString()
  const view = () => ({ transactionId, state, expiresAt: expiresAt(),
    nextAction: state === 'AUTHENTICATED' ? 'complete' : state === 'MFA_REQUIRED' ? 'mfa' : state === 'AWAITING_PROVIDER' ? 'authorize' : 'authenticate' })
  f.wire.mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path.startsWith('/api/v1/auth/transactions')) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (path.endsWith('/transactions')) {
        transaction = body
        return json({ transactionId, controlSecret: 'fixture-private-control', expiresAt: expiresAt(), nextAction: 'authenticate' }, 201)
      }
      expect(new Headers(init?.headers).get('Authentication-Transaction')).toBe('fixture-private-control')
      if (init?.method !== 'GET') expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{43}$/)
      if (path.endsWith('/challenges')) return json({ ...view(), challengeExpiresAt: expiresAt(), cooldownSeconds: 30 })
      if (path.endsWith('/authenticate')) {
        if (body.password === 'wrong') return json({ error: 'INVALID_CREDENTIALS', message: 'sensitive upstream' }, 400)
        state = 'MFA_REQUIRED'
      }
      if (path.endsWith('/mfa')) state = 'AUTHENTICATED'
      if (path.endsWith('/authorize')) { state = 'AWAITING_PROVIDER'; return json({ authorizationUrl: 'https://provider.test/login', expiresAt: expiresAt() }) }
      if (path.endsWith('/complete')) return json({ kind: 'authorization_code', code: 'fixture-private-code', state: transaction.state, expiresIn: 60 })
      if (path.endsWith('/cancel')) state = 'CANCELLED'
      return json(view())
    }
    return original(url, init)
  })
  return { ...f, transaction: () => transaction, setState: (v: string) => { state = v }, transactionId }
}
it('BFF-JS-UI: CUSTOM preserves password errors, challenge, MFA and backend-only completion', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  expect(await f.client.customLogin(pre.id)).toMatchObject({ state: 'AUTHENTICATING' })
  expect(f.transaction()).toMatchObject({ client_id: 'connected-web', entryMode: 'CUSTOM', code_challenge_method: 'S256' })
  await expect(f.client.loginAction(pre.id, 'authenticate', { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'wrong' }))
    .rejects.toMatchObject({ status: 400, code: 'INVALID_CREDENTIALS' })
  expect((await f.provider.read(pre.id))!.lifecycle).toBe('READY')
  expect((await f.client.loginAction(pre.id, 'challenges', { method: 'EMAIL_OTP', identifier: { kind: 'EMAIL', value: 'u@example.test' } })).view)
    .toMatchObject({ cooldownSeconds: 30 })
  expect((await f.client.loginAction(pre.id, 'authenticate', { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'correct' })).view.state).toBe('MFA_REQUIRED')
  expect((await f.client.loginAction(pre.id, 'mfa', { method: 'TOTP', code: '123456' })).view).toMatchObject({ state: 'AUTHENTICATED', nextAction: 'complete' })
  const result = await f.client.loginAction(pre.id, 'complete', {})
  expect(result.id).not.toBe(pre.id)
  expect(result.view).toMatchObject({ state: 'AUTHENTICATED', profile })
  expect(JSON.stringify(result.view)).not.toMatch(/fixture-private|codeVerifier|nonce/)
})
it('BFF-JS-UI: Provider MFA continuation binds state/transaction and rejects replay; cancellation terminates', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  await f.client.customLogin(pre.id)
  await f.client.loginAction(pre.id, 'authorize', { providerId: '019b0000-0000-7000-8000-000000000098' })
  f.setState('MFA_REQUIRED')
  const query = new URLSearchParams({ kind: 'AUTH_CONTINUATION', auth_transaction_id: f.transactionId, state: String(f.transaction().state) })
  expect(await f.client.callback(pre.id, query)).toMatchObject({ id: pre.id, redirectUrl: 'https://app.test/done' })
  await expect(f.client.callback(pre.id, query)).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  await f.client.loginAction(pre.id, 'cancel', {})
  await expect(f.client.loginAction(pre.id, 'mfa', { method: 'TOTP', code: '123456' })).rejects.toMatchObject({ status: 401 })
})
it('BFF-JS-UI: magic proof requires the stored EMAIL identifier, transaction and state', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  await f.client.customLogin(pre.id)
  const input = { transactionId: f.transactionId, state: f.transaction().state, proof: 'one-time-proof' }
  await expect(f.client.loginAction(pre.id, 'magic', input)).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  await f.client.loginAction(pre.id, 'challenges', { method: 'EMAIL_MAGIC_LINK', identifier: { kind: 'EMAIL', value: 'u@example.test' } })
  expect((await f.client.loginAction(pre.id, 'magic', input)).view.state).toBe('MFA_REQUIRED')
  await expect(f.client.loginAction(pre.id, 'magic', { ...input, state: 'wrong' })).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
})
it('BFF-JS-UI: a bound Provider denial lands cleanly, exposes only terminal state and can be cancelled', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  await f.client.customLogin(pre.id)
  await f.client.loginAction(pre.id, 'authorize', { providerId: '019b0000-0000-7000-8000-000000000098' })
  const query = new URLSearchParams({ error: 'access_denied', state: String(f.transaction().state) })
  expect(await f.client.callback(pre.id, query)).toMatchObject({ redirectUrl: 'https://app.test/done' })
  expect(await f.client.session(pre.id)).toMatchObject({ state: 'CANCELLED', nextAction: 'none' })
  await expect(f.client.callback(pre.id, query)).rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  await f.client.loginAction(pre.id, 'cancel', {})
  expect(await f.provider.read(pre.id)).toBeNull()
})
it('BFF-JS-CORE: optional RT is accepted at exchange without fabricating a credential or broader scopes', async () => {
  const f = fixture(), original = f.wire.getMockImplementation()!
  f.wire.mockImplementation(async (url, init) => {
    const result = await original(url, init)
    if (!String(url).endsWith('/oauth2/token')) return result
    const value = await result.json(); delete value.refresh_token
    return json(value)
  })
  const a = await f.login()
  expect((await f.provider.read(a.id))!.tokens!.refreshToken).toBeUndefined()
  expect(a.url.searchParams.get('scope')).toBe('profile')
  f.advance(61000)
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ code: 'SESSION_INVALIDATED' })
  expect(f.refreshCount()).toBe(0)
})
it('BFF-JS-HTTP: local invalidation failure is never reported as a fully successful logout', async () => {
  const f = fixture(), a = await f.login()
  vi.spyOn(f.provider, 'invalidate').mockRejectedValueOnce(new Error('private storage failure'))
  expect(await f.client.logout(a.id)).toMatchObject({ local: 'UNCONFIRMED', remote: 'SESSION_REVOKED' })
  expect(await f.provider.read(a.id)).not.toBeNull()
})
it('BFF-JS-CORE: callback state from another prelogin cannot inject an identity', async () => {
  const f = fixture(), a = await f.client.bootstrap(), b = await f.client.bootstrap()
  const aUrl = new URL(await f.client.hostedLogin(a.id))
  await f.client.hostedLogin(b.id)
  await expect(f.client.callback(b.id, new URLSearchParams({ code: 'one-use', state: aUrl.searchParams.get('state')! })))
    .rejects.toMatchObject({ code: 'AUTH_CALLBACK_INVALID' })
  expect(f.calls.filter(c => c.path.endsWith('/oauth2/token'))).toHaveLength(0)
  expect((await f.provider.read(b.id))!.kind).toBe('PRELOGIN')
})
it('BFF-JS-HTTP: a Provider continuation GET dependency failure stays 503 without exchanging or destroying the binding', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  await f.client.customLogin(pre.id)
  await f.client.loginAction(pre.id, 'authorize', { providerId: '019b0000-0000-7000-8000-000000000098' })
  const query = new URLSearchParams({ kind: 'AUTH_CONTINUATION', auth_transaction_id: f.transactionId, state: String(f.transaction().state) })
  f.wire.mockResolvedValueOnce(json({ error: 'PRIVATE_DEPENDENCY' }, 503))
  await expect(f.client.callback(pre.id, query)).rejects.toMatchObject({ status: 503, code: 'IAM_UNAVAILABLE' })
  expect((await f.provider.read(pre.id))!.lifecycle).toBe('READY')
  f.setState('MFA_REQUIRED')
  expect(await f.client.callback(pre.id, query)).toMatchObject({ id: pre.id })
  expect(f.calls.filter(c => c.path.endsWith('/oauth2/token'))).toHaveLength(0)
})
it.each(['budget', 'cancel'])('BFF-JS-CORE: %s after refresh send terminates the attempt without replay', async mode => {
  const f = fixture(), a = await f.login()
  f.advance(45000)
  const abort = new AbortController()
  let sent = 0, entered!: () => void
  const sending = new Promise<void>(resolve => { entered = resolve })
  const client = new BffSessionClient({ ...f.config, requestBudgetMs: 40, upstreamTimeoutMs: 1000,
    fetch: async (url, init) => {
      if (!String(url).endsWith('/oauth2/token')) return f.wire(url, init)
      sent++; entered()
      return new Promise<Response>((_resolve, reject) => {
        const stop = () => reject(new DOMException('Aborted', 'AbortError'))
        if (init?.signal?.aborted) stop()
        else init?.signal?.addEventListener('abort', stop, { once: true })
      })
    } })
  const pending = client.run(() => client.protect(a.id), abort.signal)
  const assertion = expect(pending).rejects.toMatchObject({ code: 'REFRESH_UNCERTAIN', status: 401 })
  await sending
  if (mode === 'cancel') abort.abort()
  await assertion
  expect(sent).toBe(1)
  expect(await f.provider.read(a.id)).toBeNull()
})
it('BFF-JS-HTTP: malformed IAM success data is a service error, not browser validation or anonymous success', async () => {
  const f = fixture(), a = await f.login()
  f.wire.mockResolvedValueOnce(json([]))
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ status: 503, code: 'IAM_RESPONSE_INVALID' })
  expect(await f.provider.read(a.id)).not.toBeNull()
  expect(await f.client.protect(a.id)).toMatchObject({ state: 'AUTHENTICATED' })
})
it('F-JS-001: transaction 401 preserves the stable proof error while established-session 401 still invalidates', async () => {
  const f = customFixture(), pre = await f.client.bootstrap()
  await f.client.customLogin(pre.id)
  f.wire.mockResolvedValueOnce(json({ status: 401, error: 'UNAUTHORIZED',
    message: 'private upstream proof detail', timestamp: new Date().toISOString() }, 401))
  const failure = await f.client.loginAction(pre.id, 'authenticate',
    { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'wrong' }).catch(e => e)
  expect(failure).toMatchObject({ status: 401, code: 'UNAUTHORIZED', message: 'UNAUTHORIZED' })
  expect((await f.provider.read(pre.id))!.lifecycle).toBe('READY')
  expect((await f.provider.read(pre.id))!.profile).toBeUndefined()
  expect((await f.client.loginAction(pre.id, 'authenticate',
    { method: 'PASSWORD', identifier: { kind: 'EMAIL', value: 'u@example.test' }, password: 'correct' })).view.state).toBe('MFA_REQUIRED')
  const a = await f.login()
  f.wire.mockResolvedValueOnce(json({ error: 'UNAUTHORIZED' }, 401))
  await expect(f.client.protect(a.id)).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALIDATED' })
  expect(await f.provider.read(a.id)).toBeNull()
})
it.each([
  { status: 400, oauth: 'invalid_grant', code: 'OAUTH_INVALID_GRANT', host: 401 },
  { status: 401, oauth: 'invalid_client', code: 'OAUTH_INVALID_CLIENT', host: 401 },
  { status: 503, oauth: 'server_error', code: 'IAM_UNAVAILABLE', host: 503 },
  { status: 0, oauth: '', code: 'REFRESH_UNCERTAIN', host: 401 },
])('A-JS-002: refresh $oauth/$status keeps its failure category without replay', async entry => {
  const f = fixture(), login = await f.login()
  f.advance(45000)
  const base = f.wire.getMockImplementation()!
  let sends = 0
  f.wire.mockImplementation(async (url, init) => {
    if (!String(url).endsWith('/oauth2/token')) return base(url, init)
    sends++
    if (!entry.status) throw new Error('private disconnect')
    return json({ error: entry.oauth, error_description: 'private upstream detail' }, entry.status)
  })
  const error = await f.client.protect(login.id).catch(e => e)
  expect(error).toMatchObject({ code: entry.code, status: entry.host })
  expect(JSON.stringify(error)).not.toContain('private')
  expect(await f.provider.read(login.id)).toBeNull()
  await expect(f.client.protect(login.id)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  expect(sends).toBe(1)
})
it.each(['token-503', 'identity-503', 'invalid_grant', 'disconnect'])('A-JS-002: callback %s consumes the attempt and preserves the result category', async mode => {
  const f = fixture(), pre = await f.client.bootstrap()
  const url = new URL(await f.client.hostedLogin(pre.id))
  const base = f.wire.getMockImplementation()!
  let sends = 0
  f.wire.mockImplementation(async (url, init) => {
    if (String(url).endsWith('/oauth2/token')) {
      sends++
      if (mode === 'disconnect') throw new Error('private disconnect')
      if (mode === 'token-503') return json({ error: 'server_error' }, 503)
      if (mode === 'invalid_grant') return json({ error: 'invalid_grant', error_description: 'private' }, 400)
    }
    if (mode === 'identity-503' && String(url).endsWith('/me')) return json({ error: 'private' }, 503)
    return base(url, init)
  })
  const query = new URLSearchParams({ code: 'one-use', state: url.searchParams.get('state')! })
  await expect(f.client.callback(pre.id, query)).rejects.toMatchObject({
    code: mode.endsWith('503') ? 'IAM_UNAVAILABLE' : mode === 'invalid_grant' ? 'OAUTH_INVALID_GRANT' : 'AUTH_EXCHANGE_UNCERTAIN',
    status: mode.endsWith('503') ? 503 : 401,
  })
  expect(await f.provider.read(pre.id)).toBeNull()
  await expect(f.client.callback(pre.id, query)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
  expect(sends).toBe(1)
})
