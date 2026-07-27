import { useState, useCallback } from 'react'
import type { FormEvent } from 'react'
import { usePasswordReset } from '../hooks/usePasswordReset'
import { useBranding, brandingToAppearance } from './useBranding'
import type { Appearance } from './styles'
import { containerStyle, inputStyle, buttonStyle, labelStyle, errorStyle } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { localizeError } from '../localization'

export interface ResetPasswordProps {
  token?: string
  onSuccess?: () => void
  onError?: (error: Error) => void
  onSignIn?: () => void
  appearance?: Appearance
}

export function ResetPassword({ token, onSuccess, onError, onSignIn, appearance }: ResetPasswordProps) {
  const { resetPassword, isLoading } = usePasswordReset()
  const { branding } = useBranding()
  const { localization: l } = useIamUi()
  const [a] = useIamAppearance(appearance, brandingToAppearance(branding))

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    const resetToken = token?.trim()
    if (!resetToken) {
      setError(l.passwordReset.resetTokenRequired)
      return
    }
    if (newPassword.length < 8) {
      setError(l.passwordReset.passwordMinLength)
      return
    }
    if (newPassword !== confirmPassword) {
      setError(l.passwordReset.passwordMismatch)
      return
    }

    try {
      await resetPassword({ token: resetToken, newPassword })
      setComplete(true)
      onSuccess?.()
    } catch (err) {
      const next = err instanceof Error ? err : new Error(l.errors.resetFailed)
      setError(localizeError(next, l, 'resetFailed'))
      onError?.(next)
    }
  }, [token, newPassword, confirmPassword, resetPassword, onSuccess, onError, l])

  if (complete) {
    return (
      <div style={containerStyle(a)}>
        <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 12px' }}>{l.passwordReset.resetComplete}</h2>
        <p style={{ fontSize: 14, color: a.mutedTextColor, textAlign: 'center', margin: '0 0 20px' }}>
          {l.passwordReset.resetCompleteDetail}
        </p>
        {onSignIn && (
          <button type="button" onClick={onSignIn} style={buttonStyle(a, 'primary')}>
            {l.auth.signIn}
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={containerStyle(a)}>
      <h2 style={{ fontSize: 20, fontWeight: 600, textAlign: 'center', margin: '0 0 24px' }}>{l.passwordReset.createNewPassword}</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.passwordReset.newPassword}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={l.passwordReset.passwordPlaceholder}
            required
            minLength={8}
            style={inputStyle(a)}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.passwordReset.confirmPassword}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={l.passwordReset.confirmPasswordPlaceholder}
            required
            style={inputStyle(a)}
          />
        </div>

        {error && <p style={errorStyle(a)}>{error}</p>}

        <button type="submit" disabled={isLoading} style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: isLoading ? 0.7 : 1 }}>
          {isLoading ? l.passwordReset.resetting : l.passwordReset.resetPassword}
        </button>
      </form>
    </div>
  )
}
