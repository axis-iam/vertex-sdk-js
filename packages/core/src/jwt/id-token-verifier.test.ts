import { afterEach, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { IdTokenVerifier } from './id-token-verifier.js'

const nonce = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
const resources: (() => void)[] = []
afterEach(() => {
  for (const close of resources.splice(0)) close()
})
it('verifies ES256 signature, issuer, client audience, lifetime, subject and expected nonce', async () => {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'fixture',
    alg: 'ES256',
    use: 'sig',
  }
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  resources.push(() => server.close())
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('fixture address')
  const issuer = `http://127.0.0.1:${address.port}`
  const verifier = new IdTokenVerifier({
    issuer,
    clientId: 'client',
    jwksUri: issuer + '/jwks',
  })
  const sign = (claims: Record<string, unknown> = {}) =>
    new SignJWT({ nonce, ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
      .setIssuer(issuer)
      .setAudience('client')
      .setSubject('user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  await expect(verifier.verify(await sign(), nonce)).resolves.toBeUndefined()
  for (const claims of [{ nonce: 'wrong' }, { nonce: undefined }])
    await expect(
      verifier.verify(await sign(claims), nonce),
    ).rejects.toMatchObject({ code: 'OIDC_ID_TOKEN_INVALID' })
  for (const field of ['iss', 'aud', 'exp', 'sub']) {
    const payload = {
      iss: issuer,
      aud: 'client',
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: 'user',
      iat: Math.floor(Date.now() / 1000),
      nonce,
    }
    const invalid = { ...payload, [field]: field === 'exp' ? 1 : 'wrong' }
    if (field === 'sub') invalid.sub = ''
    const token = await new SignJWT(invalid)
      .setProtectedHeader({ alg: 'ES256', kid: 'fixture' })
      .sign(privateKey)
    await expect(verifier.verify(token, nonce)).rejects.toMatchObject({
      code: 'OIDC_ID_TOKEN_INVALID',
    })
  }
  await expect(verifier.verify(undefined, nonce)).rejects.toMatchObject({
    code: 'OIDC_ID_TOKEN_INVALID',
  })
  const forged = (await sign()).split('.')
  forged[2] = 'A'.repeat(86)
  await expect(verifier.verify(forged.join('.'), nonce)).rejects.toMatchObject({
    code: 'OIDC_ID_TOKEN_INVALID',
  })
})
