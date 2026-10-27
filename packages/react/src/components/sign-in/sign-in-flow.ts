import { useCallback, useEffect, useRef } from 'react'
import type { AuthMethodIdpProviderResponse, IamUser, PublicAuthMethodsResponse, SocialProviderConfig } from '../../core/types'
import type { AuthClient } from '../../core/auth-client'

export type CredentialMethod = 'password' | 'sms' | 'magic_link' | 'email_otp'
export type IdentifierKind = 'email' | 'phone' | 'username'

export type EmbeddedFlowState =
  | { step: 'identifier'; identifierDraft: string; identifierError: string | null; selectedMethod: CredentialMethod | null }
  | { step: 'method'; identifierDraft: string; identifier: string; identifierKind: IdentifierKind; identifierError: null; selectedMethod: CredentialMethod | null }
  | { step: 'success'; identifierDraft: string; identifier: string; identifierKind: IdentifierKind; identifierError: null; selectedMethod: CredentialMethod | null; user: IamUser }
  | { step: 'error'; identifierDraft: string; identifier: string; identifierKind: IdentifierKind | null; identifierError: string; selectedMethod: CredentialMethod | null }

export type EmbeddedFlowAction =
  | { type: 'editIdentifier'; value: string }
  | { type: 'continueIdentifier'; value: string; invalidIdentifierMessage?: string }
  | { type: 'resetIdentifier' }
  | { type: 'selectMethod'; method: CredentialMethod }
  | { type: 'syncCredentialMethods'; methods: CredentialMethod[] }
  | { type: 'success'; user: IamUser }
  | { type: 'typedError'; message: string }

export function signInFlowReducer(state: EmbeddedFlowState, action: EmbeddedFlowAction): EmbeddedFlowState {
  switch (action.type) {
    case 'editIdentifier':
      if (state.step !== 'identifier') return state
      return { ...state, identifierDraft: action.value, identifierError: null }
    case 'continueIdentifier': {
      const nextIdentifier = action.value.trim()
      const identifierKind = getIdentifierKind(nextIdentifier)
      if (!identifierKind) {
        return { step: 'identifier', identifierDraft: action.value, identifierError: action.invalidIdentifierMessage ?? 'Enter a valid email address or phone number.', selectedMethod: null }
      }
      return { step: 'method', identifierDraft: nextIdentifier, identifier: nextIdentifier, identifierKind, identifierError: null, selectedMethod: null }
    }
    case 'resetIdentifier':
      return { step: 'identifier', identifierDraft: state.identifierDraft, identifierError: null, selectedMethod: null }
    case 'selectMethod':
      if (state.step !== 'method' || !canSelectMethod(state.identifierKind, action.method)) return state
      return { ...state, selectedMethod: action.method }
    case 'syncCredentialMethods':
      return reconcileCredentialMethods(state, action.methods)
    case 'success':
      if (state.step !== 'method') return state
      return { ...state, step: 'success', user: action.user }
    case 'typedError':
      return toErrorState(state, action.message)
  }
}

export const initialSignInFlowState: EmbeddedFlowState = {
  step: 'identifier',
  identifierDraft: '',
  identifierError: null,
  selectedMethod: null,
}

export function useCountdown(countdown: number, setCountdown: (value: number | ((value: number) => number)) => void): void {
  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((value) => Math.max(value - 1, 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown, setCountdown])
}



export function completeWithStoredUser(client: AuthClient, onSuccess?: (user: IamUser) => void): IamUser | null {
  const user = client.state.getUser()
  if (user) onSuccess?.(user)
  return user
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function isPhoneLike(value: string): boolean {
  const trimmed = value.trim()
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) return false
  return trimmed.replace(/\D/g, '').length >= 7
}

export function getIdentifierKind(value: string): IdentifierKind | null {
  const trimmed = value.trim()
  if (isLikelyEmail(trimmed)) return 'email'
  if (isPhoneLike(trimmed)) return 'phone'
  return null
}

