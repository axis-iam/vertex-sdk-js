import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JwtVerifier, parseRolesClaim } from './verifier.js'

const jose = vi.hoisted(() => ({
  jwks: Symbol('jwks'),
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(),
}))

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>()
  return {
    ...actual,
    createRemoteJWKSet: jose.createRemoteJWKSet,
    jwtVerify: jose.jwtVerify,
  }
})

describe('parseRolesClaim', () => {
  it.each([undefined, []])('accepts zero-role claim %s', value => {
    expect(parseRolesClaim(value)).toEqual([])
  })

  it('returns a copy of valid roles', () => {
    const roles = ['admin']
    const parsed = parseRolesClaim(roles)
    expect(parsed).toEqual(roles)
    expect(parsed).not.toBe(roles)
  })

  it.each([null, 'admin', {}, [null], [''], ['   '], ['admin', 1]])('rejects malformed roles claim %#', value => {
    expect(() => parseRolesClaim(value)).toThrow('Invalid roles claim')
  })
})

describe('JwtVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jose.createRemoteJWKSet.mockReturnValue(jose.jwks)
    jose.jwtVerify.mockResolvedValue({
      payload: {
        sub: 'user-1',
        aud: 'api://socratiq',
        app_id: 'app-uuid',
        azp: 'web-client',
        client_id: 'web-client',
      },
    })
  })

  it('verifies access-token aud with resourceAudience', async () => {
    const verifier = new JwtVerifier({
      endpoint: 'https://auth.example.com',
      resourceAudience: 'api://socratiq',
      jwksRefreshMs: 1_000,
    })

    const payload = await verifier.verify('token')

    expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://auth.example.com/oauth2/jwks'),
      { cacheMaxAge: 1_000 },
    )
    expect(jose.jwtVerify).toHaveBeenCalledWith('token', jose.jwks, {
      issuer: 'https://auth.example.com',
      audience: 'api://socratiq',
    })
    expect(payload.app_id).toBe('app-uuid')
    expect(payload.azp).toBe('web-client')
    expect(payload.client_id).toBe('web-client')
  })

  it('does not use clientId as the access-token audience', async () => {
    const verifier = new JwtVerifier({
      endpoint: 'https://auth.example.com',
      clientId: 'confidential-client',
      resourceAudience: 'api://socratiq',
    } as never)

    await verifier.verify('token')

    expect(jose.jwtVerify).toHaveBeenCalledWith('token', jose.jwks, expect.objectContaining({
      audience: 'api://socratiq',
    }))
  })
})
