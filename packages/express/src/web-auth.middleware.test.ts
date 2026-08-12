import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { createWebAuth } from './web-auth.middleware.js'
import type { WebAuthSession, WebAuthSessionStore, WebAuthTransaction, WebAuthTransactionStore } from '@axis-iam/vertex/server'

const SESSION_ID = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'

class TransactionStore implements WebAuthTransactionStore {
  readonly values = new Map<string, WebAuthTransaction>()
  async save(id: string, value: WebAuthTransaction) { this.values.set(id, value) }
  async consume(id: string) { const value = this.values.get(id) ?? null; this.values.delete(id); return value }
}

class SessionStore implements WebAuthSessionStore {
  readonly values = new Map<string, WebAuthSession>()
  async create(id: string, value: WebAuthSession) { this.values.set(id, value) }
  async read(id: string) { return this.values.get(id) ?? null }
  async replace(id: string, expected: string, value: WebAuthSession) {
    if (this.values.get(id)?.revision !== expected) return false
    this.values.set(id, value); return true
  }
  async delete(id: string) { this.values.delete(id) }
}

function oidc(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fixture() {
  const transactionStore = new TransactionStore()
  const sessionStore = new SessionStore()
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('openid-configuration')) return oidc({
      issuer: 'https://auth.example.test',
      authorization_endpoint: 'https://auth.example.test/authorize',
      token_endpoint: 'https://auth.example.test/token',
      jwks_uri: 'https://auth.example.test/jwks',
      end_session_endpoint: 'https://auth.example.test/logout',
    })
    const form = new URLSearchParams(String(init?.body))
    return form.get('grant_type') === 'refresh_token'
      ? oidc({ access_token: 'access-2', refresh_token: 'refresh-2', id_token: 'id-2', token_type: 'Bearer', expires_in: 300 })
      : oidc({ access_token: 'access-1', refresh_token: 'refresh-1', id_token: 'id-1', token_type: 'Bearer', expires_in: 300 })
  })
  const auth = createWebAuth({
    issuer: 'https://auth.example.test',
    clientId: 'web-client',
    clientSecret: 'secret-value',
    redirectUri: 'https://app.example.test/auth/callback',
    applicationOrigin: 'https://app.example.test',
    successRedirect: '/dashboard',
    postLogoutRedirect: '/signed-out',
    transactionStore,
    sessionStore,
    fetch,
    now: () => 1_800_000_000_000,
  })
  return { auth, transactionStore, sessionStore }
}

function reqRes(cookie = '', query: Record<string, unknown> = {}) {
  const req = { headers: { cookie }, query } as unknown as Request
  const res = {
    cookie: vi.fn().mockReturnThis(), clearCookie: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(),
  } as unknown as Response
  return { req, res, next: vi.fn() }
}

