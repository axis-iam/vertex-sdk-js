import { describe, expect, it } from 'vitest'
import {
  normalizePhoneIdentifier,
  parsePhoneIdentifier,
  phoneCountries,
} from './phone-identifier'

describe('phone identifier normalization', () => {
  it.each(['+8613800138000', '+86 13800138000'])(
    'recognizes an international %s number',
    (value) => {
      expect(parsePhoneIdentifier(value)).toEqual({
        country: 'CN',
        nationalNumber: '13800138000',
        e164: '+8613800138000',
      })
    },
  )

  it('resolves a shared +1 calling code from the complete number', () => {
    expect(parsePhoneIdentifier('+12025550123')?.country).toBe('US')
  })

  it('requires an explicit country for local numbers', () => {
    expect(parsePhoneIdentifier('13800138000')).toBeNull()
    expect(normalizePhoneIdentifier('13800138000', 'CN').e164).toBe(
      '+8613800138000',
    )
  })

  it('rejects unknown and invalid numbers instead of guessing a country', () => {
    expect(parsePhoneIdentifier('+999123456')).toBeNull()
    expect(parsePhoneIdentifier('not a phone', 'CN')).toBeNull()
  })

  it.each(['+18005550123', '+80012345678', '+1', '+8613800138000 ext 1', '+86 13800138000abc'])('rejects ambiguous or unsupported input %s', value => {
    expect(parsePhoneIdentifier(value)).toBeNull()
  })

  it('rejects a national number that resolves to another country in a shared plan', () => {
    expect(parsePhoneIdentifier('4165550123', 'US')).toBeNull()
    expect(parsePhoneIdentifier('4165550123', 'CA')?.e164).toBe('+14165550123')
  })

  it('round trips a national format with a domestic trunk prefix', () => {
    const parsed = normalizePhoneIdentifier('+442079460018')
    expect(parsed.country).toBe('GB')
    expect(normalizePhoneIdentifier(parsed.nationalNumber, 'GB').e164).toBe(parsed.e164)
  })

  it('builds readable localized country options', () => {
    const countries = phoneCountries('zh-CN')
    expect(
      countries.some(
        (country) => country.code === 'CN' && country.callingCode === '+86',
      ),
    ).toBe(true)
    expect(countries.find((country) => country.code === 'CN')?.name).toBe('中国')
  })
})
