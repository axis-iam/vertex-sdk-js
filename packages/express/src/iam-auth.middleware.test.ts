import { beforeEach, describe, expect, it, vi } from 'vitest'
import { iamAuth } from './iam-auth.middleware.js'

const sdk = vi.hoisted(() => ({
  verify: vi.fn(),
  resolve: vi.fn(),
  JwtVerifier: vi.fn(),
  IamClient: vi.fn(),
  HttpPermissionResolver: vi.fn(),
  parseRolesClaim: (value: unknown) => {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.some(role => typeof role !== 'string' || role.trim() === '')) throw new TypeError('Invalid roles claim')
    return [...value]
  },
}))

vi.mock('@axis-iam/vertex/server', () => ({
  JwtVerifier: sdk.JwtVerifier,
  IamClient: sdk.IamClient,
  HttpPermissionResolver: sdk.HttpPermissionResolver,
  parseRolesClaim: sdk.parseRolesClaim,
}))

const config = {
  endpoint: 'https://auth.example.com',
  clientId: 'confidential-client',
  clientSecret: 'secret',
  resourceAudience: 'api://socratiq',
}

function mockReqRes(token = 'token') {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as any
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any
  const next = vi.fn()
  return { req, res, next }
}

describe('iamAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdk.JwtVerifier.mockImplementation(function () {
      return { verify: sdk.verify }
    })
    sdk.IamClient.mockImplementation(function () {
      return {}
    })
    sdk.HttpPermissionResolver.mockImplementation(function () {
      return { resolve: sdk.resolve }
    })
    sdk.resolve.mockResolvedValue(new Set(['orders:read']))
  })

  it('returns 401 when bearer is missing', async () => {
    const middleware = iamAuth(config)
    const { req, res, next } = mockReqRes('')

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing bearer token' })
    expect(sdk.verify).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it('resolves permissions with app_id and never aud', async () => {
    sdk.verify.mockResolvedValue({
      sub: 'user-1',
      aud: 'api://socratiq',
      app_id: 'app-uuid',
      roles: ['admin'],
    })
    const middleware = iamAuth(config)
    const { req, res, next } = mockReqRes()

    await middleware(req, res, next)

    expect(sdk.resolve).toHaveBeenCalledWith('app-uuid', ['admin'])
    expect(req.user).toMatchObject({
      sub: 'user-1',
      app_id: 'app-uuid',
      permissions: ['orders:read'],
    })
    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('fails closed when app_id is missing', async () => {
    sdk.verify.mockResolvedValue({
      sub: 'user-1',
      aud: 'api://socratiq',
      roles: ['admin'],
    })
    const middleware = iamAuth(config)
    const { req, res, next } = mockReqRes()

    await middleware(req, res, next)

    expect(sdk.resolve).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing app_id claim' })
  })

  it.each([undefined, []])('authenticates zero-role payload (%s) without resolving permissions', async roles => {
    sdk.verify.mockResolvedValue({ sub: 'user-1', app_id: 'app-uuid', ...(roles === undefined ? {} : { roles }) })
    const middleware = iamAuth(config)
    const { req, res, next } = mockReqRes()

    await middleware(req, res, next)

    expect(sdk.resolve).not.toHaveBeenCalled()
    expect(req.user).toMatchObject({ permissions: [] })
    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })

  it('rejects malformed roles as authentication failure', async () => {
    sdk.verify.mockResolvedValue({ sub: 'user-1', app_id: 'app-uuid', roles: [''] })
    const middleware = iamAuth(config)
    const { res, next } = mockReqRes()

    await middleware({ headers: { authorization: 'Bearer token' } } as any, res, next)

    expect(sdk.resolve).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' })
  })

  it('maps non-empty resolver failure to sanitized 503', async () => {
    sdk.verify.mockResolvedValue({ sub: 'user-1', app_id: 'app-uuid', roles: ['admin'] })
    sdk.resolve.mockRejectedValue(new Error('secret upstream response'))
    const middleware = iamAuth(config)
    const { res, next } = mockReqRes()

    await middleware({ headers: { authorization: 'Bearer token' } } as any, res, next)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: 'Permission service unavailable' })
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret upstream response')
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps verifier failure at 401', async () => {
    sdk.verify.mockRejectedValue(new Error('invalid token details'))
    const middleware = iamAuth(config)
    const { res, next } = mockReqRes()

    await middleware({ headers: { authorization: 'Bearer token' } } as any, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
