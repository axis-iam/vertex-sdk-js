import { requestJson } from './http-client'
import { parseTokenResponse } from './token-response'
import type { TokenSet } from './types'
import { AuthenticationTransactionError } from '@axis-iam/vertex'
import {
  IamApiError,
  IamNetworkError,
  IamConfigurationError,
  IamTokenRefreshError,
} from './types'

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

  let response: unknown
  try {
    response = await requestJson<unknown>(input.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    if (
      error instanceof IamNetworkError ||
      error instanceof IamConfigurationError ||
      (error instanceof IamApiError &&
        error.status !== undefined &&
        error.status >= 500)
    )
      throw new AuthenticationTransactionError('TOKEN_EXCHANGE_UNCERTAIN')
    throw error
  }
  try {
    return parseTokenResponse(response)
  } catch {
    throw new AuthenticationTransactionError('TOKEN_EXCHANGE_UNCERTAIN')
  }
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

  let response: unknown
  try {
    response = await requestJson<unknown>(input.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    if (
      error instanceof IamNetworkError ||
      error instanceof IamConfigurationError ||
      (error instanceof IamApiError &&
        error.status !== undefined &&
        error.status >= 500)
    )
      throw new IamTokenRefreshError('RESULT_UNCERTAIN', false)
    throw error
  }
  try {
    return parseTokenResponse(response, {
      requireRefreshToken: true,
      previousRefreshToken: input.refreshToken,
    })
  } catch {
    throw new IamTokenRefreshError('RESULT_UNCERTAIN', false)
  }
}
