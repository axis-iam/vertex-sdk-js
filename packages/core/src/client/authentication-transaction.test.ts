import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { AuthenticationTransaction } from './authentication-transaction.js'

const config = {
  issuer: 'https://iam.test',
  tokenEndpoint: 'https://iam.test/token',
  clientId: 'public-client',
  redirectUri: 'https://app.test/callback',
  scopes: ['openid', 'email'],
}
const identifier = { kind: 'EMAIL', value: 'user@example.invalid' } as const
const pendingKey = 'axis_iam_pending_authorization'
const control = Buffer.alloc(32, 7).toString('base64url')
const canonical = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
let create: Record<string, string>
let expiresAt: string
let state: 'AUTHENTICATING' | 'MFA_REQUIRED' | 'AUTHENTICATED' | 'COMPLETED'
let mfa: boolean
let calls: {
  path: string
  body: Record<string, string>
  headers: Headers
  method: string
}[]
let intercept: ((path: string) => Response | undefined) | undefined
const storage = new Map<string, string>()
const view = () => ({
  transactionId: 'transaction-1',
  expiresAt,
  state,
  nextAction: {
    AUTHENTICATING: 'authenticate',
    MFA_REQUIRED: 'mfa',
    AUTHENTICATED: 'complete',
    COMPLETED: 'none',
  }[state],
})
const callback = () =>
  `${config.redirectUri}#${new URLSearchParams({
    kind: 'AUTH_PROOF',
    auth_transaction_id: 'transaction-1',
    method: 'EMAIL_MAGIC_LINK',
    state: create.state,
    proof: 'single-use-proof',
  })}`
