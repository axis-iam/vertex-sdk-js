import { parseRegistration } from './identity-client'
import { describe, it, expect } from 'vitest'
import {
  registrationGrantBody,
  assertSignupPassword,
  validateFlowMetadata,
  hasLocalRegistration,
} from './auth-flow-client'
import { IamApiError, IamConfigurationError } from './types'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'
describe('registration and capability boundary', () => {
  it('preserves email OTP/link signup independently of the password identifier set', () => {
    const capabilities = { ...flowCapabilities, allowedPasswordIdentifierKinds: ['PHONE'] as ('PHONE')[],
      methods: flowCapabilities.methods.map(method => ({ ...method, availableForSignup: method.type === 'EMAIL_OTP' })) }
    expect(hasLocalRegistration(capabilities, 'EMAIL')).toBe(true)
    expect(hasLocalRegistration(capabilities, 'USERNAME')).toBe(false)
    expect(hasLocalRegistration(capabilities, 'PHONE')).toBe(false)
    expect(hasLocalRegistration({ ...capabilities, methods: capabilities.methods.map(method => ({ ...method, availableForSignup: false })) })).toBe(false)
    expect(hasLocalRegistration({ ...capabilities, allowedSignupIdentifierKinds: [] })).toBe(false)
  })

  it('rejects missing or mismatched password policy instead of widening capabilities', () => {
    expect(() => validateFlowMetadata(flowCapabilities, {
      ...flowPolicy, allowedPasswordIdentifierKinds: ['PHONE'],
    })).toThrow()
    expect(() => validateFlowMetadata(flowCapabilities, {
      ...flowPolicy, allowedPasswordIdentifierKinds: undefined,
    } as never)).toThrow()
    expect(() => validateFlowMetadata(flowCapabilities, {
      ...flowPolicy, passwordLoginEnabled: false,
    })).toThrow(IamConfigurationError)
  })
  it('accepts current metadata without the retired verification mode and rejects genuine malformed readiness/policy', () => {
    expect(flowCapabilities).not.toHaveProperty('emailVerificationMode')
    expect(flowPolicy).not.toHaveProperty('emailVerificationMode')
    expect(() =>
      validateFlowMetadata(flowCapabilities, flowPolicy),
    ).not.toThrow()
    expect(() =>
      validateFlowMetadata(
        {
          ...flowCapabilities,
          methods: [
            { ...flowCapabilities.methods[0], availableForLogin: 'yes' },
          ],
        } as never,
        flowPolicy,
      ),
    ).toThrow(IamConfigurationError)
    expect(() =>
      validateFlowMetadata(flowCapabilities, {
        ...flowPolicy,
        allowedRegistrationGrantTypes: ['UNKNOWN'],
      } as never),
    ).toThrow(IamConfigurationError)
    expect(() =>
      validateFlowMetadata(
        {
          ...flowCapabilities,
          resend: { emailVerificationCooldownSeconds: -1 },
        },
        flowPolicy,
      ),
    ).toThrow(IamConfigurationError)
  })
  it('validates registration operations and rejects the retired User result', () => {
    expect(
      parseRegistration({
        registrationId: 'r',
        status: 'PENDING_VERIFICATION',
        expiresAt: '2026-10-20T00:00:00Z',
        nextAction: 'VERIFY_EMAIL',
      }),
    ).toMatchObject({ status: 'PENDING_VERIFICATION' })
    expect(() =>
      parseRegistration({
        id: 'u',
        email: 'u@example.invalid',
        status: 'ACTIVE',
        roles: [],
      }),
    ).toThrow(IamConfigurationError)
  })
  it('rejects multiple and blank grant proofs', () => {
    expect(() =>
      registrationGrantBody({
        type: 'EMAIL_LINK',
        registrationGrantToken: 't',
        registrationAccessCode: 'c',
      }),
    ).toThrow(IamApiError)
    expect(() =>
      registrationGrantBody({
        type: 'ACCESS_CODE',
        registrationAccessCode: ' ',
      }),
    ).toThrow(IamApiError)
    expect(
      registrationGrantBody({
        type: 'ORG_INVITATION',
        organizationInvitationToken: 't',
      }),
    ).toEqual({
      organizationInvitationToken: 't',
    })
  })
  it.each([undefined, null, 'true', 1])(
    'rejects a missing or malformed breached-password policy flag %j',
    (flag) => {
      expect(() =>
        validateFlowMetadata(flowCapabilities, {
          ...flowPolicy,
          breachedPasswordCheck: flag,
        } as unknown as typeof flowPolicy),
      ).toThrow(IamConfigurationError)
    },
  )
  it.each([false, true])(
    'accepts the actual breached-password policy flag %j',
    (flag) => {
      expect(() =>
        validateFlowMetadata(flowCapabilities, {
          ...flowPolicy,
          breachedPasswordCheck: flag,
        }),
      ).not.toThrow()
    },
  )
  it('enforces resolved constraints and strict metadata', () => {
    for (const password of [
      'short',
      'longwithoutupper123!',
      'LongWithoutDigits!',
      'LongWithoutSpecial123',
    ])
      expect(() => assertSignupPassword(password, flowPolicy)).toThrow(
        IamApiError,
      )
    expect(() =>
      assertSignupPassword('ValidPassword123!', flowPolicy),
    ).not.toThrow()
    expect(() =>
      validateFlowMetadata(flowCapabilities, {
        ...flowPolicy,
        minPasswordLength: NaN,
      }),
    ).toThrow(IamConfigurationError)
  })
})
