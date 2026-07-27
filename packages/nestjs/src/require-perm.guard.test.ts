import { describe, it, expect, vi } from 'vitest'
import { RequirePermGuard } from './require-perm.guard.js'
import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { permKey } from '@axis-iam/vertex'

function createMockContext(user: unknown, metadata: unknown = undefined) {
  const reflector = new Reflector()
  vi.spyOn(reflector, 'get').mockReturnValue(metadata)

  const guard = new RequirePermGuard(reflector)
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any

  return { guard, ctx }
}

describe('RequirePermGuard', () => {
  it('allows when no permission metadata', () => {
    const { guard, ctx } = createMockContext({ permissions: [] }, undefined)
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('allows when user has required permission', () => {
    const { guard, ctx } = createMockContext(
      { permissions: ['posts:read', 'posts:write'] },
      permKey('posts', 'read'),
    )
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('allows when user has resource wildcard permission', () => {
    const { guard, ctx } = createMockContext(
      { permissions: ['posts:*'] },
      permKey('posts', 'read'),
    )
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('allows when user has global wildcard permission', () => {
    const { guard, ctx } = createMockContext(
      { permissions: ['*:*'] },
      permKey('posts', 'read'),
    )
    expect(guard.canActivate(ctx)).toBe(true)
  })

  it('throws ForbiddenException when permission missing', () => {
    const { guard, ctx } = createMockContext(
      { permissions: ['posts:read'] },
      permKey('posts', 'write'),
    )
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('throws ForbiddenException for an authenticated zero-role user', () => {
    const { guard, ctx } = createMockContext(
      { permissions: [] },
      permKey('posts', 'read'),
    )
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('throws ForbiddenException when wildcard is for a different resource', () => {
    const { guard, ctx } = createMockContext(
      { permissions: ['comments:*'] },
      permKey('posts', 'write'),
    )
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException)
  })

  it('throws UnauthorizedException when no user', () => {
    const { guard, ctx } = createMockContext(undefined, permKey('posts', 'read'))
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })
})