beforeEach(() => {
  storage.clear()
  calls = []
  mfa = false
  intercept = undefined
  state = 'AUTHENTICATING'
  expiresAt = new Date(Date.now() + 600_000).toISOString()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit) => {
      const path = new URL(input).pathname
      const body =
        typeof init.body === 'string'
          ? path === '/token'
            ? Object.fromEntries(new URLSearchParams(init.body))
            : JSON.parse(init.body)
          : {}
      const headers = new Headers(init.headers)
      calls.push({ path, body, headers, method: init.method! })
      const override = intercept?.(path)
      if (override) return override
      if (path === '/api/v1/auth/transactions') {
        create = body
        return response({
          transactionId: 'transaction-1',
          controlSecret: control,
          expiresAt,
          nextAction: 'authenticate',
        })
      }
      if (path === '/token')
        return response({
          access_token: 'fixture-token',
          refresh_token: 'fixture-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      expect(headers.get('Authentication-Transaction')).toBe(control)
      if (path.endsWith('/challenges'))
        return response({
          transactionId: 'transaction-1',
          expiresAt,
          nextAction: 'authenticate',
          challengeExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          cooldownSeconds: 30,
        })
      if (path.endsWith('/authenticate'))
        state = mfa ? 'MFA_REQUIRED' : 'AUTHENTICATED'
      if (path.endsWith('/mfa')) state = 'AUTHENTICATED'
      if (path.endsWith('/complete')) {
        state = 'COMPLETED'
        return response({
          kind: 'authorization_code',
          code: 'one-code',
          state: create.state,
          expiresIn: 120,
        })
      }
      if (path.endsWith('/cancel'))
        return response({ ...view(), state: 'CANCELLED', nextAction: 'none' })
      return response(view())
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('primary authentication transaction protocol', () => {
  it.each(['PASSWORD', 'EMAIL_OTP', 'SMS_OTP', 'EMAIL_MAGIC_LINK'] as const)(
    '%s uses exact transaction wire, MFA, complete and real S256 before tokens',
    async (method) => {
      mfa = true
      const tx = await AuthenticationTransaction.start(config)
      expect(create).toMatchObject({
        client_id: config.clientId,
        entryMode: 'CUSTOM',
        redirect_uri: config.redirectUri,
        scope: 'openid email',
        code_challenge_method: 'S256',
      })
      expect(create.state).toMatch(canonical)
      expect(create.nonce).toMatch(canonical)
      expect(() => tx.exchange()).toThrow('AUTH_TRANSACTION_STATE_INVALID')
      const input =
        method === 'PASSWORD'
          ? { method, identifier, password: 'private-password' }
          : { method, identifier, proof: 'private-proof' }
      if (method !== 'PASSWORD') {
        expect(await tx.challenge(method, identifier)).toMatchObject({
          cooldownSeconds: 30,
        })
      }
      expect(await tx.authenticate(input)).toMatchObject({
        state: 'MFA_REQUIRED',
      })
      expect(() => tx.exchange()).toThrow('AUTH_TRANSACTION_STATE_INVALID')
      expect(calls.some((call) => call.path === '/token')).toBe(false)
      await tx.verifyMfa('RECOVERY_CODE', 'one-recovery-code')
      const tokens = await tx.exchange()
      expect(tokens.access_token).toBe('fixture-token')
      const exchange = calls.find((call) => call.path === '/token')!
      expect(exchange.body).toEqual({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code: 'one-code',
        redirect_uri: config.redirectUri,
        code_verifier: expect.stringMatching(canonical),
      })
      expect(create.code_challenge).toBe(
        createHash('sha256')
          .update(exchange.body.code_verifier)
          .digest('base64url'),
      )
      for (const call of calls.filter(
        (call) =>
          /\/(mfa|complete)$/.test(call.path) ||
          (method !== 'PASSWORD' && call.path.endsWith('/authenticate')),
      )) {
        expect(call.headers.get('Idempotency-Key')).toMatch(canonical)
      }
      expect(
        calls.find((call) => call.path.endsWith('/authenticate'))!.body,
      ).toEqual(input)
      expect(
        calls.every(
          (call) =>
            call.path === '/token' ||
            call.path.startsWith('/api/v1/auth/transactions'),
        ),
      ).toBe(true)
      expect(JSON.stringify(tx.getSnapshot())).not.toMatch(
        /private|fixture-token|controlSecret|verifier/,
      )
      expect(() => tx.exchange()).toThrow('AUTH_TRANSACTION_INVALIDATED')
    },
  )
  it('does not send nonce for non-openid scopes and rejects duplicate scopes before I/O', async () => {
    await AuthenticationTransaction.start({ ...config, scopes: ['email'] })
    expect(create).not.toHaveProperty('nonce')
    await expect(
      AuthenticationTransaction.start({
        ...config,
        scopes: ['email', 'email'],
      }),
    ).rejects.toMatchObject({ code: 'AUTH_CONFIGURATION_INVALID' })
    expect(calls).toHaveLength(1)
  })
  it.each(['authenticate', 'mfa', 'complete'] as const)(
    'retries uncertain %s with identical bytes/key and blocks another action',
    async (action) => {
      mfa = action === 'mfa'
      const tx = await AuthenticationTransaction.start(config)
      const authenticate = () =>
        tx.authenticate({ method: 'EMAIL_OTP', identifier, proof: '123456' })
      if (action !== 'authenticate') await authenticate()
      let lost = true
      intercept = (path) => {
        if (lost && path.endsWith(`/${action}`)) {
          lost = false
          if (action === 'complete') state = 'COMPLETED'
          throw new TypeError('lost response')
        }
        return undefined
      }
      const invoke = () =>
        action === 'authenticate'
          ? authenticate()
          : action === 'mfa'
            ? tx.verifyMfa('TOTP', '123456')
            : tx.exchange()
      await expect(invoke()).rejects.toMatchObject({
        code: 'AUTH_TRANSACTION_UNCERTAIN',
      })
      if (action === 'authenticate') {
        await expect(
          tx.authenticate({ method: 'EMAIL_OTP', identifier, proof: '654321' }),
        ).rejects.toMatchObject({ code: 'AUTH_TRANSACTION_RETRY_REQUIRED' })
      }
      if (action === 'complete') {
        expect(await tx.get()).toMatchObject({ state: 'COMPLETED' })
      }
      await invoke()
      const attempts = calls.filter((call) => call.path.endsWith(`/${action}`))
      expect(attempts).toHaveLength(2)
      expect(attempts[0].body).toEqual(attempts[1].body)
      expect(attempts[0].headers.get('Idempotency-Key')).toBe(
        attempts[1].headers.get('Idempotency-Key'),
      )
      expect(calls.filter((call) => call.path === '/token')).toHaveLength(
        action === 'complete' ? 1 : 0,
      )
    },
  )
  it.each(['network', 'server', 'json', 'tokens'] as const)(
    'never repeats token exchange after uncertain %s result',
    async (kind) => {
      const tx = await AuthenticationTransaction.start(config)
      await tx.authenticate({
        method: 'PASSWORD',
        identifier,
        password: 'secret',
      })
      intercept = (path) => {
        if (path !== '/token') return undefined
        if (kind === 'network') throw new TypeError('lost')
        if (kind === 'server') return response({}, 503)
        if (kind === 'json') return new Response('invalid JSON')
        return response({ access_token: 'fixture-token', expires_in: 0 })
      }
      await expect(tx.exchange()).rejects.toMatchObject({
        code: 'TOKEN_EXCHANGE_UNCERTAIN',
      })
      expect(() => tx.exchange()).toThrow('AUTH_TRANSACTION_INVALIDATED')
      expect(calls.filter((call) => call.path === '/token')).toHaveLength(1)
    },
  )
  it('rejects completion state mismatch without token I/O', async () => {
    const tx = await AuthenticationTransaction.start(config)
    await tx.authenticate({
      method: 'PASSWORD',
      identifier,
      password: 'secret',
    })
    intercept = (path) =>
      path.endsWith('/complete')
        ? response({
            kind: 'authorization_code',
            code: 'bad',
            state: 'other',
            expiresIn: 100,
          })
        : undefined
    await expect(tx.exchange()).rejects.toMatchObject({
      code: 'AUTH_TRANSACTION_INVALID_RESPONSE',
    })
    expect(calls.some((call) => call.path === '/token')).toBe(false)
  })
  it('coalesces equal calls, rejects concurrent GET and refuses late responses after cancel', async () => {
    const tx = await AuthenticationTransaction.start(config)
    const base = globalThis.fetch
    let release!: (value: Response) => void
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      url.endsWith('/authenticate')
        ? new Promise<Response>((resolve) => {
            release = resolve
          })
        : base(url, init),
    )
    const input = {
      method: 'PASSWORD',
      identifier,
      password: 'secret',
    } as const
    const first = tx.authenticate(input),
      second = tx.authenticate(input)
    await expect(tx.get()).rejects.toMatchObject({
      code: 'AUTH_TRANSACTION_BUSY',
    })
    const rejected = Promise.all([
      expect(first).rejects.toMatchObject({
        code: 'AUTH_TRANSACTION_INVALIDATED',
      }),
      expect(second).rejects.toMatchObject({
        code: 'AUTH_TRANSACTION_INVALIDATED',
      }),
    ])
    await tx.cancel()
    release(
      response({ ...view(), state: 'AUTHENTICATED', nextAction: 'complete' }),
    )
    await rejected
    expect(() => tx.authenticate(input)).toThrow('AUTH_TRANSACTION_INVALIDATED')
  })
  it('rejects owner change and original absolute expiry without renewing the transaction', async () => {
    let owner = 1
    const tx = await AuthenticationTransaction.start({
      ...config,
      assertOwner: () => {
        if (owner !== 1) throw new Error('OWNER_CHANGED')
      },
    })
    owner = 2
    expect(() => tx.get()).toThrow('OWNER_CHANGED')
    const next = await AuthenticationTransaction.start(config)
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt))
    expect(() => next.get()).toThrow('AUTH_TRANSACTION_EXPIRED')
    expect(next.getSnapshot().expiresAt).toBe(expiresAt)
  })
})

describe('magic link original tab control', () => {
  it('persists only explicit pending control, restores once, and continues MFA/PKCE', async () => {
    mfa = true
    const tx = await AuthenticationTransaction.start(config)
    expect(storage.size).toBe(0)
    tx.persistForNavigation()
    const saved = storage.get(pendingKey)!
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual(
      [
        'version',
        'issuer',
        'clientId',
        'redirectUri',
        'entryMode',
        'flowOwner',
        'transactionId',
        'controlSecret',
        'verifier',
        'state',
        'expiresAt',
      ].sort(),
    )
    expect(saved).not.toMatch(
      /user@example|password|access_token|refresh_token|proof/,
    )
    tx.invalidate(true)
    const restored = AuthenticationTransaction.restoreMagicLink(
      config,
      callback(),
    )
    expect(storage.size).toBe(0)
    expect(() =>
      AuthenticationTransaction.restoreMagicLink(config, callback()),
    ).toThrow('AUTH_CONTROL_LOST')
    expect(
      await restored.authenticateMagicLink(callback(), identifier),
    ).toMatchObject({ state: 'MFA_REQUIRED' })
    expect(calls.some((call) => call.path === '/token')).toBe(false)
    await restored.verifyMfa('TOTP', '123456')
    await restored.exchange()
    expect(calls.filter((call) => call.path === '/token')).toHaveLength(1)
  })
  it.each([
    'state',
    'transaction',
    'redirect',
    'duplicate',
    'kind',
    'missing-control',
    'expired',
  ] as const)('rejects %s callback before proof/network use', async (mode) => {
    const tx = await AuthenticationTransaction.start(config)
    tx.persistForNavigation()
    const url = new URL(callback()),
      params = new URLSearchParams(url.hash.slice(1))
    if (mode === 'state') params.set('state', 'other')
    if (mode === 'transaction') params.set('auth_transaction_id', 'other')
    if (mode === 'redirect') url.pathname = '/other'
    if (mode === 'duplicate') params.append('proof', 'second')
    if (mode === 'kind') params.set('kind', 'OTHER')
    if (mode === 'missing-control') storage.clear()
    if (mode === 'expired')
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(expiresAt))
    url.hash = params.toString()
    expect(() =>
      AuthenticationTransaction.restoreMagicLink(config, url.href),
    ).toThrow()
    expect(calls).toHaveLength(1)
  })
  it('reports storage failure and clears deliberate navigation state on cancellation', async () => {
    const tx = await AuthenticationTransaction.start(config)
    tx.persistForNavigation()
    await tx.cancel()
    expect(storage.size).toBe(0)
    const next = await AuthenticationTransaction.start(config)
    vi.stubGlobal('sessionStorage', {
      setItem() {
        throw new Error('denied')
      },
    })
    expect(() => next.persistForNavigation()).toThrow(
      'AUTH_PENDING_STORAGE_UNAVAILABLE',
    )
  })
})
