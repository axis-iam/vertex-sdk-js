import { useState, useCallback } from 'react'
import type { FormEvent } from 'react'
import { usePasswordReset } from '../hooks/usePasswordReset'
import { useBranding, brandingToAppearance } from './useBranding'
import type { Appearance } from './styles'
import { containerStyle, inputStyle, buttonStyle, labelStyle, errorStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'

export interface ForgotPasswordProps {
  redirectUri?: string
  onSuccess?: () => void
  onError?: (error: Error) => void
  appearance?: Appearance
}

export function ForgotPassword({ redirectUri, onSuccess, onError, appearance }: ForgotPasswordProps) {
  const { requestPasswordReset, isLoading } = usePasswordReset()
  const { branding } = useBranding()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email.trim() || !email.includes('@')) {
      setError(l.passwordReset.invalidEmail)
      return
    }

    try {
      await requestPasswordReset({ email, redirectUri })
      setSent(true)
      onSuccess?.()
    } catch (err) {
      const next = err instanceof Error ? err : new Error(l.errors.resetRequestFailed)
      setError(localizeError(next, l, 'resetRequestFailed'))
      onError?.(next)
    }
  }, [email, l, redirectUri, requestPasswordReset, onSuccess, onError])

  if (sent) {
    return (
      <div style={containerStyle(a)}>
        <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 12px' }}>{l.passwordReset.checkEmail}</h2>
        <p style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: 0 }}>
          {l.passwordReset.resetSent}
        </p>
      </div>
    )
  }

  return (
    <div style={containerStyle(a)}>
      <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>{l.passwordReset.resetPassword}</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.passwordReset.email}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={l.passwordReset.emailPlaceholder}
            required
            style={inputStyle(a)}
          />
        </div>

        {error && <p style={errorStyle(a)}>{error}</p>}

        <button type="submit" disabled={isLoading} style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: isLoading ? 0.7 : 1 }}>
          {isLoading ? l.passwordReset.sending : l.passwordReset.sendResetLink}
        </button>
      </form>
    </div>
  )
}
