import { requestJson } from './http-client'
import { parseTokenResponse } from './token-response'
import type { TokenSet } from './types'

export async function exchangeAuthorizationCode(input: {
  tokenEndpoint: string
  clientId: string
  code: string
  redirectUri: string
  codeVerifier: string
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  })

  const response = await requestJson<unknown>(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  return parseTokenResponse(response)
}

export async function refreshOAuthToken(input: {
  tokenEndpoint: string
  clientId: string
  refreshToken: string
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  })

  const response = await requestJson<unknown>(input.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  return parseTokenResponse(response, { requireRefreshToken: true, previousRefreshToken: input.refreshToken })
}
