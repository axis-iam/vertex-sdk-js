import { requestNoContent } from './http-client'
import { IamApiError, IamNetworkError } from './types'

export async function logoutDirectAuth(input: {
  issuer: string
  accessToken: string
  refreshToken: string | null
}): Promise<void> {
  try {
    await requestNoContent(`${input.issuer}/api/v1/auth/logout`, {
      method: 'POST',
      json: input.refreshToken ? { refresh_token: input.refreshToken } : undefined,
      bearerToken: input.accessToken,
    })
  } catch (error) {
    if (error instanceof IamApiError) {
      throw new IamApiError('Direct logout request failed', {
        status: error.status,
        code: 'LOGOUT_FAILED',
        retryAfterSeconds: error.retryAfterSeconds,
      })
    }
    if (error instanceof IamNetworkError && error.message === 'IAM request timed out') {
      throw new IamNetworkError('Direct logout request timed out')
    }
    throw new IamNetworkError('Direct logout request failed')
  }
}
