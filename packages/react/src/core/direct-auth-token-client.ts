import { requestJson } from './http-client'
import { parseTokenResponse } from './token-response'
import type { TokenSet } from './types'

export async function refreshDirectAuthToken(input: {
  issuer: string
  clientId: string
  refreshToken: string
}): Promise<TokenSet> {
  const response = await requestJson<unknown>(`${input.issuer.replace(/\/$/, '')}/api/v1/auth/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    json: {
      refresh_token: input.refreshToken,
      client_id: input.clientId,
    },
  })
  return parseTokenResponse(response, { requireRefreshToken: true, previousRefreshToken: input.refreshToken })
}
