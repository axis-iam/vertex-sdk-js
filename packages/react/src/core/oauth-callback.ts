import type { RedirectCallbackOptions } from './types'
import { generatePKCEPair } from './pkce'

import {
  PendingAuthorizationStore,
  authorizationRandom,
} from '@axis-iam/vertex'
import type { PendingAuthorization } from '@axis-iam/vertex'
type HostedBinding = Pick<
  PendingAuthorization,
  'issuer' | 'clientId' | 'redirectUri'
>
export async function prepareAuthorizationCodeContext(
  binding: HostedBinding,
  assertCurrent?: () => void,
  openid = false,
): Promise<{ codeChallenge: string; state: string; nonce?: string }> {
  const { codeVerifier, codeChallenge } = await generatePKCEPair()
  assertCurrent?.()
  const state = authorizationRandom()
  const nonce = openid ? authorizationRandom() : undefined
  PendingAuthorizationStore.save({
    ...binding,
    version: 1,
    entryMode: 'HOSTED',
    flowOwner: authorizationRandom(),
    state,
    ...(nonce ? { nonce } : {}),
    verifier: codeVerifier,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  })
  return { codeChallenge, state, ...(nonce ? { nonce } : {}) }
}
export function consumeAuthorizationCodeContext(
  state: string,
  binding: HostedBinding,
): PendingAuthorization {
  const pending = PendingAuthorizationStore.read({
    ...binding,
    entryMode: 'HOSTED',
  })
  if (pending.state !== state) throw new Error('OAuth state mismatch')
  PendingAuthorizationStore.remove(pending.flowOwner)
  return pending
}

export function resolveCallbackUrl(
  url: RedirectCallbackOptions['url'],
  fallbackBase: string,
): URL | null {
  if (url instanceof URL) {
    return new URL(url.toString())
  }
  if (typeof url === 'string') {
    return new URL(url, fallbackBase)
  }
  if (typeof window !== 'undefined') {
    return new URL(window.location.href)
  }
  return null
}

export function cleanCallbackUrl(
  callbackUrl: URL,
  cleanUrl: string | false | undefined,
): void {
  if (
    cleanUrl === false ||
    typeof window === 'undefined' ||
    !window.history?.replaceState
  ) {
    return
  }

  const nextUrl = cleanUrl ?? scrubCallbackParams(callbackUrl)
  window.history.replaceState({}, document.title, nextUrl)
}

function scrubCallbackParams(url: URL): string {
  const clean = new URL(url.toString())
  clean.searchParams.delete('code')
  clean.searchParams.delete('state')
  clean.searchParams.delete('error')
  clean.searchParams.delete('error_description')
  clean.searchParams.delete('kind')
  clean.searchParams.delete('auth_transaction_id')
  return `${clean.pathname}${clean.search}${clean.hash}`
}
