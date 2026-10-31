import { createRemoteJWKSet, jwtVerify } from 'jose'

export class IdTokenValidationError extends Error {
  readonly code = 'OIDC_ID_TOKEN_INVALID'
  constructor() {
    super('OpenID ID Token validation failed')
    this.name = 'IdTokenValidationError'
  }
}

/** ID Tokens identify the OIDC response; Access Tokens remain opaque to this client. */
export class IdTokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>

  constructor(
    private readonly config: {
      issuer: string
      clientId: string
      jwksUri: string
      now?: () => number
    },
  ) {
    const issuer = new URL(config.issuer)
    const jwks = new URL(config.jwksUri)
    if (
      !['https:', 'http:'].includes(issuer.protocol) ||
      jwks.origin !== issuer.origin ||
      jwks.username ||
      jwks.password ||
      jwks.hash ||
      !config.clientId
    )
      throw new IdTokenValidationError()
    this.keys = createRemoteJWKSet(jwks)
  }

  async verify(
    token: string | undefined,
    expectedNonce: string,
  ): Promise<void> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(expectedNonce))
      throw new IdTokenValidationError()
    try {
      const now = this.config.now?.() ?? Date.now()
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.config.issuer,
        audience: this.config.clientId,
        algorithms: ['ES256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
        currentDate: new Date(now),
      })
      if (
        typeof payload.sub !== 'string' ||
        !payload.sub ||
        payload.nonce !== expectedNonce ||
        typeof payload.iat !== 'number' ||
        payload.iat > now / 1000 ||
        (Array.isArray(payload.aud) &&
          payload.aud.length > 1 &&
          payload.azp !== this.config.clientId) ||
        (payload.azp !== undefined && payload.azp !== this.config.clientId)
      )
        throw new IdTokenValidationError()
    } catch {
      // Do not expose JOSE claims, signatures or provider error text.
      throw new IdTokenValidationError()
    }
  }
}
