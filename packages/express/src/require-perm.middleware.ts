import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { hasPermission, toAuthority, type PermissionKey } from '@axis-iam/vertex'

/**
 * Express middleware: check a required permission on `req.user.permissions`.
 * Must be used AFTER `iamAuth()`.
 *
 * @example
 * ```ts
 * app.get('/posts', requirePerm(MyPermissions.POSTS_READ), handler)
 * ```
 */
export function requirePerm(perm: PermissionKey): RequestHandler {
  const authority = toAuthority(perm)

  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user as { permissions?: string[] } | undefined
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (!hasPermission(user.permissions ?? [], authority)) {
      res.status(403).json({ error: `Missing permission: ${authority}` })
      return
    }
    next()
  }
}
