import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/max'
import type { CountryCode } from 'libphonenumber-js'

export interface PhoneCountryOption {
  code: CountryCode
  callingCode: string
  name: string
}

export interface PhoneParseResult {
  country: CountryCode
  nationalNumber: string
  e164: string
}

const countries = getCountries()
const callingCodeCounts = new Map<string, number>()
for (const country of countries) {
  const code = getCountryCallingCode(country)
  callingCodeCounts.set(code, (callingCodeCounts.get(code) ?? 0) + 1)
}

export function phoneCountries(locale: string, allowedRegions?: readonly string[] | null): PhoneCountryOption[] {
  const names = new Intl.DisplayNames([locale, 'en'], { type: 'region' })
  if (allowedRegions?.some(code => !countries.some(country => country === code))) throw new PhoneIdentifierError('PHONE_INVALID')
  return countries
    .filter(code => allowedRegions == null || allowedRegions.includes(code))
    .map((code) => ({
      code,
      callingCode: `+${getCountryCallingCode(code)}`,
      name: names.of(code) ?? code,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, locale))
}

export function parsePhoneIdentifier(
  value: string,
  country?: string,
): PhoneParseResult | null {
  const trimmed = value.trim()
  if (!trimmed || !/^\+?[0-9 ()-]+$/.test(trimmed)) return null
  const international = trimmed.startsWith('+')
  const selectedCountry = countries.find((code) => code === country)
  if (!international && !selectedCountry) return null
  const parsed = parsePhoneNumberFromString(trimmed, {
    defaultCountry: international ? undefined : selectedCountry,
    extract: false,
  })
  if (!parsed || parsed.ext || !parsed.isValid() || !parsed.country) return null
  if (!international && parsed.country !== selectedCountry) return null
  const sharedCallingCode = (callingCodeCounts.get(parsed.countryCallingCode) ?? 0) > 1
  if (international && sharedCallingCode && !['MOBILE', 'FIXED_LINE', 'FIXED_LINE_OR_MOBILE'].includes(parsed.getType() ?? ''))
    return null
  return {
    country: parsed.country,
    nationalNumber: parsed.formatNational().replace(/\D/g, ''),
    e164: parsed.number,
  }
}

export function normalizePhoneIdentifier(
  value: string,
  country?: string,
  allowedRegions?: readonly string[] | null,
): PhoneParseResult {
  const parsed = parsePhoneIdentifier(value, country)
  if (parsed && allowedRegions != null && !allowedRegions.includes(parsed.country)) throw new PhoneIdentifierError('PHONE_INVALID')
  if (!parsed)
    throw new PhoneIdentifierError(
      country ? 'PHONE_INVALID' : 'PHONE_REGION_REQUIRED',
    )
  return parsed
}

export class PhoneIdentifierError extends Error {
  constructor(readonly code: 'PHONE_INVALID' | 'PHONE_REGION_REQUIRED') {
    super(code)
    this.name = 'PhoneIdentifierError'
  }
}
