import { describe, expect, it, vi } from 'vitest'
import type { IamUser } from '../../core/types'
import {
  type CredentialMethod,
  getAvailableCredentialMethods,
  initialSignInFlowState,
  nextMethodForIdentifier,
  normalizeDirectAuthTokenResponse,
  storeTokensFromResponse,
  signInFlowReducer,
} from './sign-in-flow'

const user: IamUser = {
  id: 'user-1',
  email: 'user@test.com',
  roles: [],
  permissions: [],
  isImpersonating: false,
  raw: { sub: 'user-1' },
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
    const afterPassword = signInFlowReducer(phoneState, { type: 'selectMethod', method: 'password' })

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
  it('keeps the current method only when it is compatible and available', () => {
    const methods: CredentialMethod[] = ['password', 'email_otp', 'sms']

    expect(nextMethodForIdentifier('email', methods, 'email_otp')).toBe('email_otp')
    expect(nextMethodForIdentifier('email', methods, 'sms')).toBe('password')
    expect(nextMethodForIdentifier('phone', methods, 'password')).toBe('sms')
    expect(nextMethodForIdentifier('phone', ['password'], null)).toBeNull()
  })

  it('filters credential methods by identifier kind from auth-methods discovery', () => {
    const authMethods = {
      clientId: 'test-app',
      passwordLoginEnabled: true,
      emailMagicLinkEnabled: true,
      emailOtpEnabled: true,
      smsOtpEnabled: true,
      socialLoginEnabled: false,
      signupEnabled: true,
      selfRegistrationEnabled: true,
      emailVerificationMode: 'OFF',
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
    } as const

    expect(getAvailableCredentialMethods(authMethods, 'email').map((method) => method.id)).toEqual(['password', 'email_otp', 'magic_link'])
    expect(getAvailableCredentialMethods(authMethods, 'phone').map((method) => method.id)).toEqual(['sms'])
  })
})

describe('normalizeDirectAuthTokenResponse', () => {
  it('stores every Direct token response with DIRECT_AUTH provenance', () => {
    const store = vi.fn()
    const setPermissions = vi.fn()
    storeTokensFromResponse({ tokenManager: { store }, setPermissions } as never, {
      access_token: 'access-token', refresh_token: 'refresh-token', token_type: 'Bearer', expires_in: 3600,
    })
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ refresh_token: 'refresh-token' }),
      'DIRECT_AUTH',
      'DIRECT_AUTH',
    )
  })

  it('normalizes valid token responses and permissions', () => {
    expect(normalizeDirectAuthTokenResponse({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      token_type: 'Bearer',
      expires_in: 3600,
      permissions: ['orders:read'],
    })).toEqual({
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
        token_type: 'Bearer',
        expires_in: 3600,
      },
      permissions: ['orders:read'],
    })
  })

  it('rejects invalid token responses', () => {
    expect(() => normalizeDirectAuthTokenResponse({ access_token: 'access-token' })).toThrow('Invalid Direct Auth token response')
    expect(() => normalizeDirectAuthTokenResponse(null)).toThrow('Invalid Direct Auth token response')
  })

  it('rejects MFA challenges because embedded MFA is unsupported', () => {
    expect(() => normalizeDirectAuthTokenResponse({
      mfa_required: true,
      mfa_token: 'mfa-token',
      methods: ['totp'],
    })).toThrow('A token response cannot contain an MFA challenge')
  })
})
