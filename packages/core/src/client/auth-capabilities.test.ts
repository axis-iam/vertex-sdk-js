import { describe, it, expect } from 'vitest'
import { parseAuthCapabilities, parseSignupIdentifierKinds, AuthCapabilitiesError } from './auth-capabilities.js'
const source = () => ({ identifierMethods: [{ kind: 'PHONE', methods: ['SMS_OTP', 'PASSWORD'] }, { kind: 'EMAIL', methods: ['EMAIL_OTP', 'PASSWORD', 'EMAIL_MAGIC_LINK'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }], defaultIdentifierKind: 'PHONE', defaultLogin: { identifierKind: 'PHONE', method: 'SMS_OTP' }, allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'] })
describe('producer-resolved authentication experience', () => {
  it('preserves actual default and both server orders without consulting a policy preference', () => {
    expect(parseAuthCapabilities(source())).toEqual(source())
  })
  it('keeps no local capability genuinely empty', () => {
    expect(parseAuthCapabilities({ ...source(), identifierMethods: [], defaultIdentifierKind: null, defaultLogin: null, allowedSignupIdentifierKinds: [] })).toMatchObject({ identifierMethods: [], defaultLogin: null, allowedSignupIdentifierKinds: [] })
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
