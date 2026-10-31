import { useMemo, useRef } from 'react'
import type { ChangeEvent } from 'react'
import type { Appearance } from '../styles'
import { inputStyle, labelStyle } from '../styles'
import { parsePhoneIdentifier, phoneCountries } from './phone-identifier'

export function PhoneIdentifierInput({
  allowedRegions,
  appearance,
  locale,
  prefix,
  value,
  country,
  onValueChange,
  onCountryChange,
  labels,
  disabled = false,
  error,
}: {
  allowedRegions?: readonly string[] | null
  appearance: Required<Appearance>
  locale: string
  prefix: string
  value: string
  country: string
  onValueChange: (value: string) => void
  onCountryChange: (country: string) => void
  labels: {
    country: string
    chooseCountry: string
    number: string
  }
  disabled?: boolean
  error?: string | null
}) {
  const input = useRef<HTMLInputElement>(null)
  const countries = useMemo(() => phoneCountries(locale, allowedRegions), [locale, allowedRegions])
  function changeCountry(event: ChangeEvent<HTMLSelectElement>) {
    onCountryChange(event.target.value)
    onValueChange('')
    input.current?.focus()
  }
  function changeNumber(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value
    if (next.trim().startsWith('+')) {
      const parsed = parsePhoneIdentifier(next)
      onCountryChange(parsed && countries.some(option => option.code === parsed.country) ? parsed.country : '')
      onValueChange(parsed && countries.some(option => option.code === parsed.country) ? parsed.nationalNumber : next)
      return
    }
    onValueChange(next)
  }
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 16, minWidth: 0 }}>
      <div style={{ minWidth: 0 }}>
        <label htmlFor={`${prefix}-country`} style={labelStyle(appearance)}>
          {labels.country}
        </label>
        <select
          id={`${prefix}-country`}
          aria-label={labels.country}
          value={countries.some(option => option.code === country) ? country : ''}
          onChange={changeCountry}
          disabled={disabled}
          required
          style={{ ...inputStyle(appearance), minWidth: 0, minHeight: 44, fontFamily: 'inherit' }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${prefix}-error` : undefined}
        >
          <option value="">{labels.chooseCountry}</option>
          {countries.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name} ({option.callingCode})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${prefix}-phone`} style={labelStyle(appearance)}>
          {labels.number}
        </label>
        <input
          ref={input}
          id={`${prefix}-phone`}
          name="identifier"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={value}
          onChange={changeNumber}
          disabled={disabled}
          required
          style={{ ...inputStyle(appearance), minHeight: 44, fontFamily: 'inherit' }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${prefix}-error` : undefined}
        />
      </div>
    </div>
  )
}
