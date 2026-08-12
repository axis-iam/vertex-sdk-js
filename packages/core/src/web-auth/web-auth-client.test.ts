import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  WebAuthClient,
  WebAuthError,
  type WebAuthSession,
  type WebAuthSessionStore,
  type WebAuthTransaction,
  type WebAuthTransactionStore,
} from './web-auth-client.js'

const ISSUER = 'https://auth.example.test'
const APP_ORIGIN = 'https://app.example.test'

class TransactionStore implements WebAuthTransactionStore {
  readonly values = new Map<string, WebAuthTransaction>()

  async save(id: string, value: WebAuthTransaction): Promise<void> {
    this.values.set(id, value)
  }

  async consume(id: string): Promise<WebAuthTransaction | null> {
    const value = this.values.get(id) ?? null
    this.values.delete(id)
    return value
  }
}

class SessionStore implements WebAuthSessionStore {
  readonly values = new Map<string, WebAuthSession>()

  async create(id: string, value: WebAuthSession): Promise<void> {
    this.values.set(id, value)
  }

  async read(id: string): Promise<WebAuthSession | null> {
    return this.values.get(id) ?? null
  }

  async replace(id: string, expectedRevision: string, value: WebAuthSession): Promise<boolean> {
    if (this.values.get(id)?.revision !== expectedRevision) return false
    this.values.set(id, value)
    return true
  }

  async delete(id: string): Promise<void> {
    this.values.delete(id)
  }
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fixture(overrides: Record<string, unknown> = {}) {
  const transactions = new TransactionStore()
  const sessions = new SessionStore()
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration')) {
      return response({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        jwks_uri: `${ISSUER}/oauth2/jwks`,
        end_session_endpoint: `${ISSUER}/connect/logout`,
      })
    }
    const body = new URLSearchParams(String(init?.body))
    if (body.get('grant_type') === 'refresh_token') {
      return response({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        id_token: 'id-2',
        token_type: 'Bearer',
        expires_in: 300,
      })
    }
    return response({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      id_token: 'id-1',
      token_type: 'Bearer',
      expires_in: 300,
      scope: 'openid offline_access',
    })
  })
  const client = new WebAuthClient({
    issuer: ISSUER,
    clientId: 'web-client',
    clientSecret: 'client-secret-value',
    redirectUri: `${APP_ORIGIN}/auth/callback`,
    applicationOrigin: APP_ORIGIN,
    successRedirect: '/dashboard',
    postLogoutRedirect: '/signed-out',
    transactionStore: transactions,
    sessionStore: sessions,
    fetch,
    now: () => 1_800_000_000_000,
    ...overrides,
  })
  return { client, transactions, sessions, fetch }
}

