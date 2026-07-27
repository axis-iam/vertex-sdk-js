import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, Inject } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { hasPermission, toAuthority, type PermissionKey } from '@axis-iam/vertex'
import { REQUIRE_PERM_METADATA } from './constants.js'

/**
 * Guard that checks the @RequirePerm metadata against req.user.permissions.
 * Must run AFTER IamAuthGuard (which populates req.user).
 */
@Injectable()
export class RequirePermGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.get<PermissionKey | undefined>(
      REQUIRE_PERM_METADATA,
      ctx.getHandler(),
    )
    if (!required) return true // No permission required

    const request = ctx.switchToHttp().getRequest()
    const user = request.user as { permissions?: string[] } | undefined
    if (!user) throw new UnauthorizedException()

    const authority = toAuthority(required)
    if (!hasPermission(user.permissions ?? [], authority)) {
      throw new ForbiddenException(`Missing permission: ${authority}`)
    }

    return true
  }
}
