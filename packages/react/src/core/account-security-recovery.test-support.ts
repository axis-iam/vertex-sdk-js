import type { MfaOperationMode } from '@axis-iam/vertex'
import { securityFixture, response } from './account-security-fixtures.test-support'
import { accountSecurityStore } from './account-security-store'
import { makeTestJwt, makeTestUser } from '../test-utils'

export async function recoveryFixture(mode: MfaOperationMode) {
  const f = await securityFixture(mode)
  const store = accountSecurityStore(f.client)
  const original = f.fetchMock.getMockImplementation()!
  let revoked = false
  let profile = f.client.state.getUser()!
  f.fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/session/bootstrap')) return response({
      state: 'AUTHENTICATED', owner: 'F'.repeat(43), version: 2, csrfToken: 'G'.repeat(43),
      expiresAt: new Date(Date.now() + 600_000).toISOString(), profile, permissions: { roles: [], permissions: [] },
    })
    if (revoked && path.includes('/mfa/')) return response({ error: 'SESSION_REVOKED' }, 401)
    const result = await original(input, init)
    if (path.endsWith('/complete')) {
      revoked = true
      throw new TypeError('Controlled lost committed response')
    }
    return result
  })
  const loseDisable = async () => {
    await store.create('TOTP_DISABLE', 4)
    try { await store.complete() } catch (error) {
      if (!(error instanceof Error)) throw error
    }
    try { await store.query() } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  const signIn = async (change?: (user: ReturnType<typeof makeTestUser>) => void) => {
    const user = makeTestUser()
    user.authenticationContext.clientId = f.client.clientId
    user.authenticationContext.sessionId = 'fresh-session'
    change?.(user)
    profile = user
    revoked = false
    if (f.client.mode === 'oauth_tokens') {
      f.client.tokenManager.store({ access_token: makeTestJwt(), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
      f.client.tokenManager.applyViews({ user, roles: [], permissions: [] })
    } else await f.client.restoreSession()
  }
  return { ...f, store, loseDisable, signIn }
}
