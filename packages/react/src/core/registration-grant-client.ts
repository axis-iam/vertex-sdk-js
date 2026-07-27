import { requestJson } from './http-client'
import { IamApiError } from './types'
import type {
  OIDCConfiguration,
  RegistrationGrantInput,
  RegistrationGrantPreviewResponse,
  RegistrationGrantPreviewStatus,
  RegistrationGrantType,
} from './types'

export interface RegistrationGrantClientOptions {
  clientId: string
  discover: () => Promise<OIDCConfiguration>
}

/** Browser-safe public preview client. It never attaches a bearer token. */
export class RegistrationGrantClient {
  constructor(private readonly options: RegistrationGrantClientOptions) {}

  async preview(input: RegistrationGrantInput): Promise<RegistrationGrantPreviewResponse> {
    const body = registrationGrantRequestBody(input)
    const config = await this.options.discover()
    const data = await requestJson<unknown>(
      `${config.issuer}/api/v1/apps/${encodeURIComponent(this.options.clientId)}/registration-grants:preview`,
      {
        method: 'POST',
        json: body,
      },
    )
    return normalizeRegistrationGrantPreview(data)
  }
}

export function registrationGrantRequestBody(input: RegistrationGrantInput): Record<string, string> {
  if (!isRecord(input)) throw invalidRegistrationGrant()

  switch (input.type) {
    case 'EMAIL_LINK':
      return { registrationGrantToken: requireProof(input.registrationGrantToken) }
    case 'ACCESS_CODE':
      return { registrationAccessCode: requireProof(input.registrationAccessCode) }
    case 'ORG_INVITATION':
      return { organizationInvitationToken: requireProof(input.organizationInvitationToken) }
    default:
      throw invalidRegistrationGrant()
  }
}

function normalizeRegistrationGrantPreview(data: unknown): RegistrationGrantPreviewResponse {
  if (!isRecord(data) || !isPreviewStatus(data.status)) {
    throw new Error('Registration grant preview response is invalid')
  }
  if (data.status === 'UNAVAILABLE') {
    return {
      status: 'UNAVAILABLE',
      type: null,
      emailHint: null,
      domainHint: null,
      applicationName: null,
      expiresAt: null,
      allowedAuthMethods: [],
    }
  }
  if (!isRegistrationGrantType(data.type) || !isNullableString(data.emailHint) || !isNullableString(data.domainHint)
    || !isNullableString(data.applicationName) || !isNullableString(data.expiresAt) || !isStringArray(data.allowedAuthMethods)) {
    throw new Error('Registration grant preview response is invalid')
  }
  return {
    status: 'VALID',
    type: data.type,
    emailHint: data.emailHint,
    domainHint: data.domainHint,
    applicationName: data.applicationName,
    expiresAt: data.expiresAt,
    allowedAuthMethods: data.allowedAuthMethods,
  }
}

function requireProof(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidRegistrationGrant()
  return value
}

function invalidRegistrationGrant(): IamApiError {
  return new IamApiError('Registration grant proof is required', {
    status: 400,
    code: 'REGISTRATION_GRANT_INVALID',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPreviewStatus(value: unknown): value is RegistrationGrantPreviewStatus {
  return value === 'VALID' || value === 'UNAVAILABLE'
}

function isRegistrationGrantType(value: unknown): value is RegistrationGrantType {
  return value === 'EMAIL_LINK' || value === 'ACCESS_CODE' || value === 'ORG_INVITATION'
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
