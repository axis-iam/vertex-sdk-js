import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { WebAuthClient, type WebAuthSession, type WebAuthTransaction } from './web-auth-client.js'

const resources: Server[] = []
afterEach(async () => {
  await Promise.all(resources.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

it('binds the default OpenID nonce to verified signed ID Tokens before creating any session', async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const wrongKey = await generateKeyPair('ES256')
  const jwk = { ...await exportJWK(publicKey), kid: 'oidc', alg: 'ES256', use: 'sig' }
  const transactions = new Map<string, WebAuthTransaction>()
  const sessions = new Map<string, WebAuthSession>()
  const now = 1_800_000_000_000
  let issuer = '', idToken: string | undefined
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({ issuer, authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' }))
    } else if (req.url === '/jwks') {
      res.end(JSON.stringify({ keys: [jwk] }))
    } else if (req.url === '/token') {
      res.end(JSON.stringify({ access_token: 'opaque-access', refresh_token: 'opaque-refresh',
        id_token: idToken, token_type: 'Bearer', expires_in: 300 }))
    } else { res.writeHead(404); res.end('{}') }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  resources.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  issuer = `http://127.0.0.1:${address.port}`
  const client = new WebAuthClient({ issuer, clientId: 'client', clientSecret: 'test-only-secret',
    applicationOrigin: 'https://app.example.test', redirectUri: 'https://app.example.test/callback',
    successRedirect: '/done', postLogoutRedirect: '/out', now: () => now,
    transactionStore: { async save(k, v) { transactions.set(k, v) },
      async consume(k) { const value = transactions.get(k) ?? null; transactions.delete(k); return value } },
    sessionStore: { async create(k, v) { sessions.set(k, v) }, async read(k) { return sessions.get(k) ?? null },
      async replace() { return false }, async delete(k) { sessions.delete(k) } },
  })
  async function sign(nonce: string, claims: Record<string, unknown> = {}, key = privateKey) {
    return new SignJWT({ iss: issuer, aud: 'client', sub: 'user', nonce,
      iat: now / 1000, exp: now / 1000 + 300, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'oidc' }).sign(key)
  }
  const begin = async () => {
    const login = await client.beginLogin()
    const tx = transactions.get(login.transactionId)
    if (!tx?.nonce) throw new Error('Default OpenID transaction must own a nonce')
    const url = new URL(login.authorizationUrl)
    expect(url.searchParams.get('nonce')).toBe(tx.nonce)
    expect(url.searchParams.get('scope')?.split(' ')).toContain('openid')
    expect(tx.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(tx.nonce).not.toBe(tx.state)
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(tx.codeVerifier).digest('base64url'))
    return { login, tx, input: { transactionId: login.transactionId, state: tx.state, code: 'code' } }
  }
  const valid = await begin()
  idToken = await sign(valid.tx.nonce!)
  const originalToken = idToken
  const result = await client.handleCallback(valid.input)
  expect(sessions.has(result.sessionId)).toBe(true)
  await expect(client.handleCallback(valid.input)).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND' })
  sessions.clear()
  for (const defect of ['missing', 'nonce', 'issuer', 'audience', 'expired', 'future', 'subject', 'signature', 'replayed-token', 'missing-transaction-nonce']) {
    const attempt = await begin()
    idToken = defect === 'missing' ? undefined : defect === 'replayed-token' ? originalToken
      : await sign(attempt.tx.nonce!, {
          ...(defect === 'nonce' ? { nonce: 'wrong' } : {}),
          ...(defect === 'issuer' ? { iss: 'https://other.example.test' } : {}),
          ...(defect === 'audience' ? { aud: 'other-client' } : {}),
          ...(defect === 'expired' ? { exp: now / 1000 - 1 } : {}),
          ...(defect === 'future' ? { iat: now / 1000 + 1 } : {}),
          ...(defect === 'subject' ? { sub: '' } : {}),
        }, defect === 'signature' ? wrongKey.privateKey : privateKey)
    if (defect === 'missing-transaction-nonce') delete attempt.tx.nonce
    await expect(client.handleCallback(attempt.input), defect).rejects.toMatchObject({ code: 'ID_TOKEN_INVALID' })
    expect(sessions.size, defect).toBe(0)
    expect(transactions.has(attempt.login.transactionId), defect).toBe(false)
  }
})
