import { InvitationError } from '@axis-iam/vertex'

/** Normal Client authentication only; an invitation capability never enters this window. */
export class AuthProviderWindow {
  private popup: Window | null = null
  private expiresAt = 0
  constructor(private readonly redirectUri: string) {}
  async start(authorize: () => Promise<string>) {
    this.close()
    const popup = window.open('about:blank', '_blank')
    if (!popup) throw new InvitationError('INVITATION_LOGIN_POPUP_BLOCKED')
    this.popup = popup; this.expiresAt = Date.now() + 600000
    try {
      const url = await authorize()
      if (this.popup !== popup || popup.closed) throw new InvitationError('INVITATION_LOGIN_CANCELLED')
      popup.location.href = url
    } catch (error) { this.close(); throw error }
  }
  callback() {
    if (!this.popup || this.popup.closed || this.expiresAt <= Date.now()) {
      this.close(); throw new InvitationError('INVITATION_LOGIN_CANCELLED')
    }
    const target = new URL(this.redirectUri, window.location.origin)
    let url: URL
    try { url = new URL(this.popup.location.href) } catch { throw new InvitationError('INVITATION_LOGIN_PENDING') }
    if (target.origin !== window.location.origin || url.origin !== target.origin || url.pathname !== target.pathname)
      throw new InvitationError('INVITATION_LOGIN_PENDING')
    // The existing transaction API validates the complete callback and state/PKCE/nonce.
    this.popup.history.replaceState(null, '', target.pathname)
    return url.href
  }
  close() { this.popup?.close(); this.popup = null }
}
