import { describe, it, expect, vi } from 'vitest'
import { requirePerm } from './require-perm.middleware.js'
import { permKey } from '@axis-iam/vertex'

function mockReqRes(user?: { permissions: string[] }) {
  const req = { user } as any
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any
  const next = vi.fn()
  return { req, res, next }
}

describe('requirePerm', () => {
  it('calls next when user has permission', () => {
    const middleware = requirePerm(permKey('posts', 'read'))
    const { req, res, next } = mockReqRes({ permissions: ['posts:read', 'posts:write'] })

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next when user has resource wildcard permission', () => {
    const middleware = requirePerm(permKey('posts', 'read'))
    const { req, res, next } = mockReqRes({ permissions: ['posts:*'] })

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next when user has global wildcard permission', () => {
    const middleware = requirePerm(permKey('posts', 'read'))
    const { req, res, next } = mockReqRes({ permissions: ['*:*'] })

    middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 403 when permission missing', () => {
    const middleware = requirePerm(permKey('posts', 'write'))
    const { req, res, next } = mockReqRes({ permissions: ['posts:read'] })

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 403 for an authenticated zero-role user', () => {
    const middleware = requirePerm(permKey('posts', 'read'))
    const { req, res, next } = mockReqRes({ permissions: [] })

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 403 when wildcard is for a different resource', () => {
    const middleware = requirePerm(permKey('posts', 'write'))
    const { req, res, next } = mockReqRes({ permissions: ['comments:*'] })

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 401 when no user', () => {
    const middleware = requirePerm(permKey('posts', 'read'))
    const { req, res, next } = mockReqRes(undefined)

    middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })
})
