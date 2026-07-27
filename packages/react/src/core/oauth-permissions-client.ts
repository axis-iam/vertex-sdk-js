import type { PermissionResponse } from './types'
import { IamConfigurationError } from './types'
import { requestJson } from './http-client'

export async function fetchOAuthPermissionSummary(input: {
  issuer: string
  accessToken: string
}): Promise<PermissionResponse> {
  const data = await requestJson<PermissionResponse>(`${input.issuer}/api/v1/auth/me/permissions`, {
    bearerToken: input.accessToken,
  })
  return normalizePermissionResponse(data)
}

export function normalizePermissionResponse(data: PermissionResponse): PermissionResponse {
  if (
    !isRecord(data)
    || !isNonEmptyString(data.applicationId)
    || (data.organizationId !== null && !isNonEmptyString(data.organizationId))
    || !isStringArray(data.roles)
    || !isStringArray(data.permissions)
  ) {
    throw new IamConfigurationError('IAM permissions response was malformed')
  }
  return {
    applicationId: data.applicationId,
    organizationId: data.organizationId,
    roles: [...data.roles],
    permissions: [...data.permissions],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
