import type { RedirectCallbackOptions } from './types'
import { generatePKCEPair } from './pkce'

const VERIFIER_KEY = 'iam_pkce_verifier'
const STATE_KEY = 'iam_oauth_state'

export async function prepareAuthorizationCodeContext(): Promise<{ codeChallenge: string; state: string }> {
  const { codeVerifier, codeChallenge } = await generatePKCEPair()
  const state = crypto.randomUUID()

  try {
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier)
    sessionStorage.setItem(STATE_KEY, state)
  } catch {
    // Browser-only storage may be unavailable during SSR.
  }

  return { codeChallenge, state }
}

export function consumeAuthorizationCodeVerifier(state: string): string {
  let storedState: string | null = null
  let codeVerifier: string | null = null
  try {
    storedState = sessionStorage.getItem(STATE_KEY)
    codeVerifier = sessionStorage.getItem(VERIFIER_KEY)
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(VERIFIER_KEY)
  } catch {
    // SSR
  }

  if (!storedState || storedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF attack')
  }
  if (!codeVerifier) {
    throw new Error('Missing PKCE code_verifier — authorization flow was not started properly')
  }

  return codeVerifier
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

export function cleanCallbackUrl(callbackUrl: URL, cleanUrl: string | false | undefined): void {
  if (cleanUrl === false || typeof window === 'undefined' || !window.history?.replaceState) {
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
  return `${clean.pathname}${clean.search}${clean.hash}`
}