export function canSelectMethod(identifierKind: IdentifierKind, method: CredentialMethod): boolean {
  if (identifierKind === 'username') return method === 'password'
  return identifierKind === 'email'
    ? method === 'password' || method === 'email_otp' || method === 'magic_link'
    : method === 'sms' || method === 'password'
}

export function nextMethodForIdentifier(
  identifierKind: IdentifierKind,
  methods: CredentialMethod[],
  currentMethod: CredentialMethod | null,
): CredentialMethod | null {
  const compatibleMethods = methods.filter((method) => canSelectMethod(identifierKind, method))
  if (currentMethod && compatibleMethods.includes(currentMethod)) return currentMethod
  return compatibleMethods[0] ?? null
}

function reconcileCredentialMethods(state: EmbeddedFlowState, methods: CredentialMethod[]): EmbeddedFlowState {
  if (state.step !== 'method') return state
  const selectedMethod = nextMethodForIdentifier(state.identifierKind, methods, state.selectedMethod)
  if (selectedMethod === state.selectedMethod) return state
  return { ...state, selectedMethod }
}

function toErrorState(state: EmbeddedFlowState, message: string): EmbeddedFlowState {
  if (state.step === 'identifier') {
    return {
      step: 'error',
      identifierDraft: state.identifierDraft,
      identifier: state.identifierDraft,
      identifierKind: null,
      identifierError: message,
      selectedMethod: state.selectedMethod,
    }
  }

  return {
    step: 'error',
    identifierDraft: state.identifierDraft,
    identifier: state.identifier,
    identifierKind: state.identifierKind,
    identifierError: message,
    selectedMethod: state.selectedMethod,
  }
}

export function hasAnyCredentialLoginMethod(authMethods: PublicAuthMethodsResponse): boolean {
  return authMethods.identifierMethods.length > 0
}

export function getAvailableCredentialMethods(authMethods: PublicAuthMethodsResponse, identifierKind: IdentifierKind): { id: CredentialMethod }[] {
  const capability = authMethods.identifierMethods.find((entry) => entry.kind === identifierKind.toUpperCase())
  return (capability?.methods ?? []).map(type => ({ id: type === 'PASSWORD' ? 'password' : type === 'EMAIL_OTP' ? 'email_otp' : type === 'EMAIL_MAGIC_LINK' ? 'magic_link' : 'sms' }))
}

export function getAvailableProviderOptions(
  authMethods: PublicAuthMethodsResponse,
  socialProviders: SocialProviderConfig[] = [],
  intent: 'sign-in' | 'sign-up' = 'sign-in',
): AuthMethodIdpProviderResponse[] {
  if (!authMethods.socialLoginEnabled) return []
  return authMethods.idpProviders
    .filter((provider) => provider.enabled
      && provider.configured
      && provider.clickable
      && (intent === 'sign-up' ? provider.availableForSignup : provider.availableForLogin)
      && typeof provider.authorizationUrl === 'string'
      && provider.authorizationUrl.length > 0)
    .map((provider) => {
      const override = socialProviders.find((item) => legacyProviderMatches(provider, item))
      return override?.displayName ? { ...provider, displayName: override.displayName } : provider
    })
}

export function toError(err: unknown, fallback: string): Error {
  return err instanceof Error ? err : new Error(fallback)
}

function legacyProviderMatches(provider: AuthMethodIdpProviderResponse, legacy: SocialProviderConfig): boolean {
  const key = legacy.provider.toLowerCase()
  return [
    provider.id,
    provider.providerType,
    provider.displayName,
  ].some((value) => value.toLowerCase() === key)
}

/** Bind a final authentication response to this mounted form and current session. */
export function useSessionOperation(client: AuthClient, identity: string) {
  const mounted = useRef(true)
  const sequence = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; sequence.current += 1 }
  }, [client, identity])
  const begin = useCallback(() => {
    const operation = ++sequence.current
    const generation = client.state.generation
    return () => mounted.current && sequence.current === operation && client.state.generation === generation
  }, [client])
  const isMounted = useCallback(() => mounted.current, [])
  return { begin, isMounted }
}
