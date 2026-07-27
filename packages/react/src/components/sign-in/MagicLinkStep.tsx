import { useCallback, useReducer } from 'react'
import type { FormEvent } from 'react'
import type { OAuthClient } from '../../core/oauth-client'
import { requestNoContent } from '../../core/http-client'
import { buttonStyle, errorStyle, inputStyle, labelStyle } from '../styles'
import type { Appearance } from '../styles'
import { toError } from './sign-in-flow'
import { useIamUi } from '../../provider/IamUiProvider'
import { localizeError } from '../../localization'

type MagicLinkState =
  | { phase: 'idle'; error: string | null }
  | { phase: 'sending'; error: string | null }
  | { phase: 'sent'; error: string | null }

function reducer(state: MagicLinkState, action: { type: 'send' | 'sent' | 'reset' } | { type: 'error'; message: string }): MagicLinkState {
  switch (action.type) {
    case 'send':
      return { phase: 'sending', error: null }
    case 'sent':
      return { phase: 'sent', error: null }
    case 'reset':
      return { phase: 'idle', error: null }
    case 'error':
      return { phase: state.phase === 'sent' ? 'sent' : 'idle', error: action.message }
  }
}

export function MagicLinkStep({ client, appearance: a, email, onError }: {
  client: OAuthClient
  appearance: Required<Appearance>
  email: string
  onError?: (error: Error) => void
}) {
  const { localization: l } = useIamUi()
  const [state, dispatch] = useReducer(reducer, { phase: 'idle', error: null })

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    dispatch({ type: 'send' })
    try {
      const config = await client.discover()
      await requestNoContent(`${config.issuer}/api/v1/auth/passwordless/magic-link`, {
        method: 'POST',
        json: { email, client_id: client.config.clientId },
      })
      dispatch({ type: 'sent' })
    } catch (err) {
      const next = toError(err, l.errors.signInFailed)
      dispatch({ type: 'error', message: localizeError(next, l, 'signInFailed') })
      onError?.(next)
    }
  }, [client, email, l, onError])

  if (state.phase === 'sent') {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px' }}>{l.signUp.checkEmail}</h3>
        <p style={{ fontSize: 14, color: a.mutedTextColor, margin: 0 }}>
          {l.auth.magicLinkSent(email)}
        </p>
        <button type="button" onClick={() => dispatch({ type: 'reset' })}
          style={{ ...buttonStyle(a, 'ghost'), marginTop: 16, width: 'auto', padding: '6px 16px', fontSize: 13 }}>
          {l.auth.resend}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle(a)}>{l.auth.email}</label>
        <input type="email" value={email} placeholder={l.auth.emailPlaceholder} required readOnly style={inputStyle(a)} />
      </div>
      {state.error && <p style={errorStyle(a)}>{state.error}</p>}
      <button type="submit" disabled={state.phase === 'sending'}
        style={{ ...buttonStyle(a, 'primary'), marginTop: 8, opacity: state.phase === 'sending' ? 0.7 : 1 }}>
        {state.phase === 'sending' ? l.auth.sendingMagicLink : l.auth.sendMagicLink}
      </button>
    </form>
  )
}
