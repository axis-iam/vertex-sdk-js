import { describe, expect, it } from 'vitest'
import { normalizeOAuthError } from './oauth-errors'

describe('normalizeOAuthError', () => {
  it('preserves Error instances', () => {
    const error = new Error('callback failed')

    expect(normalizeOAuthError(error)).toBe(error)
  })

  it('converts non-Error values using the existing string representation', () => {
    expect(normalizeOAuthError('access_denied').message).toBe('access_denied')
    expect(normalizeOAuthError(null).message).toBe('null')
  })
})
