import type { AccountIdentifier, AccountIdentifiers, IdentifierManagementCapability, IdentifierManagementDenial, IdentifierManagementRequirement } from '@axis-iam/vertex'

export const managementCapability = (unavailableReasons: IdentifierManagementDenial[] = [], requirements: IdentifierManagementRequirement[] = ['CURRENT_ACCOUNT_PROOF'], replacementPrimaryIds: string[] = []): IdentifierManagementCapability => ({ allowed: unavailableReasons.length === 0, unavailableReasons, requirements, replacementPrimaryIds })
type FixtureIdentifier = Omit<AccountIdentifier, 'capabilities' | 'kind' | 'status'> & { kind: string; status: string; capabilities?: AccountIdentifier['capabilities'] }
/** An explicit protocol fixture: the account has a password and another complete provider path. */
export function managedIdentifiers(items: FixtureIdentifier[] = [], loginMethodVersion = 4): AccountIdentifiers {
  return { loginMethodVersion, management: { add: {
    USERNAME: managementCapability(items.some(item => item.kind === 'USERNAME') ? ['IDENTIFIER_ALREADY_EXISTS'] : [], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER']),
    EMAIL: managementCapability([], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_EMAIL_OTP']),
    PHONE: managementCapability([], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_PHONE_OTP']),
  }, proofOptions: [{ method: 'PASSWORD', identifierId: null, maskedIdentifier: null, methodId: null, displayName: null, availableMethods: [] }] }, items: items.map(item => {
    if (item.kind !== 'EMAIL' && item.kind !== 'PHONE' && item.kind !== 'USERNAME') throw new Error('Invalid fixture kind')
    if (item.status !== 'ACTIVE' && item.status !== 'INACTIVE') throw new Error('Invalid fixture status')
    const managed: IdentifierManagementDenial[] = item.managedBy ? ['MANAGED_IDENTIFIER'] : []
    const replacements = items.filter(other => other.id !== item.id && other.kind === item.kind)
    const eligible = replacements.filter(other => other.verificationState === 'VERIFIED').map(other => other.id)
    const replacementRequired = item.isPrimary && replacements.length > 0
    const replacementRequirements: IdentifierManagementRequirement[] = replacementRequired ? ['REPLACEMENT_PRIMARY'] : []
    const target: IdentifierManagementRequirement[] = item.kind === 'EMAIL' ? ['TARGET_EMAIL_OTP'] : item.kind === 'PHONE' ? ['TARGET_PHONE_OTP'] : []
    const removalReasons: IdentifierManagementDenial[] = replacementRequired && !eligible.length ? [...managed, 'PRIMARY_REPLACEMENT_UNAVAILABLE'] : managed
    return { ...item, kind: item.kind, status: item.status, capabilities: item.capabilities ?? {
      VERIFY: managementCapability(item.kind === 'USERNAME' ? ['NOT_APPLICABLE'] : item.verificationState === 'VERIFIED' ? ['ALREADY_VERIFIED'] : [], ['CURRENT_ACCOUNT_PROOF', ...target]),
      SET_PRIMARY: managementCapability([...managed, ...(item.isPrimary ? ['ALREADY_PRIMARY' as const] : []), ...(item.kind !== 'USERNAME' && item.verificationState !== 'VERIFIED' ? ['IDENTIFIER_UNVERIFIED' as const] : [])]),
      REMOVE: managementCapability(removalReasons, ['CURRENT_ACCOUNT_PROOF', 'REMAINING_LOGIN_PATH', ...replacementRequirements], replacementRequired ? eligible : []),
      REPLACE: managementCapability(managed, ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'REMAINING_LOGIN_PATH', ...target, ...(item.kind === 'USERNAME' ? ['REMOVE_OLD' as const] : [])]),
      TRANSFER: managementCapability(removalReasons, ['CURRENT_ACCOUNT_PROOF', 'REMAINING_LOGIN_PATH', 'COUNTERPART_CONFIRMATION', ...target, ...replacementRequirements], replacementRequired ? eligible : []),
    } }
  }) }
}
