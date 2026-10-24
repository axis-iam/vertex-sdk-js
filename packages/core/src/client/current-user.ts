/** Safe API views; Access Token bytes are never an identity or permission source. */
export interface AuthenticationContext {
  subjectType: 'USER'
  applicationId: string
  clientId: string
  sessionId: string
  workspaceId: string | null
  workspaceSelectionRequired: boolean
  organizationId: string | null
  organizationSlug: string | null
  organizationRole: string | null
  authTime: string | null
  authenticationMethods: string[]
  assuranceLevel: string | null
  impersonation: { actorId: string; impersonationId: string } | null
}

export interface CurrentUser {
  id: string
  email: string | null
  username: string | null
  status: string
  emailVerified: boolean
  authenticationContext: AuthenticationContext
  metadata: Record<string, unknown>
}

export function parseCurrentUser(value: unknown): CurrentUser {
  const v = object(value)
  const c = object(v.authenticationContext)
  if (c.subjectType !== 'USER') throw new TypeError('Invalid current-user subject type')
  const impersonation = c.impersonation === null ? null : object(c.impersonation)
  const authTime = nullableText(c.authTime)
  if (authTime !== null && (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(authTime) || !Number.isFinite(Date.parse(authTime))))
    throw new TypeError('Invalid authentication time')
  if ((c.workspaceSelectionRequired === true && c.workspaceId !== null) ||
      (c.organizationId === null && (c.organizationSlug !== null || c.organizationRole !== null)))
    throw new TypeError('Inconsistent current-user context')
  return {
    id: text(v.id), email: nullableText(v.email), username: nullableText(v.username),
    status: text(v.status), emailVerified: boolean(v.emailVerified), metadata: { ...object(v.metadata) },
    authenticationContext: {
      subjectType: 'USER', applicationId: text(c.applicationId), clientId: text(c.clientId), sessionId: text(c.sessionId),
      workspaceId: nullableText(c.workspaceId), workspaceSelectionRequired: boolean(c.workspaceSelectionRequired),
      organizationId: nullableText(c.organizationId), organizationSlug: nullableText(c.organizationSlug),
      organizationRole: nullableText(c.organizationRole), authTime,
      authenticationMethods: strings(c.authenticationMethods), assuranceLevel: nullableText(c.assuranceLevel),
      impersonation: impersonation && { actorId: text(impersonation.actorId), impersonationId: text(impersonation.impersonationId) },
    },
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid current-user view')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Missing current-user binding')
  return value
}
function nullableText(value: unknown): string | null { return value === null ? null : text(value) }
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Invalid current-user flag')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid authentication methods')
  return value.map(text)
}
