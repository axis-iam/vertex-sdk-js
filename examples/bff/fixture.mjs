// Exclusive local protocol fixture. This is not a real IAM or external delivery proof.
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'
import { flowCapabilities, flowPolicy } from './capabilities.mjs'

export async function startFixture() {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture', alg: 'ES256', use: 'sig' }
  const vectors = JSON.parse(await readFile(new URL('./c0-v1.json', import.meta.url), 'utf8'))
  const profile = vectors.viewVectors[0].value.profile
  const transactions = new Map(), codes = new Map(), ats = new Map(), rts = new Map(), registrations = new Map()
  const counts = { exchanges: 0, refreshes: 0, logout: 0, revoke: 0, validity: 0 }
  let issuer, failValidity = false, failLogout = false, providerMode = 'mfa', tokenFailure = null, identityFailure = false
  const future = (ms = 600000) => new Date(Date.now() + ms).toISOString()
  const view = tx => ({ transactionId: tx.id, state: tx.state, expiresAt: tx.expiresAt,
    nextAction: { AUTHENTICATING: 'authenticate', MFA_REQUIRED: 'mfa', AUTHENTICATED: 'complete',
      AWAITING_PROVIDER: 'authorize', CANCELLED: 'none' }[tx.state] })
  const codeFor = tx => { const code = randomUUID(); codes.set(code, tx); return code }
  const server = createServer(async (req, res) => {
    const send = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
    const error = (code, status = 400) => send({ status, error: code, message: code, timestamp: new Date().toISOString() }, status)
    try {
      const url = new URL(req.url, issuer)
      let raw = ''
      for await (const b of req) raw += b
      const body = raw && req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : {}
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined
      const signed = ats.get(bearer)
      if (url.pathname === '/.well-known/openid-configuration') return send({ issuer, authorization_endpoint: issuer + '/oauth2/authorize',
        token_endpoint: issuer + '/oauth2/token', jwks_uri: issuer + '/jwks' })
      if (url.pathname === '/jwks') return send({ keys: [jwk] })
      if (url.pathname === '/oauth2/authorize') {
        const tx = Object.fromEntries(url.searchParams)
        if (tx.client_id !== 'connected-web' || tx.code_challenge_method !== 'S256' || !tx.nonce) return error('INVALID_REQUEST')
        const target = new URL(tx.redirect_uri)
        target.search = new URLSearchParams({ code: codeFor(tx), state: tx.state }).toString()
        res.writeHead(302, { location: target.href }); res.end(); return
      }
      if (url.pathname === '/oauth2/token') {
        if (tokenFailure) {
          counts.tokenFailures = (counts.tokenFailures ?? 0) + 1
          if (tokenFailure === 'disconnect') { req.socket.destroy(); return }
          return send({ error: tokenFailure.error, error_description: 'private failure detail' }, tokenFailure.status)
        }
        if (req.headers.authorization !== 'Basic ' + Buffer.from('connected-web:fixture-confidential').toString('base64')) return error('invalid_client', 401)
        const form = new URLSearchParams(raw)
        let tx
        if (form.get('grant_type') === 'authorization_code') {
          counts.exchanges++
          tx = codes.get(form.get('code')); codes.delete(form.get('code'))
          if (!tx || form.get('redirect_uri') !== tx.redirect_uri ||
            createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== tx.code_challenge) return error('invalid_grant')
        } else {
          counts.refreshes++
          tx = rts.get(form.get('refresh_token')); rts.delete(form.get('refresh_token'))
          if (!tx) return error('invalid_grant')
        }
        const access_token = 'fixture-at-' + randomUUID(), refresh_token = 'fixture-rt-' + randomUUID()
        ats.set(access_token, { tx, expiresAt: Date.now() + 300000 })
        const hasRefresh = (tx.scope ?? '').split(' ').includes('offline_access')
        if (hasRefresh) rts.set(refresh_token, tx)
        const id_token = await new SignJWT({ nonce: tx.nonce }).setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
          .setIssuer(issuer).setAudience('connected-web').setSubject(profile.id).setIssuedAt().setExpirationTime('5m').sign(privateKey)
        return send({ access_token, ...(hasRefresh ? { refresh_token } : {}), token_type: 'Bearer', expires_in: 300, id_token })
      }
      if (url.pathname === '/api/v1/auth/me') return identityFailure ? error('private failure detail', 503) : signed ? send(profile) : error('UNAUTHORIZED', 401)
      if (url.pathname === '/api/v1/auth/me/permissions') return signed ? send({
        applicationId: profile.authenticationContext.applicationId, organizationId: null, roles: ['reader'], permissions: ['documents:read'],
      }) : error('UNAUTHORIZED', 401)
      if (url.pathname === '/api/v1/auth/session/validity') {
        counts.validity++
        if (failValidity) return error('PRIVATE_DEPENDENCY_FAILURE', 503)
        return signed ? send({ sessionId: profile.authenticationContext.sessionId, clientId: 'connected-web',
          applicationId: profile.authenticationContext.applicationId, expiresAt: future(3600000),
          idleExpiresAt: future(3600000), accessExpiresAt: new Date(signed.expiresAt).toISOString() }) : error('UNAUTHORIZED', 401)
      }
      if (url.pathname === '/api/v1/auth/logout') {
        counts.logout++
        if (failLogout) return error('PRIVATE_DEPENDENCY_FAILURE', 503)
        ats.delete(bearer); if (body.refresh_token) rts.delete(body.refresh_token)
        res.writeHead(204); res.end(); return
      }
      if (url.pathname === '/oauth2/revoke') {
        if (req.headers.authorization !== 'Basic ' + Buffer.from('connected-web:fixture-confidential').toString('base64')) return error('invalid_client', 401)
        counts.revoke++; rts.delete(new URLSearchParams(raw).get('token')); res.writeHead(200); res.end(); return
      }
      if (url.pathname.endsWith('/auth-methods')) return send({ ...flowCapabilities, clientId: 'connected-web',
        idpProviders: [{ ...flowCapabilities.idpProviders[0], id: '019b0000-0000-7000-8000-000000000098' }] })
      if (url.pathname.endsWith('/auth-policy')) return send(flowPolicy)
      if (url.pathname === '/api/v1/auth/transactions') {
        const tx = { ...body, id: randomUUID(), secret: randomUUID(), state: 'AUTHENTICATING',
          wireState: body.state, expiresAt: future() }
        // state on tx is lifecycle; OAuth state must remain the create body value.
        tx.oauthState = body.state
        transactions.set(tx.id, tx)
        return send({ transactionId: tx.id, controlSecret: tx.secret, expiresAt: tx.expiresAt, nextAction: 'authenticate' }, 201)
      }
      const match = /^\/api\/v1\/auth\/transactions\/([^/]+)(\/[^/]+)?$/.exec(url.pathname)
      if (match) {
        const tx = transactions.get(match[1])
        if (!tx || tx.secret !== req.headers['authentication-transaction']) return error('UNAUTHORIZED', 401)
        if (tx.state === 'CANCELLED') return error('TRANSACTION_CANCELLED')
        const action = match[2]
        if (action === '/authenticate') {
          if (body.password === 'wrong') return error('UNAUTHORIZED', 401)
          tx.state = 'MFA_REQUIRED'
        }
        if (action === '/mfa') { if (body.code !== '123456') return error('INVALID_PROOF'); tx.state = 'AUTHENTICATED' }
        if (action === '/challenges') return send({ transactionId: tx.id, expiresAt: tx.expiresAt, challengeExpiresAt: future(120000), cooldownSeconds: 30, nextAction: 'authenticate' })
        if (action === '/authorize') {
          tx.state = 'AWAITING_PROVIDER'
          return send({ authorizationUrl: issuer + '/provider?tx=' + tx.id, expiresAt: tx.expiresAt })
        }
        if (action === '/complete') {
          if (tx.state !== 'AUTHENTICATED') return error('TRANSACTION_NOT_READY')
          return send({ kind: 'authorization_code', code: codeFor({ ...tx, state: tx.oauthState }), state: tx.oauthState, expiresIn: 60 })
        }
        if (action === '/cancel') tx.state = 'CANCELLED'
        return send(view(tx))
      }
      if (url.pathname === '/provider') {
        const tx = transactions.get(url.searchParams.get('tx'))
        if (!tx) return error('UNAUTHORIZED', 401)
        const target = new URL(tx.redirect_uri)
        if (providerMode === 'mfa') {
          tx.state = 'MFA_REQUIRED'
          target.search = new URLSearchParams({ kind: 'AUTH_CONTINUATION', auth_transaction_id: tx.id, state: tx.oauthState })
        } else if (providerMode === 'error') {
          target.search = new URLSearchParams({ error: 'access_denied', state: tx.oauthState })
        } else {
          target.search = new URLSearchParams({ code: codeFor({ ...tx, state: tx.oauthState }), state: tx.oauthState })
        }
        res.writeHead(302, { location: target.href }); res.end(); return
      }
      if (url.pathname === '/api/v1/auth/signup') {
        const id = randomUUID()
        const reg = { registrationId: id, status: 'PENDING_VERIFICATION', expiresAt: future(),
          nextAction: 'VERIFY_EMAIL', controlSecret: randomUUID(), nextChallengeAt: future(30000) }
        registrations.set(id, reg); return send(reg, 202)
      }
      const regMatch = /^\/api\/v1\/auth\/signup\/operations\/([^/]+)(\/[^/]+)?$/.exec(url.pathname)
      if (regMatch) {
        const reg = registrations.get(regMatch[1])
        if (!reg || req.headers['registration-client'] !== 'connected-web' ||
          (req.method === 'GET' ? req.headers['registration-control'] : body.controlSecret) !== reg.controlSecret) return error('UNAUTHORIZED', 401)
        if (regMatch[2] === '/complete') { reg.status = 'COMPLETED'; reg.nextAction = 'LOGIN' }
        if (regMatch[2] === '/cancel') { reg.status = 'CANCELLED'; reg.nextAction = 'RESTART' }
        return send({ ...reg, controlSecret: null })
      }
      if (['/api/v1/auth/password/forgot', '/api/v1/auth/password/reset'].includes(url.pathname)) {
        res.writeHead(204); res.end(); return
      }
      error('NOT_FOUND', 404)
    } catch { error('FIXTURE_FAILURE', 500) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  issuer = 'http://127.0.0.1:' + server.address().port
  return { issuer, counts, setValidityFailure: value => { failValidity = value }, setLogoutFailure: value => { failLogout = value },
    setTokenFailure: value => { tokenFailure = value }, setIdentityFailure: value => { identityFailure = value },
    invalidateCredentials: () => ats.clear(),
    setProviderMode: value => { providerMode = value },
    magicCallback: () => {
      const tx = [...transactions.values()].at(-1)
      const url = new URL(tx.redirect_uri)
      url.hash = new URLSearchParams({ kind: 'AUTH_PROOF', method: 'EMAIL_MAGIC_LINK', auth_transaction_id: tx.id,
        state: tx.oauthState, proof: 'fixture-one-time-email-proof' }).toString()
      return url.href
    },
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
