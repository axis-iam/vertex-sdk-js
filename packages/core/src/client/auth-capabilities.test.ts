import { describe, it, expect } from 'vitest'
import { parseAuthCapabilities, parseSignupIdentifierKinds, AuthCapabilitiesError } from './auth-capabilities.js'
const source = () => ({ identifierRestrictions: { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }, identifierMethods: [{ kind: 'PHONE', methods: ['SMS_OTP', 'PASSWORD'] }, { kind: 'EMAIL', methods: ['EMAIL_OTP', 'PASSWORD', 'EMAIL_MAGIC_LINK'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }], defaultIdentifierKind: 'PHONE', defaultLogin: { identifierKind: 'PHONE', method: 'SMS_OTP' }, allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'] })
describe('producer-resolved authentication experience', () => {
  it('accepts disabled empty password policy without inventing a password capability', () => {
    expect(parseAuthCapabilities({ ...source(), passwordLoginEnabled: false,
      allowedPasswordIdentifierKinds: [], identifierMethods: [], defaultIdentifierKind: null, defaultLogin: null,
    }).allowedPasswordIdentifierKinds).toEqual([])
  })
  it.each([
    { allowedPasswordIdentifierKinds: [] },
    { allowedPasswordIdentifierKinds: ['PHONE'] },
    { allowedPasswordIdentifierKinds: ['EMAIL', 'EMAIL'] },
    { allowedPasswordIdentifierKinds: ['INVALID'] },
    { allowedPasswordIdentifierKinds: null },
    { passwordLoginEnabled: false },
  ])('rejects inconsistent or malformed password policy: %j', patch => {
    expect(() => parseAuthCapabilities({ ...source(), passwordLoginEnabled: true, ...patch })).toThrow(AuthCapabilitiesError)
  })
  it('preserves actual default and both server orders without consulting a policy preference', () => {
    expect(parseAuthCapabilities(source())).toEqual(source())
  })
  it('keeps no local capability genuinely empty', () => {
    expect(parseAuthCapabilities({ ...source(), identifierMethods: [], defaultIdentifierKind: null, defaultLogin: null, allowedSignupIdentifierKinds: [] })).toMatchObject({ identifierMethods: [], defaultLogin: null, allowedSignupIdentifierKinds: [] })
  })
  it('fails closed when password identifier policy is missing', () => {
    const payload = source() as Record<string, unknown>
    delete payload.allowedPasswordIdentifierKinds
    expect(() => parseAuthCapabilities(payload)).toThrow(AuthCapabilitiesError)
  })
  it.each([
    { defaultLogin: undefined }, { defaultLogin: null }, { defaultLogin: { identifierKind: 'PHONE', method: 'PASSWORD' } },
    { defaultIdentifierKind: 'EMAIL' }, { identifierMethods: [{ kind: 'USERNAME', methods: ['SMS_OTP'] }] },
    { identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'PASSWORD'] }] },
    { allowedSignupIdentifierKinds: ['PHONE'] }, { allowedSignupIdentifierKinds: null },
    { allowedSignupIdentifierKinds: ['USERNAME', 'EMAIL'] },
  ])('fails closed rather than inventing a combination: %j', patch => {
    expect(() => parseAuthCapabilities({ ...source(), ...patch })).toThrow(AuthCapabilitiesError)
  })
  it('distinguishes disabled signup from malformed missing/inherit values in public effective responses', () => {
    expect(parseSignupIdentifierKinds([])).toEqual([])
    expect(parseSignupIdentifierKinds(['USERNAME'])).toEqual(['USERNAME'])
    expect(() => parseSignupIdentifierKinds(undefined)).toThrow(AuthCapabilitiesError)
  })
})
