import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const random = () => randomBytes(32).toString('base64url')
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const redirect = (res, location) => { res.writeHead(302, { Location: location }); res.end() }
const body = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks).toString() }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const loseResponse = res => {
  // Headers received, body lost: Chromium must not transparently retry a reset pooled POST.
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000' })
  res.flushHeaders()
  res.write('{')
  setTimeout(() => res.destroy(), 10)
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})
const restrictions = { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }
const profile = c => ({
  id: c.user, email: null, username: null, status: 'ACTIVE', emailVerified: true, metadata: {},
  authenticationContext: { subjectType: 'USER', applicationId: 'fixture-app', clientId: c.clientId,
    sessionId: `session-${c.user}`, workspaceId: null, workspaceSelectionRequired: true,
    organizationId: null, organizationSlug: null, organizationRole: null, authTime: null,
    authenticationMethods: [], assuranceLevel: null, impersonation: null },
})
const permissions = () => ({ applicationId: 'fixture-app', organizationId: null, roles: [], permissions: [] })
const methods = c => ({
  clientId: c.clientId, identifierRestrictions: restrictions,
  passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: false,
  socialLoginEnabled: true, signupEnabled: true, selfRegistrationEnabled: true, idpAutoProvisioningEnabled: true,
  loginInitiationUri: null, postVerificationRedirectUri: null,
  defaultIdentifierKind: 'EMAIL', defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
  allowedSignupIdentifierKinds: ['EMAIL'], allowedPasswordIdentifierKinds: ['EMAIL'],
  identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP'] }],
  methods: ['PASSWORD', 'EMAIL_OTP'].map(type => ({ type, enabled: true, configured: true, availableForLogin: true, availableForSignup: type === 'PASSWORD', unavailableReason: null })),
  idpProviders: [{ id: 'provider', providerType: 'OIDC', displayName: 'Controlled Provider', enabled: true, configured: true, clickable: true, availableForLogin: true, availableForSignup: true, unavailableReason: null, authorizationUrl: c.issuer }],
  resend: { emailVerificationCooldownSeconds: 30 },
})
const policy = () => ({
  identifierRestrictions: restrictions, defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
  allowedSignupIdentifierKinds: ['EMAIL'], allowedPasswordIdentifierKinds: ['EMAIL'],
  passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: false,
  socialLoginEnabled: true, smsAutoProvisioningEnabled: false, minPasswordLength: 8,
  requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecialChar: false, breachedPasswordCheck: false,
  totpEnabled: true, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [],
  deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false,
  idpAutoProvisioningEnabled: true, signupMode: 'OPEN', allowedRegistrationGrantTypes: ['ACCESS_CODE'],
})

