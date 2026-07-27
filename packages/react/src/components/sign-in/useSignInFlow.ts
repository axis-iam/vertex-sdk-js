import { useEffect, useMemo, useReducer, useState } from 'react'
import type { OAuthClient } from '../../core/oauth-client'
import type { PublicAuthMethodsResponse } from '../../core/types'
import {
  type CredentialMethod,
  getAvailableCredentialMethods,
  getAvailableProviderOptions,
  hasAnyCredentialLoginMethod,
  initialSignInFlowState,
  nextMethodForIdentifier,
  signInFlowReducer,
} from './sign-in-flow'

export function useSignInFlow(client: OAuthClient) {
  const [state, dispatch] = useReducer(signInFlowReducer, initialSignInFlowState)
  const [authMethods, setAuthMethods] = useState<PublicAuthMethodsResponse | null>(null)
  const [authMethodsError, setAuthMethodsError] = useState<Error | null>(null)
  const [authMethodsLoading, setAuthMethodsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setAuthMethodsLoading(true)
    setAuthMethodsError(null)
    client.getPublicAuthMethods()
      .then((next) => {
        if (!cancelled) setAuthMethods(next)
      })
      .catch((err: unknown) => {
        if (!cancelled) setAuthMethodsError(err instanceof Error ? err : new Error('Sign-in options are unavailable'))
      })
      .finally(() => {
        if (!cancelled) setAuthMethodsLoading(false)
      })
    return () => { cancelled = true }
  }, [client])

  const credentialMethods = useMemo(() => (
    authMethods && state.step === 'method'
      ? getAvailableCredentialMethods(authMethods, state.identifierKind)
      : []
  ), [authMethods, state])

  const providers = useMemo(() => (
    authMethods ? getAvailableProviderOptions(authMethods, client.config.socialProviders) : []
  ), [authMethods, client.config.socialProviders])

  const credentialMethodIds = useMemo<CredentialMethod[]>(
    () => credentialMethods.map((method) => method.id),
    [credentialMethods],
  )

  const selectedMethod = state.step === 'method'
    ? nextMethodForIdentifier(state.identifierKind, credentialMethodIds, state.selectedMethod)
    : null

  useEffect(() => {
    if (state.step !== 'method') return
    dispatch({ type: 'syncCredentialMethods', methods: credentialMethodIds })
  }, [credentialMethodIds, state])

  return {
    state,
    dispatch,
    authMethods,
    authMethodsError,
    authMethodsLoading,
    credentialMethods,
    providers,
    selectedMethod,
    hasAnyCredentialMethods: authMethods ? hasAnyCredentialLoginMethod(authMethods) : false,
    hasProviderMethods: providers.length > 0,
  }
}
