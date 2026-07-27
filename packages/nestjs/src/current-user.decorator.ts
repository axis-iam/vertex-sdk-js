import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

/**
 * Extract the authenticated user from the request.
 *
 * @example
 * ```ts
 * @Get('me')
 * getProfile(@CurrentUser() user: IamJwtPayload & { permissions: string[] }) {
 *   return { userId: user.sub }
 * }
 * ```
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user
  },
)
