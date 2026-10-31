import { authorizationCallback, InvitationError } from '@axis-iam/vertex'
import type { AuthClient } from './auth-client'

/** The opener retains the invitation proof; only ordinary OAuth visits the popup. */
export class InvitationLoginWindow {
  private popup: Window | null = null
  private expiresAt = 0
  constructor(private readonly client: AuthClient) {}
  async start(locale?: string) {
    this.close()
    const popup = window.open('about:blank', '_blank')
    if (!popup) throw new InvitationError('INVITATION_LOGIN_POPUP_BLOCKED')
    this.popup = popup
    this.expiresAt = Date.now() + 600000
    try {
      const url = await this.client.startAuthorizationFlow({ locale })
      if (this.popup !== popup || popup.closed) throw new InvitationError('INVITATION_LOGIN_CANCELLED')
      popup.location.href = url
    } catch (error) { this.close(); throw error }
  }
  async complete() {
    const popup = this.popup
    if (!popup || popup.closed || Date.now() >= this.expiresAt) {
      this.close()
      throw new InvitationError('INVITATION_LOGIN_CANCELLED')
    }
    let href: string
    try { href = popup.location.href } catch { throw new InvitationError('INVITATION_LOGIN_PENDING') }
    const target = new URL(this.client.config.redirectUri, window.location.origin)
    if (target.origin !== window.location.origin) throw new InvitationError('INVITATION_LOGIN_CALLBACK_INVALID')
    if (this.client.mode === 'oauth_tokens') {
      const returned = new URL(href)
      if (returned.origin !== target.origin || returned.pathname !== target.pathname)
        throw new InvitationError('INVITATION_LOGIN_PENDING')
      popup.history.replaceState(null, '', target.pathname)
      const keys = [...returned.searchParams.keys()]
      if (keys.some(key => !['code', 'state', 'error', 'error_description', 'iss'].includes(key)) ||
          returned.searchParams.has('iss') && returned.searchParams.get('iss') !== this.client.config.issuerUri)
        throw new InvitationError('INVITATION_LOGIN_CALLBACK_INVALID')
      const parameters = authorizationCallback(href, target.href, keys)
      const code = parameters.get('code'), state = parameters.get('state')
      if (!code || !state || parameters.has('error')) throw new InvitationError('INVITATION_LOGIN_FAILED')
      await this.client.handleCallback(code, state)
    } else {
      const returned = new URL(href)
      if (returned.origin !== target.origin || returned.pathname !== target.pathname || returned.search || returned.hash)
        throw new InvitationError('INVITATION_LOGIN_PENDING')
      await this.client.restoreSession()
    }
    if (!this.client.isAuthenticated()) throw new InvitationError('INVITATION_AUTH_REQUIRED')
    this.close()
  }
  close() { this.popup?.close(); this.popup = null }
}
