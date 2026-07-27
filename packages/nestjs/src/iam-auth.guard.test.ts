import { describe, expect, it, vi } from 'vitest'
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { IamAuthGuard } from './iam-auth.guard.js'

function createContext() {
  const request = { headers: { authorization: 'Bearer token' } } as any
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any
  return { ctx, request }
}

function createGuard(payload: Record<string, unknown>) {
  const verifier = { verify: vi.fn().mockResolvedValue(payload) } as any
  const resolver = { resolve: vi.fn().mockResolvedValue(new Set(['orders:read'])) } as any
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) } as any
  return { guard: new IamAuthGuard(verifier, resolver, reflector), verifier, resolver }
}

describe('IamAuthGuard', () => {
  it('returns 401 when bearer is missing', async () => {
    const { guard, verifier, resolver } = createGuard({})
    const { ctx, request } = createContext()
    request.headers = {}

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(verifier.verify).not.toHaveBeenCalled()
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('resolves permissions with app_id and never aud', async () => {
    const { guard, resolver } = createGuard({
      sub: 'user-1',
      aud: 'api://socratiq',
      app_id: 'app-uuid',
      roles: ['admin'],
    })
    const { ctx, request } = createContext()

    await expect(guard.canActivate(ctx)).resolves.toBe(true)

    expect(resolver.resolve).toHaveBeenCalledWith('app-uuid', ['admin'])
    expect(request.user).toMatchObject({
      sub: 'user-1',
      app_id: 'app-uuid',
      permissions: ['orders:read'],
    })
  })

  it('fails closed when app_id is missing', async () => {
    const { guard, resolver } = createGuard({
      sub: 'user-1',
      aud: 'api://socratiq',
      roles: ['admin'],
    })
    const { ctx } = createContext()

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it.each([undefined, []])('authenticates zero-role payload (%s) without resolving permissions', async roles => {
    const { guard, resolver } = createGuard({ sub: 'user-1', app_id: 'app-uuid', ...(roles === undefined ? {} : { roles }) })
    const { ctx, request } = createContext()

    await expect(guard.canActivate(ctx)).resolves.toBe(true)
    expect(resolver.resolve).not.toHaveBeenCalled()
    expect(request.user).toMatchObject({ permissions: [] })
  })

  it('rejects malformed roles as authentication failure', async () => {
    const { guard, resolver } = createGuard({ sub: 'user-1', app_id: 'app-uuid', roles: [''] })
    const { ctx } = createContext()

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('maps non-empty resolver failure to sanitized 503', async () => {
    const { guard, resolver } = createGuard({ sub: 'user-1', app_id: 'app-uuid', roles: ['admin'] })
    resolver.resolve.mockRejectedValue(new Error('secret upstream response'))
    const { ctx } = createContext()

    await expect(guard.canActivate(ctx)).rejects.toThrow(ServiceUnavailableException)
  })

  it('keeps verifier failure at 401', async () => {
    const { guard, verifier } = createGuard({ sub: 'user-1', app_id: 'app-uuid', roles: ['admin'] })
    verifier.verify.mockRejectedValue(new Error('invalid token details'))
    const { ctx } = createContext()

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException)
  })
})
