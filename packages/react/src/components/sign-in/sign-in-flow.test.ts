import { describe, expect, it } from 'vitest'
import type { IamUser, PublicAuthMethodsResponse } from '../../core/types'
import { flowCapabilities } from '../../core/auth-flow-fixtures.test-support'
import {
  type CredentialMethod,
  getAvailableCredentialMethods,
  getAvailableProviderOptions,
  initialSignInFlowState,
  nextMethodForIdentifier,
  signInFlowReducer,
} from './sign-in-flow'

const user: IamUser = {
  id: 'user-1',
  email: 'user@test.com',
  roles: [],
  permissions: [],
  isImpersonating: false,
}

describe('signInFlowReducer', () => {
  it('keeps invalid identifiers on the identifier step', () => {
    const state = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: 'username-only' })

    expect(state).toMatchObject({
      step: 'identifier',
      identifierDraft: 'username-only',
      identifierError: 'Enter a valid email address or phone number.',
      selectedMethod: null,
    })
  })

  it('trims valid identifiers and enters the method step without a selected method', () => {
    const state = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: '  user@test.com  ' })

    expect(state).toMatchObject({
      step: 'method',
      identifierDraft: 'user@test.com',
      identifier: 'user@test.com',
      identifierKind: 'email',
      selectedMethod: null,
    })
  })

  it('rejects method selections that are incompatible with the identifier kind', () => {
    const emailState = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: 'user@test.com' })
    const afterSms = signInFlowReducer(emailState, { type: 'selectMethod', method: 'sms' })

    expect(afterSms).toBe(emailState)

    const phoneState = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: '+8613800138000' })
    const afterPassword = signInFlowReducer(phoneState, { type: 'selectMethod', method: 'magic_link' })

    expect(afterPassword).toBe(phoneState)
  })

  it('reconciles stale selections against backend-discovered credential methods', () => {
    const methodState = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: 'user@test.com' })
    const selectedEmailOtp = signInFlowReducer(methodState, { type: 'selectMethod', method: 'email_otp' })
    const reconciled = signInFlowReducer(selectedEmailOtp, { type: 'syncCredentialMethods', methods: ['password'] })

    expect(reconciled).toMatchObject({
      step: 'method',
      selectedMethod: 'password',
    })
  })

  it('clears selected method when no discovered methods are compatible', () => {
    const methodState = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: 'user@test.com' })
    const selectedPassword = signInFlowReducer(methodState, { type: 'selectMethod', method: 'password' })
    const reconciled = signInFlowReducer(selectedPassword, { type: 'syncCredentialMethods', methods: ['sms'] })

    expect(reconciled).toMatchObject({
      step: 'method',
      selectedMethod: null,
    })
  })

  it('ignores success outside the method step', () => {
    const state = signInFlowReducer(initialSignInFlowState, { type: 'success', user })

    expect(state).toBe(initialSignInFlowState)
  })

  it('preserves method context when entering a typed error', () => {
    const methodState = signInFlowReducer(initialSignInFlowState, { type: 'continueIdentifier', value: 'user@test.com' })
    const selectedPassword = signInFlowReducer(methodState, { type: 'selectMethod', method: 'password' })
    const errorState = signInFlowReducer(selectedPassword, { type: 'typedError', message: 'Invalid credentials' })

    expect(errorState).toMatchObject({
      step: 'error',
      identifier: 'user@test.com',
      identifierKind: 'email',
      identifierError: 'Invalid credentials',
      selectedMethod: 'password',
    })
  })
})

describe('credential method helpers', () => {
  it('preserves email-only password and independent email/SMS OTP discovery', () => {
    const capabilities: PublicAuthMethodsResponse = {
      ...flowCapabilities,
      allowedPasswordIdentifierKinds: ['EMAIL'],
      identifierMethods: [
        { kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP'] },
        { kind: 'PHONE', methods: ['SMS_OTP'] },
      ],
    }
    expect(getAvailableCredentialMethods(capabilities, 'email')).toEqual([{ id: 'password' }, { id: 'email_otp' }])
    expect(getAvailableCredentialMethods(capabilities, 'phone')).toEqual([{ id: 'sms' }])
    expect(getAvailableCredentialMethods(capabilities, 'username')).toEqual([])
    const withoutPassword = { ...capabilities, passwordLoginEnabled: false,
      identifierMethods: [{ kind: 'EMAIL', methods: ['EMAIL_OTP'] }, { kind: 'PHONE', methods: ['SMS_OTP'] }] } satisfies PublicAuthMethodsResponse
    expect(getAvailableCredentialMethods(withoutPassword, 'email')).toEqual([{ id: 'email_otp' }])
    expect(getAvailableCredentialMethods(withoutPassword, 'phone')).toEqual([{ id: 'sms' }])
  })

  it('takes signup intent directly and never matches a provider by name or type', () => {
    const first = { ...flowCapabilities.idpProviders[0]!, availableForSignup: false }
    const second = { ...first, id: 'other-exact-id', displayName: 'Backend second', availableForSignup: true }
    const capabilities = { ...flowCapabilities, idpProviders: [first, second] }
    expect(getAvailableProviderOptions(capabilities)).toEqual([first, second])
    expect(getAvailableProviderOptions(capabilities, 'sign-up')).toEqual([second])
  })

  it('keeps the current method only when it is compatible and available', () => {
    const methods: CredentialMethod[] = ['password', 'email_otp', 'sms']

    expect(nextMethodForIdentifier('email', methods, 'email_otp')).toBe('email_otp')
    expect(nextMethodForIdentifier('email', methods, 'sms')).toBe('password')
    expect(nextMethodForIdentifier('phone', methods, 'password')).toBe('password')
    expect(nextMethodForIdentifier('phone', ['password'], null)).toBe('password')
  })

  it('filters credential methods by identifier kind from auth-methods discovery', () => {
    const authMethods: PublicAuthMethodsResponse = {
      identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP', 'EMAIL_MAGIC_LINK'] }, { kind: 'PHONE', methods: ['SMS_OTP', 'PASSWORD'] }],
      defaultIdentifierKind: 'EMAIL', defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
      allowedSignupIdentifierKinds: ['EMAIL'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
      clientId: 'test-app',
      passwordLoginEnabled: true,
      emailMagicLinkEnabled: true,
      emailOtpEnabled: true,
      smsOtpEnabled: true,
      socialLoginEnabled: false,
      signupEnabled: true,
      selfRegistrationEnabled: true,
      idpAutoProvisioningEnabled: false,
      loginInitiationUri: null,
      postVerificationRedirectUri: null,
      methods: [
        { type: 'PASSWORD', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
        { type: 'EMAIL_OTP', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
        { type: 'EMAIL_MAGIC_LINK', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
        { type: 'SMS_OTP', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
      ],
      idpProviders: [],
      resend: { emailVerificationCooldownSeconds: 60 },
    }

    expect(getAvailableCredentialMethods(authMethods, 'email').map((method) => method.id)).toEqual(['password', 'email_otp', 'magic_link'])
    expect(getAvailableCredentialMethods(authMethods, 'phone').map((method) => method.id)).toEqual(['sms', 'password'])
  })
})
