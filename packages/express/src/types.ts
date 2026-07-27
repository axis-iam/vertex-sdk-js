import type { IamJwtPayload } from '@axis-iam/vertex'

/** Augmented Express Request with IAM user info */
export interface IamRequest {
  user?: IamJwtPayload & { permissions: string[] }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: IamJwtPayload & { permissions: string[] }
    }
  }
}
