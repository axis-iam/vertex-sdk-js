import type { INestApplication } from '@nestjs/common'
import { createBff, type BffExpressConfig, type BffHandlers } from '@axis-iam/vertex-express'

/**
 * Nest's Express HTTP adapter only. Mount before init/listen: auth routes finish
 * in middleware before Bearer guards. Business routes retain their own guards.
 */
export function mountBff(app: INestApplication, config: BffExpressConfig): BffHandlers {
  if (app.getHttpAdapter().getType() !== 'express') throw new Error('BFF requires the Nest Express adapter')
  const bff = createBff(config)
  app.use(bff.basePath, bff.router)
  return bff
}
