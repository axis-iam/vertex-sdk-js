import { parseMfaProofOption } from './account-security-operations.js'
import type { IdentifierManagement, IdentifierManagementAction, IdentifierManagementCapability, IdentityProviderTarget } from './identity.js'

export class IdentityManagementResponseError extends Error {
  readonly code = 'INVALID_IDENTITY_RESPONSE'
  constructor() { super('Invalid authenticated identity management response'); this.name = 'IdentityManagementResponseError' }
}
const invalid = (): never => { throw new IdentityManagementResponseError() }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, expected: string[]) {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !(key in value))) invalid()
}
function text(value: unknown): string { return typeof value === 'string' && value.length > 0 ? value : invalid() }
function list<T>(value: unknown, parse: (value: unknown) => T): T[] { return Array.isArray(value) ? value.map(parse) : invalid() }
function unique<T>(value: T[]): T[] { return new Set(value).size === value.length ? value : invalid() }
function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  for (const choice of choices) if (value === choice) return choice
  return invalid()
}
export function parseIdentifierManagementCapability(value: unknown): IdentifierManagementCapability {
  const v = record(value)
  keys(v, ['allowed', 'unavailableReasons', 'requirements', 'replacementPrimaryIds'])
  if (typeof v.allowed !== 'boolean') return invalid()
  const unavailableReasons = unique(list(v.unavailableReasons, x => oneOf(x, [
    'ACCOUNT_INACTIVE', 'MANAGED_IDENTIFIER', 'METHOD_UNAVAILABLE', 'REAUTH_METHOD_UNAVAILABLE', 'TARGET_PROOF_UNAVAILABLE',
    'IDENTIFIER_ALREADY_EXISTS', 'NOT_APPLICABLE', 'ALREADY_VERIFIED', 'ALREADY_PRIMARY', 'IDENTIFIER_UNVERIFIED',
    'IDENTIFIER_RANGE_REJECTED', 'LAST_LOGIN_METHOD', 'PRIMARY_REPLACEMENT_UNAVAILABLE',
  ] as const)))
  const requirements = unique(list(v.requirements, x => oneOf(x, [
    'CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_EMAIL_OTP', 'TARGET_PHONE_OTP', 'REPLACEMENT_PRIMARY',
    'REMOVE_OLD', 'COUNTERPART_CONFIRMATION', 'REMAINING_LOGIN_PATH',
  ] as const)))
  const replacementPrimaryIds = unique(list(v.replacementPrimaryIds, text))
  if (v.allowed !== (unavailableReasons.length === 0) || !requirements.includes('CURRENT_ACCOUNT_PROOF')) return invalid()
  if (replacementPrimaryIds.length && !requirements.includes('REPLACEMENT_PRIMARY')) return invalid()
  if (v.allowed && requirements.includes('REPLACEMENT_PRIMARY') && !replacementPrimaryIds.length) return invalid()
  return { allowed: v.allowed, unavailableReasons, requirements, replacementPrimaryIds }
}
export function parseIdentifierActions(value: unknown): Record<IdentifierManagementAction, IdentifierManagementCapability> {
  const v = record(value)
  keys(v, ['VERIFY', 'SET_PRIMARY', 'REMOVE', 'REPLACE', 'TRANSFER'])
  return { VERIFY: parseIdentifierManagementCapability(v.VERIFY), SET_PRIMARY: parseIdentifierManagementCapability(v.SET_PRIMARY),
    REMOVE: parseIdentifierManagementCapability(v.REMOVE), REPLACE: parseIdentifierManagementCapability(v.REPLACE), TRANSFER: parseIdentifierManagementCapability(v.TRANSFER) }
}
export function parseIdentifierManagement(value: unknown): IdentifierManagement {
  const v = record(value), add = record(v.add)
  keys(v, ['add', 'proofOptions']); keys(add, ['USERNAME', 'EMAIL', 'PHONE'])
  const proofOptions = list(v.proofOptions, parseMfaProofOption)
  unique(proofOptions.map(option => JSON.stringify(option)))
  const parsed = { USERNAME: parseIdentifierManagementCapability(add.USERNAME), EMAIL: parseIdentifierManagementCapability(add.EMAIL), PHONE: parseIdentifierManagementCapability(add.PHONE) }
  if (!proofOptions.length && Object.values(parsed).some(capability => capability.allowed)) return invalid()
  return { add: parsed, proofOptions }
}
/** Nullable presentation comes only from the verified LINK target adapter, not the provider directory. */
export function parseIdentityProviderTarget(value: unknown): IdentityProviderTarget | null {
  if (value == null) return null
  const v = record(value)
  if (Object.keys(v).some(key => !['providerId', 'maskedDisplayName', 'maskedEmail', 'reference'].includes(key))) return invalid()
  const providerId = text(v.providerId), reference = text(v.reference)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providerId) || !/^[0-9a-f]{64}$/.test(reference)) return invalid()
  return { providerId, reference, maskedDisplayName: v.maskedDisplayName == null ? null : text(v.maskedDisplayName), maskedEmail: v.maskedEmail == null ? null : text(v.maskedEmail) }
}
