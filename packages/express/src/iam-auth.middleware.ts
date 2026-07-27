import type { Request, Response, NextFunction, RequestHandler } from 'express'
import {
  JwtVerifier,
  IamClient,
  HttpPermissionResolver,
  parseRolesClaim,
  type IamSdkConfig,
} from '@axis-iam/vertex/server'

/**
 * Express middleware: verify JWT and resolve permissions.
 * Populates `req.user` with JWT payload + permissions array.
 *
 * @example
 * ```ts
 * app.use(iamAuth({
 *   endpoint: '...',
 *   clientId: process.env.IAM_CLIENT_ID!, // WEB/M2M confidential ApplicationClient.clientId
 *   clientSecret: process.env.IAM_CLIENT_SECRET!,
 *   resourceAudience: process.env.IAM_RESOURCE_AUDIENCE!, // Application.resourceAudience
 * }))
 * ```
 */
export function iamAuth(config: IamSdkConfig): RequestHandler {
  const verifier = new JwtVerifier(config)
  const client = new IamClient(config)
  const resolver = new HttpPermissionResolver(client, config)

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractBearer(req)
      if (!token) {
        res.status(401).json({ error: 'Missing bearer token' })
        return
      }

      const payload = await verifier.verify(token)
      const appId = payload.app_id?.trim()
      if (!appId) {
        res.status(401).json({ error: 'Missing app_id claim' })
        return
      }
      const roles = parseRolesClaim(payload.roles)
      let perms: Set<string>
      if (roles.length === 0) {
        perms = new Set()
      } else {
        try {
          perms = await resolver.resolve(appId, roles)
        } catch {
          res.status(503).json({ error: 'Permission service unavailable' })
          return
        }
      }

      ;(req as any).user = { ...payload, permissions: [...perms] }
      next()
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' })
    }
  }
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  return auth.slice(7)
}
