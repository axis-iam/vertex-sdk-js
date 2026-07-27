import type {
  EmailVerificationMode,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
  RegistrationGrantType,
  SignupMode,
} from './types'
import { requestJson } from './http-client'

export async function fetchPublicAuthPolicy(input: {
  issuer: string
  clientId: string
}): Promise<PublicAuthPolicyResponse> {
  const data = await requestJson<PublicAuthPolicyResponse>(
    `${input.issuer}/api/v1/apps/${encodeURIComponent(input.clientId)}/auth-policy`,
  )
  if (!isEmailVerificationMode(data.emailVerificationMode) || typeof data.idpAutoProvisioningEnabled !== 'boolean'
    || !isSignupMode(data.signupMode) || !isRegistrationGrantTypeArray(data.allowedRegistrationGrantTypes)) {
    throw new Error('Auth policy response is missing registration policy fields')
  }

  return data
}

export async function fetchPublicAuthMethods(input: {
  issuer: string
  clientId: string
}): Promise<PublicAuthMethodsResponse> {
  return normalizePublicAuthMethodsResponse(await requestJson<unknown>(
    `${input.issuer}/api/v1/apps/${encodeURIComponent(input.clientId)}/auth-methods`,
  ))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isEmailVerificationMode(value: unknown): value is EmailVerificationMode {
  return value === 'OFF' || value === 'OPTIONAL' || value === 'REQUIRED'
}

function isSignupMode(value: unknown): value is SignupMode {
  return value === 'OPEN' || value === 'INVITE_REQUIRED' || value === 'DISABLED'
}

function isRegistrationGrantTypeArray(value: unknown): value is RegistrationGrantType[] {
  return Array.isArray(value) && value.every((item) => item === 'EMAIL_LINK' || item === 'ACCESS_CODE' || item === 'ORG_INVITATION')
}

function normalizePublicAuthMethodsResponse(data: unknown): PublicAuthMethodsResponse {
  if (!isRecord(data)) {
    throw new Error('Auth methods response is missing required fields')
  }
  if (!isEmailVerificationMode(data.emailVerificationMode) || !Array.isArray(data.methods) || !Array.isArray(data.idpProviders)) {
    throw new Error('Auth methods response is missing required fields')
  }

  const resend = isRecord(data.resend) ? data.resend : {}
  const cooldown = resend.emailVerificationCooldownSeconds
  const emailVerificationCooldownSeconds = cooldown === undefined
    ? 60
    : cooldown
  if (typeof emailVerificationCooldownSeconds !== 'number' || !Number.isFinite(emailVerificationCooldownSeconds)) {
    throw new Error('Auth methods response is missing required fields')
  }

  return {
    ...(data as unknown as PublicAuthMethodsResponse),
    methods: data.methods as PublicAuthMethodsResponse['methods'],
    idpProviders: data.idpProviders as PublicAuthMethodsResponse['idpProviders'],
    resend: {
      ...(isRecord(data.resend) ? data.resend : {}),
      emailVerificationCooldownSeconds,
    },
  }
}
