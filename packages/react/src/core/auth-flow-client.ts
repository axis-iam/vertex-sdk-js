import { requestJson, requestNoContent } from './http-client'
import { IamApiError, IamConfigurationError } from './types'
import { parseTokenResponse } from './token-response'
import { decodeJwt } from './jwt'
import type { OAuthClient } from './oauth-client'
import type { PublicAuthMethodsResponse, PublicAuthPolicyResponse } from './types'
import type { SignUpUserInfo } from './auth-flow-types'

export type DirectAuthResult =
  | { kind: 'tokens'; data: unknown }
  | { kind: 'mfa'; token: string; methods: ['totp'] }
export function parseDirectAuthResult(data: unknown): DirectAuthResult {
  if (!isRecord(data)) throw malformed('authentication')
  if (data.mfa_required === true) {
    if (
      typeof data.mfa_token !== 'string' ||
      !data.mfa_token ||
      !Array.isArray(data.mfa_methods) ||
      data.mfa_methods.length !== 1 ||
      data.mfa_methods[0] !== 'totp' ||
      data.access_token !== undefined ||
      data.refresh_token !== undefined
    )
      throw malformed('MFA challenge')
    return { kind: 'mfa', token: data.mfa_token, methods: ['totp'] }
  }
  if (data.mfa_token !== undefined || (data.mfa_required !== undefined && data.mfa_required !== false))
    throw malformed('authentication')
  try {
    const tokens = parseTokenResponse(data)
    const payload = decodeJwt(tokens.access_token)
    if (typeof payload.sub !== 'string' || !payload.sub) throw malformed('authentication user')
  } catch (error) {
    throw new IamConfigurationError('Invalid authentication token response', error)
  }
  return { kind: 'tokens', data }
}
export function parseSignupUser(data: unknown): SignUpUserInfo {
  if (
    !isRecord(data) ||
    typeof data.id !== 'string' ||
    !data.id ||
    typeof data.email !== 'string' ||
    !data.email ||
    typeof data.status !== 'string' ||
    !data.status ||
    typeof data.emailVerified !== 'boolean' ||
    !Array.isArray(data.roles) ||
    !data.roles.every((x): x is string => typeof x === 'string') ||
    (data.username !== undefined && data.username !== null && typeof data.username !== 'string') ||
    (data.metadata !== undefined && !isRecord(data.metadata))
  )
    throw malformed('signup')
  return {
    id: data.id,
    email: data.email,
    status: data.status,
    emailVerified: data.emailVerified,
    roles: data.roles,
    ...(data.username !== undefined ? { username: data.username } : {}),
    ...(isRecord(data.metadata) ? { metadata: data.metadata } : {}),
  }
}
export function validateFlowMetadata(
  capabilities: PublicAuthMethodsResponse,
  policy: PublicAuthPolicyResponse,
): void {
  if (
    !isRecord(capabilities) ||
    !isRecord(policy) ||
    !isRecord(capabilities.resend) ||
    !Array.isArray(capabilities.methods) ||
    !Array.isArray(capabilities.idpProviders) ||
    !capabilities.methods.every(isRecord) ||
    !capabilities.idpProviders.every(isRecord)
  )
    throw malformed('auth capability/policy')
  if (
    ![
      capabilities.signupEnabled,
      capabilities.selfRegistrationEnabled,
      capabilities.socialLoginEnabled,
    ].every((x) => typeof x === 'boolean') ||
    !Number.isSafeInteger(capabilities.resend.emailVerificationCooldownSeconds) ||
    capabilities.resend.emailVerificationCooldownSeconds < 0 ||
    !Number.isSafeInteger(policy.minPasswordLength) ||
    policy.minPasswordLength < 1 ||
    ![policy.requireUppercase, policy.requireLowercase, policy.requireDigit, policy.requireSpecialChar, policy.breachedPasswordCheck].every(
      (x) => typeof x === 'boolean',
    ) ||
    !['OPEN', 'INVITE_REQUIRED', 'DISABLED'].includes(policy.signupMode) ||
    !Array.isArray(policy.allowedRegistrationGrantTypes) ||
    !policy.allowedRegistrationGrantTypes.every((x) =>
      ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'].includes(x),
    ) ||
    !['OFF', 'OPTIONAL', 'REQUIRED'].includes(capabilities.emailVerificationMode) ||
    !capabilities.methods.every(
      (x) => typeof x.availableForLogin === 'boolean' && typeof x.availableForSignup === 'boolean',
    ) ||
    !capabilities.idpProviders.every(
      (x) => typeof x.id === 'string' && typeof x.availableForSignup === 'boolean',
    )
  )
    throw malformed('auth capability/policy')
}
export function registrationGrantBody(input?: unknown): Record<string, string> {
  if (input === undefined) return {}
  if (!isRecord(input)) throw invalidGrant()
  const fields = ['registrationGrantToken', 'registrationAccessCode', 'organizationInvitationToken'].filter(
    (key) => input[key] !== undefined,
  )
  const field =
    input.type === 'EMAIL_LINK'
      ? 'registrationGrantToken'
      : input.type === 'ACCESS_CODE'
        ? 'registrationAccessCode'
        : input.type === 'ORG_INVITATION'
          ? 'organizationInvitationToken'
          : null
  if (
    !field ||
    fields.length !== 1 ||
    fields[0] !== field ||
    typeof input[field] !== 'string' ||
    !input[field].trim()
  )
    throw invalidGrant()
  return { [field]: input[field] }
}
export function assertSignupPassword(password: string, policy: PublicAuthPolicyResponse): void {
  if (
    password.length < policy.minPasswordLength ||
    (policy.requireUppercase && !/[A-Z]/.test(password)) ||
    (policy.requireLowercase && !/[a-z]/.test(password)) ||
    (policy.requireDigit && !/\d/.test(password)) ||
    (policy.requireSpecialChar && !/[^A-Za-z0-9]/.test(password))
  ) {
    throw new IamApiError('Password does not meet the application requirements.', {
      status: 400,
      code: 'PASSWORD_POLICY_VIOLATION',
    })
  }
}
export async function authFlowRequest(
  client: OAuthClient,
  path: string,
  body: unknown,
  assertCurrent: () => void,
  noContent = false,
): Promise<unknown> {
  const config = await client.discover()
  assertCurrent()
  const url = new URL(`/api/v1/auth/${path}`, config.issuer).toString()
  const result = noContent
    ? await requestNoContent(url, { method: 'POST', json: body })
    : await requestJson<unknown>(url, { method: 'POST', json: body })
  assertCurrent()
  return result
}
function malformed(subject: string) {
  return new IamConfigurationError(`Invalid ${subject} response`)
}
function invalidGrant() {
  return new IamApiError('Registration grant proof is invalid.', {
    status: 400,
    code: 'REGISTRATION_GRANT_INVALID',
  })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
