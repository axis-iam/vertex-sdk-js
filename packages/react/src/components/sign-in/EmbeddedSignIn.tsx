import { useEffect } from 'react'
import type { SignInProps } from './types'
import { useAuthFlow } from '../../hooks/useAuthFlow'
import { BrandedAuthContent, useAuthBranding } from './BrandedAuthContent'

export function EmbeddedSignIn({
  appearance,
  allowSignUp = true,
  onSuccess,
  onError,
  presentation = 'standalone',
  ...props
}: Pick<
  SignInProps,
  | 'appearance'
  | 'allowSignUp'
  | 'onSuccess'
  | 'onError'
  | 'forgotPasswordUrl'
  | 'onForgotPassword'
  | 'renderProviderButton'
  | 'presentation'
>) {
  const flow = useAuthFlow({ onSignInSuccess: onSuccess, onError })
  useEffect(() => {
    if (!allowSignUp && flow.state.intent === 'sign-up') void flow.actions.setIntent('sign-in').catch(() => { /* The flow exposes cancellation failure. */ })
  }, [allowSignUp, flow.state.intent, flow.actions])
  const brand = useAuthBranding(flow.state.intent, appearance)
  return <BrandedAuthContent flow={flow} brand={brand} presentation={presentation} allowSignUp={allowSignUp} {...props} />
}
