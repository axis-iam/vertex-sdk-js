import { createElement } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConnectedAppSessionTransport, UnsupportedOperationError } from '@axis-iam/vertex'
import { IamProvider, useIamContext } from '../provider/IamProvider'
import { SignIn } from '../components/SignIn'
import { AuthDialog } from '../components/AuthDialog'
import { useAuthFlow } from '../hooks/useAuthFlow'
import { ServerSessionClient } from './server-session-client'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'
import { makeTestUser } from '../test-utils'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear() })
function fixture(wrongPassword = { status: 400, error: 'INVALID_CREDENTIALS' }) {
  const csrf = 'c'.repeat(43)
  const expiresAt = new Date(Date.now() + 600000).toISOString()
  let state = 'PRELOGIN'
  const calls: string[] = []
  const profile = makeTestUser(); profile.authenticationContext.clientId = 'flow-test'
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname
    calls.push(path)
    if (init.method !== 'GET') expect(new Headers(init.headers).get('X-CSRF-Token')).toBe(csrf)
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
    const response = (value: unknown) => new Response(JSON.stringify(value))
    if (path === '/auth/auth-methods') return response(flowCapabilities)
    if (path === '/auth/auth-policy') return response(flowPolicy)
    if (path.endsWith('/session/login')) state = 'AUTHENTICATING'
    if (path.endsWith('/authenticate')) {
      const body = JSON.parse(String(init.body))
      if (body.password === 'wrong') return new Response(JSON.stringify({
        status: wrongPassword.status, error: wrongPassword.error, message: 'Authentication failed', timestamp: new Date().toISOString(),
      }), { status: wrongPassword.status })
      state = 'MFA_REQUIRED'
    }
    if (path.endsWith('/mfa')) state = 'AUTHENTICATED'
    if (path.endsWith('/complete')) return response({ state: 'AUTHENTICATED', csrfToken: csrf, owner: 'o'.repeat(43),
      version: 0, expiresAt, profile, permissions: { roles: [], permissions: [] } })
    if (!['/auth/session/bootstrap', '/auth/session', '/auth/session/login', '/auth/session/login/authenticate', '/auth/session/login/mfa'].includes(path))
      throw new Error('Unexpected route ' + path)
    return response({ state, csrfToken: csrf, expiresAt, ...(state === 'PRELOGIN' ? {} :
      { nextAction: state === 'MFA_REQUIRED' ? 'mfa' : state === 'AUTHENTICATED' ? 'complete' : 'authenticate' }) })
  }))
  const config = { sessionMode: 'server_session' as const, clientId: 'flow-test', issuerUri: 'https://iam.test',
    redirectUri: '/login', sessionLoginUri: '/auth/login', sessionProviderReturnUri: '/done',
    sessionTransport: new ConnectedAppSessionTransport({ origin: location.origin }) }
  return { config, calls }
}
it.each(['Embedded', 'Dialog'])('BFF-JS-UI: %s uses /auth, retains ordinary form errors and completes required MFA', async entry => {
  const f = fixture(), success = vi.fn()
  render(createElement(IamProvider, f.config, entry === 'Dialog'
    ? createElement(AuthDialog, { open: true, signInProps: { onSuccess: success } })
    : createElement(SignIn, { mode: 'embedded', onSuccess: success })))
  const email = await screen.findByPlaceholderText('you@example.com')
  fireEvent.change(email, { target: { value: 'u@example.test' } })
  const password = await screen.findByPlaceholderText('Enter your password')
  fireEvent.change(password, { target: { value: 'wrong' } }); fireEvent.submit(password.closest('form')!)
  await waitFor(() => expect(screen.getByPlaceholderText('Enter your password').hasAttribute('disabled')).toBe(false))
  fireEvent.change(password, { target: { value: 'fixture-password' } }); fireEvent.submit(password.closest('form')!)
  const code = await screen.findByLabelText('Authenticator code')
  expect(success).not.toHaveBeenCalled()
  fireEvent.change(code, { target: { value: '123456' } }); fireEvent.submit(code.closest('form')!)
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  expect(f.calls).toContain('/auth/session/login/complete')
  expect(sessionStorage.length).toBe(0)
  expect(document.body.innerHTML).not.toMatch(/fixture-password|controlSecret|access_token|codeVerifier/)
})
it.each(['UNAUTHORIZED', 'SESSION_INVALIDATED'])('F-JS-001: %s 401 clears the attempt, shows its error and permits identifier/password retry', async code => {
  const f = fixture({ status: 401, error: code }), success = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(IamProvider, f.config, children)
  const hook = renderHook(() => ({ flow: useAuthFlow({ onSignInSuccess: success }), client: useIamContext().client }), { wrapper })
  await waitFor(() => expect(hook.result.current.flow.state.step).toBe('identifier'))
  const generation = hook.result.current.client.state.generation
  act(() => hook.result.current.flow.actions.continueWithIdentifier({ kind: 'EMAIL', value: 'u@example.test' }))
  await act(async () => {
    await expect(hook.result.current.flow.actions.submitPassword('wrong')).rejects.toMatchObject({ status: 401, code })
  })
  await waitFor(() => expect(hook.result.current.flow.state.step).toBe('identifier'))
  expect(hook.result.current.flow.state.error).toMatchObject({ status: 401, code })
  expect(hook.result.current.client.state.generation).toBe(generation + 1)
  expect(hook.result.current.client.state.invalidationReason).toBe('unauthorized')
  expect(hook.result.current.client.isAuthenticated()).toBe(false)
  expect(success).not.toHaveBeenCalled()
  expect(f.calls.some(path => path.endsWith('/complete'))).toBe(false)
  act(() => hook.result.current.flow.actions.continueWithIdentifier({ kind: 'EMAIL', value: 'u@example.test' }))
  await act(async () => { await hook.result.current.flow.actions.submitPassword('fixture-password') })
  await waitFor(() => expect(hook.result.current.flow.state.step).toBe('mfa'))
  expect(hook.result.current.flow.state.cancellationUnconfirmed).toBe(false)
  expect(f.calls.some(path => path.endsWith('/cancel'))).toBe(false)
  await act(async () => { await hook.result.current.flow.actions.verifyMfa('123456', 'TOTP') })
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
})
it('BFF-JS-UI: Headless uses the same useAuthFlow and finite transport; token methods still reject', async () => {
  const f = fixture(), success = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(IamProvider, f.config, children)
  const hook = renderHook(() => useAuthFlow({ onSignInSuccess: success }), { wrapper })
  await waitFor(() => expect(hook.result.current.state.step).toBe('identifier'))
  act(() => hook.result.current.actions.continueWithIdentifier({ kind: 'EMAIL', value: 'u@example.test' }))
  await act(async () => { await hook.result.current.actions.submitPassword('fixture-password') })
  await waitFor(() => expect(hook.result.current.state.step).toBe('mfa'))
  await act(async () => { await hook.result.current.actions.verifyMfa('123456', 'TOTP') })
  await waitFor(() => expect(success).toHaveBeenCalledOnce())
  const client = new ServerSessionClient(f.config)
  expect(() => client.getAccessToken()).toThrow(UnsupportedOperationError)
  expect(() => f.config.sessionTransport.request({ action: 'profile' })).toThrow(UnsupportedOperationError)
  client.dispose()
})
it('BFF-JS-UI: Hosted navigation first obtains bootstrap without changing the Console default', async () => {
  const f = fixture()
  const client = new ServerSessionClient(f.config)
  expect(await client.startAuthorizationFlow()).toBe(location.origin + '/auth/login')
  expect(f.calls).toEqual(['/auth/session/bootstrap'])
  client.dispose()
})
it('BFF-JS-UI: manual email fragment checks exact landing/generation and removes proof before POST', async () => {
  const f = fixture(), base = globalThis.fetch
  const client = new ServerSessionClient(f.config)
  const flow = await client.beginAuthentication()
  let sends = 0
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    if (input.endsWith('/magic')) {
      sends++
      expect(location.hash).toBe('')
      expect(JSON.parse(String(init.body))).toEqual({ transactionId: '019b0000-0000-7000-8000-000000000099', state: 'bound-state', proof: 'fixture-email-proof' })
      return new Response(JSON.stringify({ state: 'MFA_REQUIRED', nextAction: 'mfa', csrfToken: 'c'.repeat(43),
        expiresAt: new Date(Date.now() + 300000).toISOString() }))
    }
    return base(input, init)
  })
  const fragment = new URLSearchParams({ kind: 'AUTH_PROOF', method: 'EMAIL_MAGIC_LINK',
    auth_transaction_id: '019b0000-0000-7000-8000-000000000099', state: 'bound-state', proof: 'fixture-email-proof' })
  await expect(flow.authenticateMagicLink(location.origin + '/wrong#' + fragment, { kind: 'EMAIL', value: 'u@example.test' }))
    .rejects.toMatchObject({ code: 'AUTH_MAGIC_CALLBACK_INVALID' })
  history.replaceState(null, '', '/login#' + fragment)
  expect((await flow.authenticateMagicLink(location.href, { kind: 'EMAIL', value: 'u@example.test' })).state).toBe('MFA_REQUIRED')
  await expect(flow.authenticateMagicLink(location.origin + '/login#' + fragment, { kind: 'EMAIL', value: 'u@example.test' }))
    .rejects.toMatchObject({ code: 'AUTH_MAGIC_CALLBACK_INVALID' })
  expect(sends).toBe(1)
  client.dispose(); history.replaceState(null, '', '/')
})
it('A-JS-001: explicit ConnectedApp C0 registration adapter carries one opaque reference through all actions', async () => {
  const f = fixture(), base = globalThis.fetch, ref = 'r'.repeat(43)
  const paths: string[] = []
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname
    if (!path.startsWith('/auth/registration')) return base(input, init)
    paths.push(path)
    if (init.method !== 'GET') expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('c'.repeat(43))
    return new Response(JSON.stringify({ registrationId: ref,
      status: path.endsWith('/complete') ? 'COMPLETED' : path.endsWith('/cancel') ? 'CANCELLED' : 'PENDING_VERIFICATION',
      nextAction: path.endsWith('/complete') ? 'LOGIN' : path.endsWith('/cancel') ? 'RESTART' : 'VERIFY_EMAIL',
      expiresAt: new Date(Date.now() + 300000).toISOString(), nextChallengeAt: null }))
  })
  const client = new ServerSessionClient(f.config)
  await client.initialize()
  const start = await client.identity.startRegistration({ identifier: { kind: 'EMAIL', value: 'new@example.test' }, password: 'FixturePass123!' }, 'registration-one')
  expect(start.registrationId).toBe(ref)
  expect((await client.identity.getRegistration(ref)).registrationId).toBe(ref)
  expect((await client.identity.registrationAction(ref, 'challenges')).registrationId).toBe(ref)
  expect((await client.identity.registrationAction(ref, 'complete', '123456')).status).toBe('COMPLETED')
  expect((await client.identity.registrationAction(ref, 'cancel')).status).toBe('CANCELLED')
  expect(paths).toEqual(['/auth/registration', '/auth/registration/' + ref, '/auth/registration/' + ref + '/challenges',
    '/auth/registration/' + ref + '/complete', '/auth/registration/' + ref + '/cancel'])
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ref, status: 'PENDING_VERIFICATION',
    expiresAt: new Date().toISOString(), nextAction: 'VERIFY_EMAIL' })))
  await expect(client.identity.getRegistration(ref)).rejects.toMatchObject({ code: 'SESSION_RESPONSE_INVALID' })
  client.dispose()
})
