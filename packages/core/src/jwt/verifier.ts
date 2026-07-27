import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { JWTPayload, JWTVerifyResult } from 'jose'
import type { IamSdkConfig } from '../config.js'

export type { JWTPayload }

/** Verified JWT claims from IAM server */
export interface IamJwtPayload extends JWTPayload {
  sub: string
  roles?: string[]
  app_id?: string
  azp?: string
  client_id?: string
  org_id?: string
  org_role?: string
  workspace_id?: string
  acr?: string
  act?: { sub: string; session_id?: string }
}

/** Parse the optional roles claim without normalizing malformed token data. */
export function parseRolesClaim(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(role => typeof role !== 'string' || role.trim() === '')) {
    throw new TypeError('Invalid roles claim')
  }
  return [...value]
}

/**
 * JWT verifier using JWKS from IAM server.
 * Caches JWKS keys per jose defaults, with configurable refresh interval.
 */
export class JwtVerifier {
  private jwks: ReturnType<typeof createRemoteJWKSet>

  constructor(private config: Pick<IamSdkConfig, 'endpoint' | 'resourceAudience' | 'jwksRefreshMs'>) {
    this.jwks = createRemoteJWKSet(
      new URL(`${config.endpoint}/oauth2/jwks`),
      { cacheMaxAge: config.jwksRefreshMs ?? 3_600_000 },
    )
  }

  /** Verify a JWT and return decoded payload */
  async verify(token: string): Promise<IamJwtPayload> {
    const result: JWTVerifyResult = await jwtVerify(token, this.jwks, {
      issuer: this.config.endpoint,
      audience: this.config.resourceAudience,
    })
    return result.payload as IamJwtPayload
  }
}
