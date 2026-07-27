import { describe, expect, it } from 'vitest'
import { InvalidTokenResponseError, parseTokenResponse } from './token-response'

const valid = { access_token: 'at', refresh_token: 'rt2', token_type: 'Bearer', expires_in: 300 }

describe('parseTokenResponse', () => {
  it.each([
    [{ ...valid, access_token: '' }, 'access_token'],
    [{ ...valid, expires_in: 0 }, 'expires_in'],
    [{ ...valid, expires_in: 1.5 }, 'expires_in'],
    [{ ...valid, refresh_token: '' }, 'refresh_token'],
  ])('rejects malformed token response %#', (response, field) => {
    expect(() => parseTokenResponse(response)).toThrowError(new InvalidTokenResponseError(`${field} ${field === 'expires_in' ? 'must be a positive integer' : 'must be a non-empty string'}`))
  })

  it('allows an authorization-code response without a refresh token', () => {
    expect(parseTokenResponse({ access_token: 'at', token_type: 'Bearer', expires_in: 300 })).toEqual({
      access_token: 'at', token_type: 'Bearer', expires_in: 300,
    })
  })

  it('requires a rotated refresh token on refresh', () => {
    expect(() => parseTokenResponse(valid, { requireRefreshToken: true, previousRefreshToken: 'rt2' }))
      .toThrow('refresh_token was not rotated')
    expect(() => parseTokenResponse({ access_token: 'at', token_type: 'Bearer', expires_in: 300 }, { requireRefreshToken: true, previousRefreshToken: 'rt1' }))
      .toThrow('refresh_token is required')
  })
})