describe('WebAuthClient', () => {
  it.each([
    { clientSecret: '' },
    { issuer: 'http://auth.example.test' },
    { redirectUri: 'https://other.example.test/callback' },
    { successRedirect: '//evil.example.test' },
    { postLogoutRedirect: 'javascript:alert(1)' },
    { scopes: [] },
    { transactionTtlSeconds: 0 },
  ])('rejects invalid configuration at construction: %o', override => {
    expect(() => fixture(override)).toThrow(WebAuthError)
  })

  it('creates and stores a one-time S256 transaction using discovered endpoints', async () => {
    const { client, transactions } = fixture()
    const result = await client.beginLogin()
    const url = new URL(result.authorizationUrl)
    const transaction = transactions.values.get(result.transactionId)

    expect(url.origin + url.pathname).toBe(`${ISSUER}/oauth2/authorize`)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('web-client')
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP_ORIGIN}/auth/callback`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe(transaction?.state)
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(transaction?.codeVerifier ?? '').digest('base64url'),
    )
    expect(result.transactionId).not.toBe(transaction?.state)
  })

  it('consumes the transaction before confidential Basic code exchange and creates a session', async () => {
    const { client, transactions, sessions, fetch } = fixture()
    const login = await client.beginLogin()
    const transaction = transactions.values.get(login.transactionId)!
    const result = await client.handleCallback({
      transactionId: login.transactionId,
      state: transaction.state,
      code: 'authorization-code',
    })

    expect(transactions.values.has(login.transactionId)).toBe(false)
    expect(sessions.values.get(result.sessionId)?.tokens.refreshToken).toBe('refresh-1')
    const tokenCall = fetch.mock.calls.find(call => String(call[0]).endsWith('/oauth2/token'))!
    expect(new Headers(tokenCall[1]?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('web-client:client-secret-value').toString('base64')}`,
    )
    const body = new URLSearchParams(String(tokenCall[1]?.body))
    expect(body.get('code_verifier')).toBe(transaction.codeVerifier)
    expect(body.has('client_secret')).toBe(false)
    expect(body.has('client_id')).toBe(false)
  })

  it('fails callback replay and state mismatch without creating a session', async () => {
    const { client, transactions, sessions } = fixture()
    const login = await client.beginLogin()
    const transaction = transactions.values.get(login.transactionId)!

    await expect(client.handleCallback({
      transactionId: login.transactionId,
      state: 'wrong-state',
      code: 'code',
    })).rejects.toMatchObject({ code: 'CALLBACK_INVALID' })
    await expect(client.handleCallback({
      transactionId: login.transactionId,
      state: transaction.state,
      code: 'code',
    })).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' })
    expect(sessions.values.size).toBe(0)
  })

  it('consumes expired and OAuth-error callbacks without reflecting provider text', async () => {
    const { client, transactions } = fixture()
    const login = await client.beginLogin()
    const transaction = transactions.values.get(login.transactionId)!
    transactions.values.set(login.transactionId, { ...transaction, expiresAt: 1_799_999_999_999 })
    await expect(client.handleCallback({
      transactionId: login.transactionId,
      state: transaction.state,
      code: 'code',
    })).rejects.toMatchObject({ code: 'TRANSACTION_EXPIRED' })

    const second = await client.beginLogin()
    const secondTransaction = transactions.values.get(second.transactionId)!
    const error = await client.handleCallback({
      transactionId: second.transactionId,
      state: secondTransaction.state,
      error: 'access_denied',
      errorDescription: 'provider secret detail',
    }).catch(value => value)
    expect(error).toMatchObject({ code: 'CALLBACK_OAUTH_ERROR' })
    expect(JSON.stringify(error)).not.toContain('provider secret detail')
  })

  it('rejects malformed token responses with sanitized errors', async () => {
    const { client, transactions, fetch } = fixture()
    fetch.mockImplementation(async input => String(input).includes('openid-configuration')
      ? response({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` })
      : response({ access_token: 'leaked-upstream-token', token_type: 'bearer' }))
    const login = await client.beginLogin()
    const transaction = transactions.values.get(login.transactionId)!
    const error = await client.handleCallback({ transactionId: login.transactionId, state: transaction.state, code: 'code' }).catch(value => value)
    expect(error).toMatchObject({ code: 'TOKEN_RESPONSE_INVALID' })
    expect(JSON.stringify(error)).not.toContain('leaked-upstream-token')
  })

  it('requires refresh-token rotation and atomically replaces the session', async () => {
    const { client, transactions, sessions, fetch } = fixture()
    const login = await client.beginLogin()
    const transaction = transactions.values.get(login.transactionId)!
    const callback = await client.handleCallback({ transactionId: login.transactionId, state: transaction.state, code: 'code' })
    const oldRevision = sessions.values.get(callback.sessionId)!.revision
    const refreshed = await client.refresh({ sessionId: callback.sessionId })

    expect(refreshed.session.tokens.refreshToken).toBe('refresh-2')
    expect(refreshed.session.revision).not.toBe(oldRevision)
    const refreshCall = fetch.mock.calls.at(-1)!
    expect(new URLSearchParams(String(refreshCall[1]?.body)).get('refresh_token')).toBe('refresh-1')

    fetch.mockResolvedValueOnce(response({ access_token: 'access-3', refresh_token: 'refresh-2', token_type: 'Bearer', expires_in: 300 }))
    await expect(client.refresh({ sessionId: callback.sessionId })).rejects.toMatchObject({ code: 'REFRESH_FAILED' })
  })

  it('deletes local authority before returning an optional end-session URL', async () => {
    const { client, sessions } = fixture()
    sessions.values.set('session-id', {
      revision: 'revision',
      tokens: { accessToken: 'access', refreshToken: 'refresh', idToken: 'id-token', tokenType: 'Bearer', expiresAt: 1_800_000_300_000 },
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      expiresAt: 1_800_003_600_000,
    })
    const result = await client.logout({ sessionId: 'session-id' })
    expect(sessions.values.has('session-id')).toBe(false)
    expect(result.redirectUrl).toContain(`${ISSUER}/connect/logout`)
    expect(result.redirectUrl).toContain(encodeURIComponent(`${APP_ORIGIN}/signed-out`))
    expect(result.redirectUrl).not.toContain('id-token')
  })
})