describe('createWebAuth', () => {
  it('login stores a transaction and emits only a secure opaque cookie', async () => {
    const { auth, transactionStore } = fixture()
    const { req, res, next } = reqRes()
    await auth.login(req, res, next)
    const [name, value, options] = vi.mocked(res.cookie).mock.calls[0]!
    expect(name).toBe('__Secure-axis_vertex_tx')
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/callback' })
    expect(transactionStore.values.has(String(value))).toBe(true)
    expect(String(value)).not.toContain('secret')
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('code_challenge_method=S256'))
  })

  it('callback creates an opaque session cookie and rejects replay', async () => {
    const { auth, transactionStore, sessionStore } = fixture()
    const login = reqRes(); await auth.login(login.req, login.res, login.next)
    const transactionId = String(vi.mocked(login.res.cookie).mock.calls[0]![1])
    const state = transactionStore.values.get(transactionId)!.state
    const callback = reqRes(`__Secure-axis_vertex_tx=${transactionId}`, { state, code: 'code' })
    await auth.callback(callback.req, callback.res, callback.next)
    const sessionCookie = vi.mocked(callback.res.cookie).mock.calls.find(call => call[0] === '__Host-axis_vertex_session')!
    expect(sessionCookie[2]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(sessionStore.values.has(String(sessionCookie[1]))).toBe(true)
    expect(String(sessionCookie[1])).not.toContain('access-1')
    expect(callback.res.redirect).toHaveBeenCalledWith('https://app.example.test/dashboard')

    const replay = reqRes(`__Secure-axis_vertex_tx=${transactionId}`, { state, code: 'code' })
    await auth.callback(replay.req, replay.res, replay.next)
    expect(replay.res.status).toHaveBeenCalledWith(400)
    expect(sessionStore.values.size).toBe(1)
  })

  it('sanitizes OAuth callback errors and creates no session', async () => {
    const { auth, transactionStore, sessionStore } = fixture()
    const login = reqRes(); await auth.login(login.req, login.res, login.next)
    const transactionId = String(vi.mocked(login.res.cookie).mock.calls[0]![1])
    const state = transactionStore.values.get(transactionId)!.state
    const callback = reqRes(`__Secure-axis_vertex_tx=${transactionId}`, { state, error: 'access_denied', error_description: 'secret provider body' })
    await auth.callback(callback.req, callback.res, callback.next)
    expect(callback.res.status).toHaveBeenCalledWith(400)
    expect(JSON.stringify(vi.mocked(callback.res.json).mock.calls)).not.toContain('secret provider body')
    expect(sessionStore.values.size).toBe(0)
  })

  it('requireSession attaches an explicit server-only view and otherwise returns 401', async () => {
    const { auth, sessionStore } = fixture()
    sessionStore.values.set(SESSION_ID, {
      revision: 'revision', tokens: { accessToken: 'server-access', refreshToken: 'server-refresh', tokenType: 'Bearer', expiresAt: 1_800_000_300_000 },
      createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, expiresAt: 1_800_003_600_000,
    })
    const valid = reqRes(`__Host-axis_vertex_session=${SESSION_ID}`)
    await auth.requireSession(valid.req, valid.res, valid.next)
    expect(valid.next).toHaveBeenCalledOnce()
    expect(valid.req.webAuthSession).toEqual({ id: SESSION_ID, accessToken: 'server-access', expiresAt: 1_800_003_600_000 })
    expect(valid.req.webAuthSession).not.toHaveProperty('refreshToken')

    const missing = reqRes()
    await auth.requireSession(missing.req, missing.res, missing.next)
    expect(missing.res.status).toHaveBeenCalledWith(401)
    expect(missing.next).not.toHaveBeenCalled()
  })

  it('refresh rotates server state without returning tokens', async () => {
    const { auth, sessionStore } = fixture()
    sessionStore.values.set(SESSION_ID, {
      revision: 'revision', tokens: { accessToken: 'access-1', refreshToken: 'refresh-1', tokenType: 'Bearer', expiresAt: 1_800_000_300_000 },
      createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, expiresAt: 1_800_003_600_000,
    })
    const request = reqRes(`__Host-axis_vertex_session=${SESSION_ID}`)
    await auth.refresh(request.req, request.res, request.next)
    expect(sessionStore.values.get(SESSION_ID)?.tokens.refreshToken).toBe('refresh-2')
    expect(request.res.json).toHaveBeenCalledWith({ ok: true })
    expect(JSON.stringify(vi.mocked(request.res.json).mock.calls)).not.toContain('access-2')
  })

  it('logout clears local authority and cookie before redirecting upstream', async () => {
    const { auth, sessionStore } = fixture()
    sessionStore.values.set(SESSION_ID, {
      revision: 'revision', tokens: { accessToken: 'access', refreshToken: 'refresh', idToken: 'id-token', tokenType: 'Bearer', expiresAt: 1_800_000_300_000 },
      createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, expiresAt: 1_800_003_600_000,
    })
    const request = reqRes(`__Host-axis_vertex_session=${SESSION_ID}`)
    await auth.logout(request.req, request.res, request.next)
    expect(sessionStore.values.has(SESSION_ID)).toBe(false)
    expect(request.res.clearCookie).toHaveBeenCalledWith('__Host-axis_vertex_session', expect.objectContaining({ path: '/', secure: true }))
    expect(request.res.redirect).toHaveBeenCalledWith(expect.stringContaining('https://auth.example.test/logout'))
  })
})
