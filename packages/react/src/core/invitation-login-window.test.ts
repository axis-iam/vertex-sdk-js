import { afterEach, expect, it, vi } from 'vitest'
import { OAuthClient } from './oauth-client'
import { InvitationLoginWindow } from './invitation-login-window'
import { AuthProviderWindow } from './auth-provider-window'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
function fixture() {
  const client = new OAuthClient({ issuerUri: 'https://issuer.example.test', clientId: 'client', redirectUri: '/callback' })
  const popup = { closed: false, close: vi.fn(), location: { href: 'about:blank' }, history: { replaceState: vi.fn() } }
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  vi.spyOn(client, 'startAuthorizationFlow').mockResolvedValue('https://issuer.example.test/oauth2/authorize?state=ordinary-state')
  vi.spyOn(client, 'handleCallback').mockResolvedValue({ access_token: 'test-only', token_type: 'Bearer', expires_in: 300 })
  vi.spyOn(client, 'isAuthenticated').mockReturnValue(true)
  return { client, popup, login: new InvitationLoginWindow(client) }
}
it('holds no invitation in hosted navigation, scrubs callback before ordinary token exchange and closes the popup', async () => {
  const { client, popup, login } = fixture()
  await login.start('en')
  expect(popup.location.href).not.toMatch(/continuation|invitation|context/)
  popup.location.href = window.location.origin + '/callback?code=ordinary-code&state=ordinary-state'
  await login.complete()
  expect(popup.history.replaceState).toHaveBeenCalledWith(null, '', '/callback')
  expect(client.handleCallback).toHaveBeenCalledWith('ordinary-code', 'ordinary-state')
  expect(popup.close).toHaveBeenCalledTimes(1)
  client.dispose()
})
it('fails closed on injected callback tokens, another origin, or a blocked popup without top-level navigation fallback', async () => {
  const { client, popup, login } = fixture()
  await login.start()
  popup.location.href = window.location.origin + '/callback?code=code&state=state&access_token=untrusted'
  await expect(login.complete()).rejects.toMatchObject({ code: 'INVITATION_LOGIN_CALLBACK_INVALID' })
  expect(client.handleCallback).not.toHaveBeenCalled()
  popup.location.href = 'https://wrong.example.test/callback?code=code&state=state'
  await expect(login.complete()).rejects.toMatchObject({ code: 'INVITATION_LOGIN_PENDING' })
  vi.spyOn(window, 'open').mockReturnValue(null)
  await expect(login.start()).rejects.toMatchObject({ code: 'INVITATION_LOGIN_POPUP_BLOCKED' })
  client.dispose()
})
it('normal selected-provider popup returns only the callback to the existing Client flow and supports explicit disposal', async () => {
  const { client, popup } = fixture(), provider = new AuthProviderWindow('/callback')
  const authorize = vi.fn(async () => 'https://issuer.example.test/selected-provider?state=ordinary')
  await provider.start(authorize)
  expect(authorize).toHaveBeenCalledTimes(1)
  popup.location.href = window.location.origin + '/callback?kind=AUTH_PROOF&state=ordinary'
  expect(provider.callback()).toBe(popup.location.href)
  expect(popup.history.replaceState).toHaveBeenCalledWith(null, '', '/callback')
  provider.close(); expect(popup.close).toHaveBeenCalledTimes(1)
  client.dispose()
})
