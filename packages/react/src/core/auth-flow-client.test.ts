import { describe, it, expect } from 'vitest'
import {
  parseDirectAuthResult,
  parseSignupUser,
  registrationGrantBody,
  assertSignupPassword,
  validateFlowMetadata,
} from './auth-flow-client'
import { IamApiError, IamConfigurationError } from './types'
import { makeTestJwt } from '../test-utils'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'
describe('Direct flow response boundary', () => {
  it('recognizes exactly the existing TOTP continuation', () => {
    expect(parseDirectAuthResult({ mfa_required: true, mfa_token: 'proof', mfa_methods: ['totp'] })).toEqual({
      kind: 'mfa',
      token: 'proof',
      methods: ['totp'],
    })
  })
  it.each([
    null,
    {},
    { mfa_required: true, mfa_token: 'proof', mfa_methods: ['webauthn'] },
    { mfa_required: true, mfa_token: '', mfa_methods: ['totp'] },
    { mfa_required: true, mfa_token: 'proof', mfa_methods: ['totp'], access_token: 'early' },
    { mfa_token: 'stray' },
  ])('rejects malformed challenge or incomplete final response %j', (data) => {
    if (data && Object.keys(data).length === 0)
      expect(() => parseSignupUser(data)).toThrow(IamConfigurationError)
    else expect(() => parseDirectAuthResult(data)).toThrow(IamConfigurationError)
  })
  it('rejects malformed user tokens before a session can be committed', () => {
    expect(() => parseDirectAuthResult({access_token:'opaque-shaped',token_type:'Bearer',expires_in:3600})).toThrow(IamConfigurationError)
    expect(parseDirectAuthResult({access_token:makeTestJwt(),token_type:'Bearer',expires_in:3600}).kind).toBe('tokens')
  })
  it('validates signup identity without creating tokens', () => {
    expect(
      parseSignupUser({
        id: 'u',
        email: 'u@example.invalid',
        status: 'PENDING',
        emailVerified: false,
        roles: [],
      }),
    ).toMatchObject({ status: 'PENDING' })
    expect(() =>
      parseSignupUser({
        id: 'u',
        email: 'u@example.invalid',
        status: 'ACTIVE',
        emailVerified: false,
        roles: 'admin',
      }),
    ).toThrow(IamConfigurationError)
  })
  it('rejects multiple and blank grant proofs', () => {
    expect(() =>
      registrationGrantBody({ type: 'EMAIL_LINK', registrationGrantToken: 't', registrationAccessCode: 'c' }),
    ).toThrow(IamApiError)
    expect(() => registrationGrantBody({ type: 'ACCESS_CODE', registrationAccessCode: ' ' })).toThrow(
      IamApiError,
    )
    expect(registrationGrantBody({ type: 'ORG_INVITATION', organizationInvitationToken: 't' })).toEqual({
      organizationInvitationToken: 't',
    })
  })
  it.each([undefined, null, 'true', 1])('rejects a missing or malformed breached-password policy flag %j', (flag) => {
    expect(() => validateFlowMetadata(flowCapabilities, {
      ...flowPolicy,
      breachedPasswordCheck: flag,
    } as unknown as typeof flowPolicy)).toThrow(IamConfigurationError)
  })
  it.each([false, true])('accepts the actual breached-password policy flag %j', (flag) => {
    expect(() => validateFlowMetadata(flowCapabilities, {
      ...flowPolicy,
      breachedPasswordCheck: flag,
    })).not.toThrow()
  })
  it('enforces resolved constraints and strict metadata', () => {
    for (const password of ['short', 'longwithoutupper123!', 'LongWithoutDigits!', 'LongWithoutSpecial123'])
      expect(() => assertSignupPassword(password, flowPolicy)).toThrow(IamApiError)
    expect(() => assertSignupPassword('ValidPassword123!', flowPolicy)).not.toThrow()
    expect(() => validateFlowMetadata(flowCapabilities, { ...flowPolicy, minPasswordLength: NaN })).toThrow(
      IamConfigurationError,
    )
  })
})
