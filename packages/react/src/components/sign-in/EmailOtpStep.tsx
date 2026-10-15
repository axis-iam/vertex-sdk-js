import { useCallback, useReducer, useState } from 'react'
import type { FormEvent } from 'react'
import type { OAuthClient } from '../../core/oauth-client'
import { requestJson, requestNoContent } from '../../core/http-client'
import type { IamUser } from '../../core/types'
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../styles'
import type { Appearance } from '../styles'
import { completeWithStoredUser, storeTokensFromResponse, toError, useCountdown, useSessionOperation } from './sign-in-flow'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'

type EmailOtpState =
  | { phase: 'idle'; error: string | null }
  | { phase: 'sending'; error: string | null }
  | { phase: 'sent'; error: string | null }
  | { phase: 'verifying'; error: string | null }

type EmailOtpAction =
  | { type: 'send' }
  | { type: 'sent' }
  | { type: 'verify' }
  | { type: 'error'; message: string }

function reducer(state: EmailOtpState, action: EmailOtpAction): EmailOtpState {
  switch (action.type) {
    case 'send':
      return { phase: 'sending', error: null }
    case 'sent':
      return { phase: 'sent', error: null }
    case 'verify':
      return { phase: 'verifying', error: null }
    case 'error':
      return { phase: state.phase === 'verifying' ? 'sent' : 'idle', error: action.message }
  }
}

export function EmailOtpStep({ client, appearance: a, email, onSuccess, onError }: {
  client: OAuthClient
  appearance: Required<Appearance>
  email: string
  onSuccess?: (user: IamUser) => void
  onError?: (error: Error) => void
}) {
  const { localization: l } = useIamUi()
  const { begin, isMounted } = useSessionOperation(client, email)
  const [state, dispatch] = useReducer(reducer, { phase: 'idle', error: null })
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)

  useCountdown(countdown, setCountdown)

  const sendCode = useCallback(async () => {
    if (!email.trim()) return
    dispatch({ type: 'send' })
    try {
      const config = await client.discover()
      await requestNoContent(`${config.issuer}/api/v1/auth/passwordless/email-otp`, {
        method: 'POST',
        json: { email, client_id: client.config.clientId },
      })
      dispatch({ type: 'sent' })
      setCountdown(60)
    } catch (err) {
      const next = toError(err, l.errors.signInFailed)
      dispatch({ type: 'error', message: localizeError(next, l, 'signInFailed') })
      onError?.(next)
    }
  }, [client, email, l, onError])

  const verifyCode = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    const isCurrent = begin()
    dispatch({ type: 'verify' })
    try {
      const config = await client.discover()
      const data = await requestJson<unknown>(`${config.issuer}/api/v1/auth/passwordless/email-otp/verify`, {
        method: 'POST',
        json: { email, code, client_id: client.config.clientId },
      })
      if (!isCurrent()) return
      storeTokensFromResponse(client, data)
      completeWithStoredUser(client, onSuccess)
    } catch (err) {
      if (!isCurrent()) return
      const next = toError(err, l.errors.signInFailed)
      dispatch({ type: 'error', message: localizeError(next, l, 'signInFailed') })
      onError?.(next)
    }
  }, [begin, isMounted, client, code, email, l, onSuccess, onError])

  const sent = state.phase === 'sent' || state.phase === 'verifying'
  const loading = state.phase === 'sending' || state.phase === 'verifying'

  return (
    <form onSubmit={verifyCode}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle(a)}>{l.auth.email}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="email" value={email} placeholder={l.auth.emailPlaceholder} required readOnly style={{ ...inputStyle(a), flex: 1 }} />
          <button type="button" onClick={() => void sendCode()} disabled={loading || countdown > 0}
            style={{ ...buttonStyle(a, 'ghost'), width: 'auto', minWidth: 110, fontSize: 13, opacity: countdown > 0 ? 0.6 : 1 }}>
            {countdown > 0 ? l.auth.resendIn(countdown) : sent ? l.auth.resend : l.auth.sendCode}
          </button>
        </div>
      </div>

      {sent && (
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle(a)}>{l.auth.verificationCode}</label>
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)}
            placeholder={l.auth.verificationCodePlaceholder} required maxLength={6}
            style={{ ...inputStyle(a), letterSpacing: 4, textAlign: 'center', fontSize: 18 }} />
        </div>
      )}

      {state.error && <p style={errorStyle(a)}>{state.error}</p>}

      {sent && (
        <button type="submit" disabled={loading || code.length < 4}
          style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: loading ? 0.7 : 1 }}>
          {state.phase === 'verifying' ? l.auth.verifying : l.auth.signIn}
        </button>
      )}
    </form>
  )
}
