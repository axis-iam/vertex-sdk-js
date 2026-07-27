import type { TokenSet } from './types'

export class InvalidTokenResponseError extends Error {
  readonly code = 'INVALID_TOKEN_RESPONSE'

  constructor(reason: string) {
    super(`Invalid token response: ${reason}`)
    this.name = 'InvalidTokenResponseError'
  }
}

export interface TokenResponseOptions {
  requireRefreshToken?: boolean
  previousRefreshToken?: string
}

export function parseTokenResponse(data: unknown, options: TokenResponseOptions = {}): TokenSet {
  if (!isRecord(data)) throw new InvalidTokenResponseError('response must be an object')

  const accessToken = requiredNonEmptyString(data.access_token, 'access_token')
  const tokenType = requiredNonEmptyString(data.token_type, 'token_type')
  if (typeof data.expires_in !== 'number' || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0) {
    throw new InvalidTokenResponseError('expires_in must be a positive integer')
  }

  const refreshToken = optionalNonEmptyString(data, 'refresh_token')
  if (options.requireRefreshToken && !refreshToken) {
    throw new InvalidTokenResponseError('refresh_token is required')
  }
  if (options.previousRefreshToken && refreshToken === options.previousRefreshToken) {
    throw new InvalidTokenResponseError('refresh_token was not rotated')
  }

  const idToken = optionalNonEmptyString(data, 'id_token')
  const scope = optionalString(data, 'scope')
  return {
    access_token: accessToken,
    token_type: tokenType,
    expires_in: data.expires_in,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(idToken ? { id_token: idToken } : {}),
    ...(scope !== undefined ? { scope } : {}),
  }
}

function requiredNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidTokenResponseError(`${field} must be a non-empty string`)
  }
  return value
}

function optionalNonEmptyString(data: Record<string, unknown>, field: string): string | undefined {
  if (!(field in data)) return undefined
  return requiredNonEmptyString(data[field], field)
}

function optionalString(data: Record<string, unknown>, field: string): string | undefined {
  if (!(field in data)) return undefined
  if (typeof data[field] !== 'string') throw new InvalidTokenResponseError(`${field} must be a string`)
  return data[field] as string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
