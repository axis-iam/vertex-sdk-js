import { describe, expect, it } from 'vitest'
import { parseIdentifierManagement, parseIdentifierActions, parseIdentifierManagementCapability, parseIdentityProviderTarget } from './identity-management.js'

const capability = { allowed: true, unavailableReasons: [], requirements: ['CURRENT_ACCOUNT_PROOF'], replacementPrimaryIds: [] }
const management = () => ({ add: { USERNAME: capability, EMAIL: capability, PHONE: capability }, proofOptions: [{ method: 'PASSWORD' }] })
const target = { providerId: '019a31b0-0000-7000-8000-000000000001', maskedDisplayName: 'F*** U***', maskedEmail: 'f***@example.invalid', reference: 'a'.repeat(64) }
describe('authenticated identity management wire', () => {
  it('preserves exact allowed/denial/requirement/replacement decisions and actual proof options', () => {
    expect(parseIdentifierManagement(management()).proofOptions[0].method).toBe('PASSWORD')
    const remove = { ...capability, requirements: ['CURRENT_ACCOUNT_PROOF', 'REPLACEMENT_PRIMARY', 'REMAINING_LOGIN_PATH'], replacementPrimaryIds: ['eligible-id'] }
    expect(parseIdentifierManagementCapability(remove)).toEqual(remove)
    const denied = { ...capability, allowed: false, unavailableReasons: ['LAST_LOGIN_METHOD'] }
    expect(parseIdentifierActions({ VERIFY: capability, SET_PRIMARY: capability, REMOVE: denied, REPLACE: capability, TRANSFER: capability }).REMOVE).toEqual(denied)
  })
  it.each([
    null, {}, { ...capability, allowed: 'true' }, { ...capability, unavailableReasons: ['LAST_LOGIN_METHOD'] },
    { ...capability, allowed: false }, { ...capability, requirements: ['UNSUPPORTED'] },
    { ...capability, requirements: ['CURRENT_ACCOUNT_PROOF', 'CURRENT_ACCOUNT_PROOF'] },
    { ...capability, requirements: ['CURRENT_ACCOUNT_PROOF', 'REPLACEMENT_PRIMARY'] },
    { ...capability, replacementPrimaryIds: ['unguarded'] }, { ...capability, fallback: true },
  ])('rejects incomplete or contradictory capability %j', value => { expect(() => parseIdentifierManagementCapability(value)).toThrow() })
  it('does not invent kind/record actions or account proof availability', () => {
    expect(() => parseIdentifierManagement({ ...management(), add: { EMAIL: capability } })).toThrow()
    expect(() => parseIdentifierManagement({ ...management(), proofOptions: [] })).toThrow()
    expect(() => parseIdentifierActions({ REMOVE: capability })).toThrow()
    expect(() => parseIdentifierManagement({ ...management(), proofOptions: [{ method: 'PROVIDER' }] })).toThrow()
  })
  it('projects only the verified provider target presentation and accepts nullable/omitted masks', () => {
    expect(parseIdentityProviderTarget(target)).toEqual(target)
    expect(parseIdentityProviderTarget({ providerId: target.providerId, reference: target.reference })).toEqual({ ...target, maskedDisplayName: null, maskedEmail: null })
    expect(parseIdentityProviderTarget(null)).toBeNull(); expect(parseIdentityProviderTarget(undefined)).toBeNull()
  })
  it.each([
    { ...target, reference: 'A'.repeat(64) }, { ...target, reference: 'a'.repeat(63) }, { ...target, providerId: 'catalog-entry' },
    { ...target, subject: 'raw-subject' }, { ...target, access_token: 'private-token' }, { ...target, claims: {} },
  ])('rejects malformed/private provider target %j', value => { expect(() => parseIdentityProviderTarget(value)).toThrow() })
})
