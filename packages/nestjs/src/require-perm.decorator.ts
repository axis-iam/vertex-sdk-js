import { SetMetadata } from '@nestjs/common'
import type { PermissionKey } from '@axis-iam/vertex'
import { REQUIRE_PERM_METADATA, IS_PUBLIC_METADATA } from './constants.js'

/**
 * Require a specific permission on a route handler.
 *
 * @example
 * ```ts
 * @Get('posts')
 * @RequirePerm(MyPermissions.POSTS_READ)
 * list() { return this.postsService.findAll() }
 * ```
 */
export const RequirePerm = (perm: PermissionKey) =>
  SetMetadata(REQUIRE_PERM_METADATA, perm)

/**
 * Mark a route as public (skip authentication).
 */
export const Public = () => SetMetadata(IS_PUBLIC_METADATA, true)
