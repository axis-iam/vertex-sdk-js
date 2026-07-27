import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ServiceUnavailableException, Inject } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtVerifier, HttpPermissionResolver, parseRolesClaim } from '@axis-iam/vertex/server'
import { IS_PUBLIC_METADATA } from './constants.js'

/**
 * Global guard that verifies JWT and resolves permissions.
 * Attaches `req.user` with payload + permissions.
 */
@Injectable()
export class IamAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtVerifier) private verifier: JwtVerifier,
    @Inject(HttpPermissionResolver) private resolver: HttpPermissionResolver,
    @Inject(Reflector) private reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_METADATA, [
      ctx.getHandler(),
      ctx.getClass(),
    ])
    if (isPublic) return true

    const request = ctx.switchToHttp().getRequest()
    const token = this.extractBearer(request)
    if (!token) throw new UnauthorizedException('Missing bearer token')

    try {
      const payload = await this.verifier.verify(token)
      const appId = payload.app_id?.trim()
      if (!appId) throw new UnauthorizedException('Missing app_id claim')
      const roles = parseRolesClaim(payload.roles)
      let perms: Set<string>
      if (roles.length === 0) {
        perms = new Set()
      } else {
        try {
          perms = await this.resolver.resolve(appId, roles)
        } catch {
          throw new ServiceUnavailableException('Permission service unavailable')
        }
      }
      request.user = { ...payload, permissions: [...perms] }
      return true
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error
      throw new UnauthorizedException('Invalid or expired token')
    }
  }

  private extractBearer(request: { headers?: { authorization?: string } }): string | null {
    const auth = request.headers?.authorization
    if (!auth?.startsWith('Bearer ')) return null
    return auth.slice(7)
  }
}
