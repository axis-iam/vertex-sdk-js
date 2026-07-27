import type { FormEvent } from 'react'
import type { Appearance } from '../styles'
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../styles'
import { useIamUi } from '../../provider/IamUiProvider'

export function IdentifierStep({ appearance: a, value, error, onChange, onContinue }: {
  appearance: Required<Appearance>
  value: string
  error: string | null
  onChange: (value: string) => void
  onContinue: (value: string) => void
}) {
  const { localization: l } = useIamUi()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onContinue(value)
  }

  return (
    <form onSubmit={submit}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle(a)}>{l.auth.identifierLabel}</label>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={l.auth.identifierPlaceholder}
          required
          style={inputStyle(a)}
        />
      </div>
      {error && <p style={errorStyle(a)}>{error}</p>}
      <button type="submit" style={{ ...buttonStyle(a, 'primary'), marginTop: 8 }}>
        {l.auth.continue}
      </button>
    </form>
  )
}