/** Controlled protocol only: no external identities, existing accounts or shared services. */
export async function createFixture(consumer) {
  const cases = new Map(), transactions = new Map(), codes = new Map(), tokens = new Map()
  const errors = []
  const count = (c, action) => { c.counts[action] = (c.counts[action] ?? 0) + 1 }
  let origin, providerOrigin
  const view = tx => ({
    transactionId: tx.id, expiresAt: tx.expiresAt, state: tx.state,
    nextAction: { AUTHENTICATING: 'authenticate', AWAITING_PROVIDER: 'authorize', MFA_REQUIRED: 'mfa', AUTHENTICATED: 'complete', COMPLETED: 'none', CANCELLED: 'none', REJECTED: 'none' }[tx.state],
  })
  function issue(c, tx) {
    if (tx.code) return tx.code
    tx.code = random()
    codes.set(tx.code, { c, tx, used: false })
    return tx.code
  }
  const callback = (c, tx, denied = false) => {
    const url = new URL(c.redirectUri)
    if (denied) { tx.state = 'REJECTED'; url.searchParams.set('error', 'access_denied') }
    else if (c.mfa) {
      tx.state = 'MFA_REQUIRED'
      url.searchParams.set('kind', 'AUTH_CONTINUATION')
      url.searchParams.set('auth_transaction_id', tx.id)
    } else { tx.state = 'COMPLETED'; url.searchParams.set('code', issue(c, tx)) }
    url.searchParams.set('state', c.wrongState ? random() : tx.binding.state)
    return url.href
  }
  const provider = createServer(async (req, res) => {
    const url = new URL(req.url, providerOrigin)
    const c = cases.get(url.searchParams.get('case'))
    const tx = transactions.get(url.searchParams.get('tx'))
    if (!c || !tx) return json(res, {}, 404)
    if (url.pathname === '/provider')
      return res.end(`<!doctype html><title>Controlled protocol provider</title><p>Dedicated test identity</p><a href="/approve?case=${c.id}&tx=${tx.id}">Approve controlled identity</a><a href="/deny?case=${c.id}&tx=${tx.id}">Decline</a>`)
    if (c.mode === 'server_session') {
      c.bffState = c.mfa ? 'MFA_REQUIRED' : 'AUTHENTICATED'
      c.bffAuthenticated = !c.mfa
      return redirect(res, c.redirectUri)
    }
    redirect(res, callback(c, tx, url.pathname === '/deny'))
  })
  providerOrigin = await listen(provider)
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin)
      if (url.pathname === '/browser.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' })
        return res.end(await readFile(join(consumer, 'browser.js')))
      }
      if (url.pathname.startsWith('/app/') || url.pathname.startsWith('/callback/')) {
        const c = cases.get(url.pathname.split('/').at(-1))
        if (!c) return json(res, {}, 404)
        const config = JSON.stringify({ id: c.id, issuer: c.issuer, clientId: c.clientId, redirectUri: c.redirectUri,
          entry: c.entry, navigation: c.navigation, theme: c.theme, locale: c.locale, mode: c.mode, timeoutMs: c.timeoutMs }).replaceAll('<', '\\u003c')
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packed SDK authentication recovery</title><style>body{margin:0;padding:24px;font-family:Arial,sans-serif}output{display:block}#app{max-width:720px;margin:auto}input{max-width:100%}</style><main id="app"></main><script type="application/json" id="auth-recovery-config">${config}</script><script type="module" src="/browser.js"></script>`)
      }
      if (url.pathname.includes('branding')) return json(res, {}, 404)
      const issuerId = url.pathname.split('/')[2]
      const issuerCase = cases.get(issuerId) ?? [...cases.values()].find(c => c.issuer === `${origin}/issuer/${issuerId}`)
      const queryCase = [...cases.values()].find(c => c.clientId === url.searchParams.get('client_id'))
      const metadataClient = url.pathname.split('/apps/')[1]?.split('/')[0]
      const metadataCase = [...cases.values()].find(c => c.clientId === metadataClient && c.issuer === `${origin}/issuer/${issuerId}`)
      if (url.pathname.endsWith('openid-configuration') && issuerCase)
        return json(res, { issuer: issuerCase.issuer, authorization_endpoint: `${origin}/hosted/${issuerCase.id}`,
          token_endpoint: `${origin}/issuer/${issuerCase.id}/token`, userinfo_endpoint: `${origin}/unused`,
          jwks_uri: `${origin}/unused-jwks` })
      if (url.pathname.includes('auth-methods') && (issuerCase || queryCase)) return json(res, methods(metadataCase ?? issuerCase ?? queryCase))
      if (url.pathname.includes('auth-policy') && (issuerCase || queryCase)) return json(res, policy())
      if (url.pathname.startsWith('/hosted/')) {
        const c = cases.get(url.pathname.split('/')[2])
        count(c, 'hosted')
        const tx = { id: random(), binding: Object.fromEntries(url.searchParams), state: 'COMPLETED', expiresAt: new Date(Date.now() + 600000).toISOString() }
        transactions.set(tx.id, tx)
        return redirect(res, callback(c, tx))
      }
      if (url.pathname.startsWith('/bff/')) {
        const c = cases.get(url.pathname.split('/')[2])
        const action = url.pathname.split('/').at(-1)
        count(c, `bff:${action}`)
        if (action === 'auth-methods') return json(res, methods(c))
        if (action === 'auth-policy') return json(res, policy())
        const safe = () => c.bffAuthenticated ? {
          state: 'AUTHENTICATED', expiresAt: c.expiresAt, csrfToken: c.csrf, owner: c.owner, version: 1,
          profile: profile(c), permissions: permissions(),
        } : { state: c.bffState, expiresAt: c.expiresAt, csrfToken: c.csrf,
          nextAction: { PRELOGIN: 'authenticate', AUTHENTICATING: 'authenticate', MFA_REQUIRED: 'mfa', AUTHENTICATED: 'complete', AWAITING_PROVIDER: 'authorize' }[c.bffState] }
        if (req.method === 'POST' && req.headers['x-csrf-token'] !== c.csrf) return json(res, { error: 'SESSION_CSRF_REQUIRED' }, 403)
        if (action === 'login') c.bffState = 'AUTHENTICATING'
        if (action === 'authenticate') { await body(req); c.bffState = c.mfa ? 'MFA_REQUIRED' : 'AUTHENTICATED' }
        if (action === 'mfa') { await body(req); c.bffState = 'AUTHENTICATED' }
        if (action === 'complete') { c.bffAuthenticated = true; c.bffState = 'AUTHENTICATED' }
        if (action === 'authorize') {
          await body(req)
          c.bffState = 'AWAITING_PROVIDER'
          const tx = { id: random(), binding: {}, expiresAt: c.expiresAt, state: 'AWAITING_PROVIDER' }
          transactions.set(tx.id, tx)
          return json(res, { ...safe(), authorizationUrl: `${providerOrigin}/provider?case=${c.id}&tx=${tx.id}` })
        }
        if (action === 'cancel' || action === 'logout') { c.bffState = 'PRELOGIN'; c.bffAuthenticated = false }
        return json(res, safe())
      }
      if (url.pathname === '/api/v1/auth/transactions') {
        const binding = JSON.parse(await body(req))
        const refererId = new URL(req.headers.referer ?? origin).pathname.split('/').at(-1)
        const c = cases.get(refererId)
        if (!c || binding.entryMode !== 'CUSTOM' || binding.redirect_uri !== c.redirectUri || binding.code_challenge_method !== 'S256')
          return json(res, { error: 'BINDING_INVALID' }, 400)
        count(c, 'create')
        const tx = { id: random(), binding, state: 'AUTHENTICATING', control: random(), expiresAt: new Date(Date.now() + 600000).toISOString(), c }
        transactions.set(tx.id, tx)
        c.lastTx = tx
        return json(res, { transactionId: tx.id, controlSecret: tx.control, expiresAt: tx.expiresAt, nextAction: 'authenticate' })
      }
      if (url.pathname.startsWith('/api/v1/auth/transactions/')) {
        const tx = transactions.get(url.pathname.split('/')[5])
        if (!tx || req.headers['authentication-transaction'] !== tx.control) return json(res, { error: 'BINDING_INVALID' }, 403)
        const c = tx.c
        const action = url.pathname.split('/')[6] ?? 'get'
        count(c, action)
        const input = req.method === 'GET' ? {} : JSON.parse(await body(req))
        if (action === 'authenticate') {
          if (c.rejectPassword) return json(res, { error: 'INVALID_CREDENTIALS' }, 401)
          tx.state = c.mfa ? 'MFA_REQUIRED' : 'AUTHENTICATED'
        }
        if (action === 'mfa') { if (!input.code) return json(res, {}, 400); tx.state = 'AUTHENTICATED' }
        if (action === 'cancel') tx.state = 'CANCELLED'
        if (action === 'authorize') {
          if (input.providerId !== 'provider') return json(res, {}, 400)
          tx.state = 'AWAITING_PROVIDER'
          return json(res, { authorizationUrl: `${providerOrigin}/provider?case=${c.id}&tx=${tx.id}`, expiresAt: tx.expiresAt })
        }
        if (action === 'complete') {
          const key = req.headers['idempotency-key']
          if (!key || tx.completeKey && tx.completeKey !== key) return json(res, { error: 'KEY_CHANGED' }, 409)
          tx.completeKey = key
          tx.state = 'COMPLETED'
          issue(c, tx)
          if ((c.loseComplete ?? 0) >= c.counts.complete) return loseResponse(res)
          return json(res, { kind: 'authorization_code', code: tx.code, state: tx.binding.state, expiresIn: 120 })
        }
        if (action === 'challenges') return json(res, { ...view(tx), nextAction: 'authenticate',
          challengeExpiresAt: new Date(Date.now() + 120000).toISOString(), cooldownSeconds: 30 })
        return json(res, view(tx))
      }
      if (url.pathname.endsWith('/token')) {
        const input = new URLSearchParams(await body(req))
        const issued = codes.get(input.get('code'))
        if (!issued) return json(res, { error: 'invalid_grant' }, 400)
        const { c, tx } = issued
        count(c, 'token')
        const digest = createHash('sha256').update(input.get('code_verifier') ?? '').digest('base64url')
        if (issued.used || input.get('client_id') !== c.clientId || input.get('redirect_uri') !== c.redirectUri ||
            digest !== tx.binding.code_challenge) return json(res, { error: 'invalid_grant' }, 400)
        issued.used = true
        if (c.tokenDelay) await delay(c.tokenDelay)
        const token = random()
        tokens.set(token, c)
        if (c.loseToken) return loseResponse(res)
        return json(res, { access_token: token, token_type: 'Bearer', expires_in: 3600 })
      }
      if (url.pathname.endsWith('/api/v1/auth/me') || url.pathname.endsWith('/api/v1/auth/me/permissions')) {
        const c = tokens.get(req.headers.authorization?.slice(7))
        if (!c) return json(res, { error: 'UNAUTHORIZED' }, 401)
        const action = url.pathname.endsWith('/permissions') ? 'permissions' : 'profile'
        count(c, action)
        if (c.viewDelay) await delay(c.viewDelay)
        if (c.failView === action) return json(res, {}, 503)
        return json(res, action === 'profile' ? profile(c) : permissions())
      }
      if (url.pathname.endsWith('/auth/signup')) {
        const c = cases.get(new URL(req.headers.referer ?? origin).pathname.split('/').at(-1))
        const input = JSON.parse(await body(req))
        if (!c || input.client_id !== c.clientId) return json(res, {}, 400)
        count(c, 'signup')
        return json(res, {
          registrationId: 'controlled-registration', status: 'PENDING_VERIFICATION',
          expiresAt: new Date(Date.now() + 600000).toISOString(), nextAction: 'VERIFY_EMAIL', controlSecret: random(),
        }, 201)
      }
      if (url.pathname.endsWith('/logout')) {
        const token = req.headers.authorization?.slice(7)
        const c = tokens.get(token)
        if (!c) return json(res, { error: 'UNAUTHORIZED' }, 401)
        count(c, 'logout')
        const fail = c.failLogout
        if (c.logoutDelay) await delay(c.logoutDelay)
        if (fail) return json(res, { error: 'TEMPORARILY_UNAVAILABLE' }, 503)
        tokens.delete(token)
        res.writeHead(204); return res.end()
      }
      return json(res, {}, 404)
    } catch (error) {
      errors.push(error.name)
      if (!res.headersSent) json(res, { error: 'FIXTURE_FAILED' }, 500)
      else res.end()
    }
  })
  origin = await listen(server)
  return {
    origin, providerOrigin, errors,
    configure(id, settings = {}) {
      const c = { id, clientId: `client-${id}`, user: 'user-a', entry: 'headless', counts: {},
        csrf: random(), owner: random(), bffState: 'PRELOGIN', expiresAt: new Date(Date.now() + 600000).toISOString(), ...settings }
      c.issuer = `${origin}/issuer/${c.sharedIssuer ? 'shared' : id}`
      c.redirectUri = `${origin}/callback/${id}`
      cases.set(id, c)
      return c
    },
    callback(c) { return callback(c, c.lastTx) },
    async close() {
      await Promise.all([server, provider].map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve) })))
    },
  }
}
