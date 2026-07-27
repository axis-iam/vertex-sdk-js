import { useCallback, useReducer, useState } from 'react'
import type { FormEvent } from 'react'
import type { OAuthClient } from '../../core/oauth-client'
import { requestJson, requestNoContent } from '../../core/http-client'
import type { IamUser } from '../../core/types'
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../styles'
import type { Appearance } from '../styles'
import { completeWithStoredUser, storeTokensFromResponse, toError, useCountdown } from './sign-in-flow'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'

type SmsState =
  | { phase: 'idle'; error: string | null }
  | { phase: 'sending'; error: string | null }
  | { phase: 'sent'; error: string | null }
  | { phase: 'verifying'; error: string | null }

function reducer(state: SmsState, action: { type: 'send' | 'sent' | 'verify' } | { type: 'error'; message: string }): SmsState {
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

export function SmsOtpStep({ client, appearance: a, phone, onSuccess, onError }: {
  client: OAuthClient
  appearance: Required<Appearance>
  phone: string
  onSuccess?: (user: IamUser) => void
  onError?: (error: Error) => void
}) {
  const { localization: l } = useIamUi()
  const [state, dispatch] = useReducer(reducer, { phase: 'idle', error: null })
  const [code, setCode] = useState('')
  const [countdown, setCountdown] = useState(0)

  useCountdown(countdown, setCountdown)

  const sendCode = useCallback(async () => {
    if (!phone.trim()) return
    dispatch({ type: 'send' })
    try {
      const config = await client.discover()
      await requestNoContent(`${config.issuer}/api/v1/auth/sms/send`, {
        method: 'POST',
        json: { phone, client_id: client.config.clientId },
      })
      dispatch({ type: 'sent' })
      setCountdown(60)
    } catch (err) {
      const next = toError(err, l.errors.signInFailed)
      dispatch({ type: 'error', message: localizeError(next, l, 'signInFailed') })
      onError?.(next)
    }
  }, [client, l, phone, onError])

  const verifyCode = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    dispatch({ type: 'verify' })
    try {
      const config = await client.discover()
      const data = await requestJson<unknown>(`${config.issuer}/api/v1/auth/sms/verify`, {
        method: 'POST',
        json: { phone, code, client_id: client.config.clientId },
      })
      storeTokensFromResponse(client, data)
      completeWithStoredUser(client, onSuccess)
    } catch (err) {
      const next = toError(err, l.errors.signInFailed)
      dispatch({ type: 'error', message: localizeError(next, l, 'signInFailed') })
      onError?.(next)
    }
  }, [client, phone, code, l, onSuccess, onError])

  const sent = state.phase === 'sent' || state.phase === 'verifying'
  const loading = state.phase === 'sending' || state.phase === 'verifying'

  return (
    <form onSubmit={verifyCode}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle(a)}>{l.auth.phone}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="tel" value={phone}
            placeholder={l.auth.phonePlaceholder} required readOnly
            style={{ ...inputStyle(a), flex: 1 }} />
          <button type="button" onClick={() => void sendCode()} disabled={loading || countdown > 0 || !phone.trim()}
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
