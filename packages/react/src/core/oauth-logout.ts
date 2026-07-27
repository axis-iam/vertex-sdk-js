import type { LogoutOptions } from './types'

export function buildLogoutUrl(input: {
  endSessionEndpoint: string | undefined
  idToken: string | null
  postLogoutRedirectUri: string | null | undefined
}): string | null {
  if (!input.idToken || !input.endSessionEndpoint) return null

  const params = new URLSearchParams()
  params.set('id_token_hint', input.idToken)

  if (input.postLogoutRedirectUri) {
    params.set('post_logout_redirect_uri', input.postLogoutRedirectUri)
  }

  return `${input.endSessionEndpoint}?${params.toString()}`
}

export function completeLogoutRedirect(input: {
  options: LogoutOptions
  logoutUrl: string | null
  postLogoutRedirectUri: string | null
}): void {
  if (input.options.redirect !== true || typeof window === 'undefined') {
    return
  }

  const destination = input.logoutUrl ?? input.postLogoutRedirectUri
  if (destination) {
    window.location.href = destination
  }
}
