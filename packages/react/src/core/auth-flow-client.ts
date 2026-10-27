import { parseAuthCapabilities, parseDefaultLogin, parseSignupIdentifierKinds } from '@axis-iam/vertex'
import { requestJson, requestNoContent } from './http-client'
import { IamApiError, IamConfigurationError } from './types'
import type { AuthClient } from './auth-client'
import type {
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
} from './types'

export function validateFlowMetadata(
  capabilities: PublicAuthMethodsResponse,
  policy: PublicAuthPolicyResponse,
): void {
  validateIdentifierCapabilities(capabilities)
  parseDefaultLogin(policy.defaultLogin)
  parseSignupIdentifierKinds(policy.allowedSignupIdentifierKinds)
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
    !Number.isSafeInteger(
      capabilities.resend.emailVerificationCooldownSeconds,
    ) ||
    capabilities.resend.emailVerificationCooldownSeconds < 0 ||
    !Number.isSafeInteger(policy.minPasswordLength) ||
    policy.minPasswordLength < 1 ||
    ![
      policy.requireUppercase,
      policy.requireLowercase,
      policy.requireDigit,
      policy.requireSpecialChar,
      policy.breachedPasswordCheck,
    ].every((x) => typeof x === 'boolean') ||
    !['OPEN', 'INVITE_REQUIRED', 'DISABLED'].includes(policy.signupMode) ||
    !Array.isArray(policy.allowedRegistrationGrantTypes) ||
    !policy.allowedRegistrationGrantTypes.every((x) =>
      ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'].includes(x),
    ) ||
    !capabilities.methods.every(
      (x) =>
        typeof x.availableForLogin === 'boolean' &&
        typeof x.availableForSignup === 'boolean',
    ) ||
    !capabilities.idpProviders.every(
      (x) =>
        typeof x.id === 'string' && typeof x.availableForSignup === 'boolean',
    )
  )
    throw malformed('auth capability/policy')
}
export function validateIdentifierCapabilities(value: unknown): void {
  if (!isRecord(value) || !Array.isArray(value.identifierMethods))
    throw malformed('identifier capability')
  const parsed = parseAuthCapabilities(value)
  if (!parsed.identifierMethods.every(entry => entry.methods.every(method =>
    Array.isArray(value.methods) && value.methods.some(item => isRecord(item) && item.type === method && item.availableForLogin === true)))) throw malformed('identifier capability')
}
export function registrationGrantBody(input?: unknown): Record<string, string> {
  if (input === undefined) return {}
  if (!isRecord(input)) throw invalidGrant()
  const fields = [
    'registrationGrantToken',
    'registrationAccessCode',
    'organizationInvitationToken',
  ].filter((key) => input[key] !== undefined)
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
    !input[field].trim() ||
    input[field].length > (field === 'registrationAccessCode' ? 128 : 2048)
  )
    throw invalidGrant()
  return { [field]: input[field] }
}
export function assertSignupPassword(
  password: string,
  policy: PublicAuthPolicyResponse,
): void {
  if (
    password.length < policy.minPasswordLength ||
    (policy.requireUppercase && !/[A-Z]/.test(password)) ||
    (policy.requireLowercase && !/[a-z]/.test(password)) ||
    (policy.requireDigit && !/\d/.test(password)) ||
    (policy.requireSpecialChar && !/[^A-Za-z0-9]/.test(password))
  ) {
    throw new IamApiError(
      'Password does not meet the application requirements.',
      {
        status: 400,
        code: 'PASSWORD_POLICY_VIOLATION',
      },
    )
  }
}
export async function authFlowRequest(
  client: AuthClient,
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
