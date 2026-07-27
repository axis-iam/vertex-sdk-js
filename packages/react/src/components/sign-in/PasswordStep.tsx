import { useCallback, useState } from 'react'
import type { FormEvent } from 'react'
import type { OAuthClient } from '../../core/oauth-client'
import { requestJson } from '../../core/http-client'
import type { IamUser } from '../../core/types'
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../styles'
import type { Appearance } from '../styles'
import { completeWithStoredUser, isLikelyEmail, storeTokensFromResponse, toError, useCountdown } from './sign-in-flow'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'

export function PasswordStep({ client, appearance: a, identifier, onSuccess, onError, resendCooldownSeconds }: {
  client: OAuthClient
  appearance: Required<Appearance>
  identifier: string
  onSuccess?: (user: IamUser) => void
  onError?: (error: Error) => void
  resendCooldownSeconds: number
}) {
  const { localization: l } = useIamUi()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [resendCountdown, setResendCountdown] = useState(0)
  const [loading, setLoading] = useState(false)

  useCountdown(resendCountdown, setResendCountdown)

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setVerificationEmail(null)
    setResendStatus('idle')
    setResendCountdown(0)
    setLoading(true)
    try {
      const config = await client.discover()
      const data = await requestJson<unknown>(`${config.issuer}/api/v1/auth/login`, {
        method: 'POST',
        json: { identifier, password, client_id: client.config.clientId },
      })
      storeTokensFromResponse(client, data)
      completeWithStoredUser(client, onSuccess)
    } catch (err) {
      const next = toError(err, l.errors.signInFailed)
      if ('code' in next && next.code === 'EMAIL_VERIFICATION_REQUIRED') {
        const email = identifier.trim()
        if (isLikelyEmail(email)) setVerificationEmail(email)
      }
      setError(localizeError(next, l, 'signInFailed'))
      onError?.(next)
    } finally {
      setLoading(false)
    }
  }, [client, identifier, password, onSuccess, onError, l])

  const resendVerification = useCallback(async () => {
    if (!verificationEmail) return
    setResendStatus('sending')
    try {
      await client.sendEmailVerification({ email: verificationEmail })
      setResendStatus('sent')
      setResendCountdown(resendCooldownSeconds)
    } catch {
      setResendStatus('error')
    }
  }, [client, resendCooldownSeconds, verificationEmail])

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle(a)}>{l.auth.password}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={l.auth.passwordPlaceholder} required style={inputStyle(a)} />
      </div>
      {error && <p style={errorStyle(a)}>{error}</p>}
      {verificationEmail && (
        <div style={{ marginTop: error ? -4 : 0, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => void resendVerification()}
            disabled={resendStatus === 'sending' || resendCountdown > 0}
            style={{ ...buttonStyle(a, 'ghost'), fontSize: 13 }}
          >
            {resendStatus === 'sending'
              ? l.auth.sending
              : resendCountdown > 0
                ? l.auth.resendIn(resendCountdown)
                : l.auth.resendVerification}
          </button>
          {resendStatus === 'sent' && (
            <p role="status" style={{ fontSize: 13, color: a.successColor, textAlign: 'center', margin: '8px 0 0' }}>
              {l.auth.verificationEmailSent}
            </p>
          )}
          {resendStatus === 'error' && (
            <p role="status" style={errorStyle(a)}>
              {l.auth.verificationEmailFailed}
            </p>
          )}
        </div>
      )}
      <button type="submit" disabled={loading}
        style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: loading ? 0.7 : 1 }}>
        {loading ? l.auth.signInBusy : l.auth.signIn}
      </button>
    </form>
  )
}
