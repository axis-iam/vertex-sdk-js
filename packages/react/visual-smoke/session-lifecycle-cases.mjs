import { createElement, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { IamProvider, useAuth, OAuthClient, IamTokenRefreshError } from '@axis-iam/vertex-react'

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (value, label) => { if (!value) throw new Error(label) }
const jwt = subject => `${btoa('{"alg":"RS256"}')}.${btoa(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture-signature`
const tokens = (name, expires_in = 60) => ({ access_token: jwt(name), token_type: 'Bearer', expires_in, refresh_token: `fixture-${name}-initial` })

window.runSessionLifecycle = async () => {
  const results = []
  const count = async name => (await fetch(`/counts?name=${name}`).then(response => response.json())).count
  const clientFor = name => {
    const client = new OAuthClient({ issuerUri: location.origin, clientId: 'fixture-client' })
    client.tokenManager.store(tokens(name), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    return client
  }

  {
    const client = clientFor('concurrency')
    client.tokenManager.store(tokens('concurrency', 1), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    try {
      await wait(520)
      const first = client.refreshToken()
      check(client.refreshToken() === first, 'manual callers did not join the same flight')
      await first
      check(await count('concurrency') === 1, 'timer/manual refresh emitted duplicate requests')
      check(client.tokenManager.getRefreshToken() === 'fixture-concurrency-rotated', 'rotation was not committed')
      check(client.tokenManager.getPermissions().includes('orders:read'), 'canonical permissions were not applied')
      results.push({ scenario: 'refresh-concurrency', pass: true, refreshRequests: 1 })
    } finally { client.dispose() }
  }
  for (const replacement of ['logout', 'new-login', 'dispose']) {
    const client = clientFor(`stale-${replacement}`)
    try {
      const pending = client.refreshToken().catch(error => error)
      await wait(30)
      if (replacement === 'logout') await client.logout({ redirect: false })
      if (replacement === 'dispose') client.dispose()
      if (replacement === 'new-login') client.tokenManager.store(tokens('new-login'), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
      const result = await pending
      check(result?.code === 'SESSION_INVALIDATED', 'old refresh did not report invalidation')
      if (replacement === 'logout') check(client.getAccessToken() === null, 'logout session was resurrected')
      if (replacement === 'new-login') check(client.tokenManager.getRefreshToken() === 'fixture-new-login-initial', 'old response overwrote a new login')
      results.push({ scenario: `stale-response-${replacement}`, pass: true })
    } finally { client.dispose() }
  }
  {
    const client = clientFor('metadata')
    try {
      client.tokenManager.store({ ...tokens('metadata', 1), access_token: 'opaque-shaped-fixture' }, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
      await wait(800)
      check(await count('metadata') === 1, 'expiry metadata did not schedule refresh')
      results.push({ scenario: 'expiry-metadata', pass: true, refreshRequests: 1 })
    } finally { client.dispose() }
  }
  {
    const client = clientFor('failure')
    try {
      client.tokenManager.store(tokens('failure', 2), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
      const error = await client.refreshToken().catch(error => error)
      check(error instanceof IamTokenRefreshError && error.retryable, 'temporary error was not typed/retryable')
      check(client.tokenManager.hasUsableToken(), 'temporary error removed a valid token session')
      check(!JSON.stringify(error).includes('fixture-private-marker'), 'error leaked provider details')
      await wait(1100)
      check(await count('failure') === 1, 'temporary error started an automatic retry loop')
      await client.refreshToken()
      check(client.tokenManager.getLastRefreshError() === null, 'successful explicit retry retained the error')
      results.push({ scenario: 'typed-failure', pass: true, explicitRetry: true })
    } finally { client.dispose() }
  }
  {
    const client = clientFor('oauth-protocol')
    client.tokenManager.store({ ...tokens('oauth-protocol'), id_token: 'fixture-original-identity' }, 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    try {
      await client.refreshToken()
      check(await count('oauth-protocol') === 1, 'OAuth refresh did not use its form endpoint')
      check(client.tokenManager.getIdToken() === 'fixture-original-identity', 'OAuth refresh lost logout identity')
      check((await client.getLogoutUrl())?.includes('id_token_hint='), 'OAuth logout identity unavailable')
      await client.logout({ redirect: false })
      check(client.getAccessToken() === null, 'OAuth local logout did not clear session')
      results.push({ scenario: 'oauth-provenance-and-id-token', pass: true })
    } finally { client.dispose() }
  }
  {
    const config = { issuerUri: location.origin, clientId: 'fixture-client', tokenStorage: 'sessionStorage' }
    const initial = new OAuthClient(config)
    initial.tokenManager.store(tokens('react-persist', 1), 'OAUTH_AUTHORIZATION_CODE', 'OAUTH_TOKEN_ENDPOINT')
    const deadline = JSON.parse(sessionStorage.getItem('axis_iam_session')).expiresAt
    initial.dispose()
    let auth
    function Probe() { auth = useAuth(); return null }
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    root.render(createElement(StrictMode, null, createElement(IamProvider, config, createElement(Probe))))
    await wait(200)
    check(auth?.isAuthenticated, 'StrictMode lost restored authentication')
    check(JSON.parse(sessionStorage.getItem('axis_iam_session')).expiresAt === deadline, 'reload renewed expiry')
    await wait(330)
    const pending = auth.refreshToken().catch(error => error)
    root.unmount()
    const result = await pending
    check(result?.code === 'SESSION_INVALIDATED', 'pending Provider refresh survived unmount')
    check(await count('react-persist') === 1, 'StrictMode created an orphan refresh')
    check(sessionStorage.getItem('axis_iam_session') === null, 'interrupted refresh restored persisted credentials')
    element.remove()
    results.push({ scenario: 'react-strictmode-storage-reload-pending-unmount', pass: true, refreshRequests: 1 })
  }
  check(sessionStorage.getItem('axis_iam_session') === null && localStorage.getItem('axis_iam_session') === null, 'default memory session leaked to storage')

  const live = await fetch('/live/config').then(response => response.json())
  if (live.enabled) {
    const client = new OAuthClient({ issuerUri: live.issuer, clientId: live.clientId, redirectUri: `${location.origin}/callback`, scopes: ['openid', 'profile', 'email', 'offline_access'] })
    try {
      const authorizationUrl = await client.startAuthorizationFlow()
      const authorized = await fetch('/live/oauth/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorizationUrl }) })
      check(authorized.ok, 'real public PKCE authorization failed')
      const callback = await authorized.json()
      const initial = await client.handleCallback(callback.code, callback.state)
      check(initial.refresh_token && initial.id_token, 'real PKCE grant lacks refresh/logout context')
      const pending = client.refreshToken()
      check(client.refreshToken() === pending, 'real OAuth refresh did not share its transaction')
      const rotated = await pending
      check(rotated.refresh_token !== initial.refresh_token, 'real OAuth refresh did not rotate')
      check(client.tokenManager.getLastPermissionError() === null, 'real OAuth permission lookup failed')
      const logoutUrl = await client.getLogoutUrl({ postLogoutRedirectUri: location.origin })
      check(logoutUrl, 'real OAuth end-session URL unavailable')
      const logoutResponse = await fetch('/live/oauth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ logoutUrl }) })
      check((await logoutResponse.json()).redirected, 'real OAuth end-session did not redirect')
      const rejected = await client.refreshToken().catch(error => error)
      check(rejected instanceof IamTokenRefreshError && !rejected.retryable && client.getAccessToken() === null, 'real OAuth logout did not invalidate refresh family')
      results.push({ scenario: 'real-backend-oauth-pkce-lifecycle', pass: true, rotation: true, logoutRevoked: true })
    } finally { client.dispose() }
  }
  return { scenarios: results, memoryStorage: true, livePassed: live.enabled }
}
