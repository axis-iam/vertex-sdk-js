import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { StrictMode } from 'react'
import { CookieSessionTransport } from '@axis-iam/vertex'
import { IamProvider, useIamContext } from '../provider/IamProvider'
import { OrganizationInvitationAccept } from './OrganizationInvitationAccept'
import { invitationView, invitationRef, invitationProof, invitationRegistration, invitationEnrollment } from '../core/invitation-fixtures.test-support'
import { makeTestUser } from '../test-utils'

function fixture(authenticated = true, requiredMfa = false) {
  let view = invitationView(authenticated ? 'CONFIRM_REQUIRED' : 'REGISTRATION_REQUIRED')
  let enrollment = invitationEnrollment()
  let lost: 'confirm' | 'registration' | 'enrollment' | 'exchange' | 'entryRegistration' | null = null
  let entryError: string | null = null
  let preparationFailure: 'network' | 'denied' | null = null
  let loggedIn = authenticated
  const calls: { path: string; body: unknown; headers: Headers }[] = []
  const csrf = 's'.repeat(43)
  const user = makeTestUser(); user.authenticationContext.clientId = 'invitation-client'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname, body = init.body ? JSON.parse(String(init.body)) : null
    const headers = new Headers(init.headers)
    calls.push({ path, body, headers })
    expect(init.credentials).toBe('same-origin')
    expect(headers.has('Authorization')).toBe(false)
    if (init.method === 'POST') expect(headers.get('X-CSRF-Token')).toBe(csrf)
    if (path.endsWith('/bootstrap')) return Response.json(loggedIn
      ? { state: 'AUTHENTICATED', owner: 'o'.repeat(43), version: 1, csrfToken: csrf, expiresAt: '2090-01-01T00:00:00Z', profile: user, permissions: { roles: [], permissions: [] } }
      : { state: 'PRELOGIN', csrfToken: csrf, expiresAt: '2090-01-01T00:00:00Z' })
    if (path.endsWith('/session/logout')) {
      loggedIn = false
      return Response.json({ state: 'PRELOGIN', csrfToken: csrf, expiresAt: '2090-01-01T00:00:00Z' })
    }
    if (path.endsWith('/continuations/prepare') && preparationFailure) {
      const failure = preparationFailure
      preparationFailure = null
      if (failure === 'network') throw new TypeError('read-only preparation response lost')
      return Response.json({ error: 'INVITATION_POLICY_DENIED' }, { status: 403 })
    }
    if (path.endsWith('/continuations/exchange')) {
      if (entryError) return Response.json({ error: entryError }, { status: 403 })
      if (lost === 'exchange') { lost = null; throw new TypeError('response lost after exchange') }
    }
    if (path.endsWith('/continuations/registration') && lost === 'entryRegistration') {
      lost = null; throw new TypeError('response lost after entry registration')
    }
    if (path.endsWith('/registration/verify')) { view = invitationView(requiredMfa ? 'AUTHENTICATING' : 'CONFIRM_REQUIRED'); return Response.json(invitationRegistration('COMPLETED')) }
    if (path.endsWith('/mfa/enrollment/complete')) {
      enrollment = invitationEnrollment('COMPLETED'); view = invitationView()
      if (lost === 'enrollment') { lost = null; throw new TypeError('response lost') }
      return Response.json(enrollment)
    }
    if (path.endsWith('/mfa/enrollment')) {
      if (init.method === 'GET') return Response.json(enrollment)
      enrollment = invitationEnrollment('PENDING')
      return Response.json({ enrollment, delivery: 'AVAILABLE',
        totp: { secret: 'JBSWY3DPEHPK3PXP', qrCodeUri: 'otpauth://totp/Unit?secret=JBSWY3DPEHPK3PXP', issuer: 'Unit' }, webauthn: null })
    }
    if (path.endsWith('/authentication/registration')) {
      if (init.method === 'POST' && lost === 'registration') { lost = null; throw new TypeError('response lost') }
      return Response.json(invitationRegistration())
    }
    if (path.endsWith('/confirm')) {
      view = invitationView('COMMITTED')
      if (lost === 'confirm') { lost = null; throw new TypeError('response lost') }
    }
    if (path.endsWith('/cancel')) view = invitationView('CANCELLED')
    if (path.includes('/invitation-journeys/')) return Response.json(view)
    throw new Error('Unexpected test route ' + path)
  }))
  const config = { sessionMode: 'server_session' as const, sessionTransport: new CookieSessionTransport({ origin: window.location.origin }),
    clientId: 'invitation-client', issuerUri: 'https://issuer.example.test', redirectUri: '/callback' }
  return { calls, config, lose: (value: typeof lost) => { lost = value },
    failPreparation: (value: typeof preparationFailure) => { preparationFailure = value },
    denyEntry: (code: string) => { entryError = code },
    matchingLogin: () => { loggedIn = true; entryError = null; user.id = 'matching-user'; view = invitationView() },
    setView: (value: typeof view) => { view = value } }
}
function MatchingAccountLogin({ complete }: { complete: () => void }) {
  const { client } = useIamContext()
  return <button onClick={() => { complete(); void client.initialize() }}>Sign in as invited account</button>
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); sessionStorage.clear(); localStorage.clear() })
it.each([true, false])('shows a same-page preparation retry after read loss (authenticated=%s), then waits for separate confirmation', async authenticated => {
  const f = fixture(authenticated); f.failPreparation('network')
  window.history.replaceState(null, '', '/invitation?continuation=' + invitationProof)
  render(<IamProvider {...f.config}><OrganizationInvitationAccept /></IamProvider>)
  if (!authenticated) fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  const retry = await screen.findByRole('button', { name: 'Retry loading invitation' })
  expect(f.calls.filter(c => c.path.endsWith('/continuations/prepare'))).toHaveLength(1)
  expect(f.calls.some(c => c.path.endsWith('/continuations/exchange') || c.path.endsWith('/continuations/registration'))).toBe(false)
  expect(screen.queryByRole('button', { name: 'Check invitation result' })).toBeNull()
  expect(screen.queryByText(/response was lost/i)).toBeNull()
  expect(window.location.href).not.toContain('journeyRef')
  fireEvent.click(retry)
  if (!authenticated) {
    const email = await screen.findByLabelText('Email')
    fireEvent.change(email, { target: { value: 'member@example.test' } })
    const password = screen.getByLabelText('Password')
    fireEvent.change(password, { target: { value: 'unit-only-account-password' } })
    fireEvent.submit(password.closest('form')!)
    const code = await screen.findByLabelText('Verification code')
    fireEvent.change(code, { target: { value: '123456' } }); fireEvent.submit(code.closest('form')!)
  }
  const confirm = await screen.findByRole('button', { name: 'Accept invitation' })
  const preparations = f.calls.filter(c => c.path.endsWith('/continuations/prepare'))
  expect(preparations).toHaveLength(2)
  expect(preparations.map(c => c.body)).toEqual([0, 1].map(() => ({ continuation: invitationProof, mode: authenticated ? 'authenticated' : 'registration' })))
  expect(f.calls.filter(c => c.path.endsWith(authenticated ? '/continuations/exchange' : '/continuations/registration'))).toHaveLength(1)
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  expect(document.body.innerHTML + window.location.href).not.toContain(invitationProof)
  expect(sessionStorage.length + localStorage.length).toBe(0)
  fireEvent.click(confirm)
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
  expect(f.calls.filter(c => c.path.endsWith('/confirm'))).toHaveLength(1)
})
it.each([true, false])('shows an accurate preparation denial and a safe explicit retry (authenticated=%s)', async authenticated => {
  const f = fixture(authenticated); f.failPreparation('denied')
  render(<IamProvider {...f.config}><OrganizationInvitationAccept continuation={invitationProof} /></IamProvider>)
  if (!authenticated) fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  const retry = await screen.findByRole('button', { name: 'Retry loading invitation' })
  expect(screen.getByRole('alert').textContent).not.toMatch(/response was lost/i)
  expect(f.calls.some(c => c.path.endsWith('/continuations/exchange') || c.path.endsWith('/continuations/registration'))).toBe(false)
  fireEvent.click(retry)
  await waitFor(() => expect(f.calls.filter(c => c.path.endsWith(authenticated ? '/continuations/exchange' : '/continuations/registration'))).toHaveLength(1))
  expect(screen.queryByRole('button', { name: 'Retry loading invitation' })).toBeNull()
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
})
it.each(['INVITATION_ACCOUNT_MISMATCH', 'EMAIL_VERIFICATION_REQUIRED'])('switches a known %s denial through normal logout and resumes the same invitation', async code => {
  const f = fixture(); f.denyEntry(code)
  window.history.replaceState(null, '', '/invitation?continuation=' + invitationProof)
  render(<IamProvider {...f.config}><OrganizationInvitationAccept renderLogin={() => <MatchingAccountLogin complete={f.matchingLogin} />} /></IamProvider>)
  const switchAccount = await screen.findByRole('button', { name: 'Switch account' })
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
  expect(window.location.href).not.toContain('journeyRef')
  fireEvent.click(switchAccount)
  fireEvent.click(await screen.findByRole('button', { name: 'Sign in as invited account' }))
  const confirm = await screen.findByRole('button', { name: 'Accept invitation' })
  expect(f.calls.filter(c => c.path.endsWith('/session/logout'))).toHaveLength(1)
  expect(f.calls.filter(c => c.path.endsWith('/continuations/exchange')).map(c => c.body)).toEqual([
    { continuation: invitationProof }, { continuation: invitationProof },
  ])
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  expect(document.body.innerHTML + window.location.href).not.toContain(invitationProof)
  expect(sessionStorage.length + localStorage.length).toBe(0)
  fireEvent.click(confirm)
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
})
it.each([true, false])('recovers an initial exchange response loss (authenticated=%s) by GET without repeating exchange', async authenticated => {
  const f = fixture(authenticated); f.lose(authenticated ? 'exchange' : 'entryRegistration')
  render(<IamProvider {...f.config}><OrganizationInvitationAccept continuation={invitationProof} /></IamProvider>)
  if (!authenticated) fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  expect(await screen.findByText(/response was lost/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Switch account' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry loading invitation' })).toBeNull()
  expect(window.location.href).not.toContain('journeyRef')
  fireEvent.click(screen.getByRole('button', { name: 'Check invitation result' }))
  if (authenticated) await screen.findByRole('button', { name: 'Accept invitation' })
  else await waitFor(() => expect(screen.queryByText(/response was lost/)).toBeNull())
  const suffix = authenticated ? '/continuations/exchange' : '/continuations/registration'
  expect(f.calls.filter(c => c.path.endsWith(suffix))).toHaveLength(1)
  expect(f.calls.some(c => c.path.endsWith('/' + invitationRef) && c.body === null)).toBe(true)
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  expect(document.body.innerHTML + window.location.href).not.toContain(invitationProof)
  expect(sessionStorage.length + localStorage.length).toBe(0)
})
it('finishes new-account enrollment, recovers a lost completion, then still requires explicit acceptance', async () => {
  const f = fixture(false, true)
  render(<IamProvider {...f.config}><OrganizationInvitationAccept continuation={invitationProof} /></IamProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'new@example.test' } })
  const password = screen.getByLabelText('Password')
  fireEvent.change(password, { target: { value: 'unit-only-password' } }); fireEvent.submit(password.closest('form')!)
  const verification = await screen.findByLabelText('Verification code')
  fireEvent.change(verification, { target: { value: '123456' } }); fireEvent.submit(verification.closest('form')!)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up authenticator' }))
  expect(await screen.findByLabelText('Authenticator setup QR code')).toBeTruthy()
  expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
  const code = screen.getByLabelText('Authenticator code')
  fireEvent.change(code, { target: { value: '123456' } })
  f.lose('enrollment')
  fireEvent.submit(code.closest('form')!)
  expect(await screen.findByText(/response was lost/)).toBeTruthy()
  expect(document.body.textContent).not.toContain('JBSWY3DPEHPK3PXP')
  fireEvent.click(screen.getByRole('button', { name: 'Check this operation' }))
  const confirm = await screen.findByRole('button', { name: 'Accept invitation' })
  expect(f.calls.filter(c => c.path.endsWith('/enrollment/complete'))).toHaveLength(1)
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  expect(f.calls.some(c => c.path.includes('/session/login'))).toBe(false)
  fireEvent.click(confirm)
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
})
it('scrubs URL synchronously and survives StrictMode without duplicate exchange or automatic confirm', async () => {
  const f = fixture(), accepted = vi.fn()
  window.history.replaceState(null, '', '/invitation?continuation=' + invitationProof)
  render(<StrictMode><IamProvider {...f.config}><OrganizationInvitationAccept onAccepted={accepted} /></IamProvider></StrictMode>)
  expect(window.location.href).not.toContain('continuation')
  expect(await screen.findByText('Join Team')).toBeTruthy()
  expect(f.calls.filter(c => c.path.endsWith('/continuations/exchange'))).toHaveLength(1)
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
  expect(accepted).toHaveBeenCalledTimes(1)
  expect(document.body.innerHTML).not.toContain(invitationProof)
  expect(sessionStorage.length + localStorage.length).toBe(0)
})
it('recovers committed lost confirmation through GET, never a second confirm', async () => {
  const f = fixture(); f.lose('confirm')
  render(<IamProvider {...f.config}><OrganizationInvitationAccept journeyRef={invitationRef} /></IamProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText(/response was lost/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Check invitation result' }))
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
  expect(f.calls.filter(c => c.path.endsWith('/confirm'))).toHaveLength(1)
})
it('creates and verifies an account but only joins after a separate explicit confirmation', async () => {
  const f = fixture(false)
  render(<IamProvider {...f.config}><OrganizationInvitationAccept continuation={invitationProof} /></IamProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'member@example.test' } })
  const password = screen.getByLabelText('Password')
  fireEvent.change(password, { target: { value: 'test-only-password' } }); fireEvent.submit(password.closest('form')!)
  const code = await screen.findByLabelText('Verification code')
  expect((password as HTMLInputElement).value).toBe('')
  fireEvent.change(code, { target: { value: '123456' } }); fireEvent.submit(code.closest('form')!)
  await screen.findByRole('button', { name: 'Accept invitation' })
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
})
it('offers registration status recovery when the initial registration response is lost', async () => {
  const f = fixture(false); f.lose('registration')
  render(<IamProvider {...f.config}><OrganizationInvitationAccept continuation={invitationProof} /></IamProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'member@example.test' } })
  const password = screen.getByLabelText('Password'); fireEvent.change(password, { target: { value: 'test-only-password' } }); fireEvent.submit(password.closest('form')!)
  fireEvent.click(await screen.findByRole('button', { name: 'Check registration status' }))
  expect(await screen.findByLabelText('Verification code')).toBeTruthy()
  expect(f.calls.filter(c => c.path.endsWith('/authentication/registration') && c.body !== null)).toHaveLength(1)
})
it.each(['CANCELLED', 'EXPIRED', 'REVOKED', 'UNAVAILABLE'] as const)('does not offer confirmation for authoritative %s', async state => {
  const f = fixture(); f.setView(invitationView(state))
  render(<IamProvider {...f.config}><OrganizationInvitationAccept journeyRef={invitationRef} /></IamProvider>)
  await waitFor(() => expect(screen.queryByText('Loading invitation...')).toBeNull())
  expect(await screen.findByText('Join Team')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
})
it('keeps committed success separate from host navigation failure', async () => {
  const f = fixture()
  render(<IamProvider {...f.config}><OrganizationInvitationAccept journeyRef={invitationRef} onAccepted={() => { throw new Error('host failure') }} /></IamProvider>)
  fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
  expect(await screen.findByText('Invitation accepted.')).toBeTruthy()
  expect(await screen.findByText(/next page could not be opened/)).toBeTruthy()
})
it('requires reviewing a changed role before a separate confirmation using the refreshed version', async () => {
  const f = fixture()
  f.setView({ ...invitationView('PREVIEW'), role: 'ADMIN', invitationVersion: 6, result: 'ROLE_CHANGED' })
  render(<IamProvider {...f.config}><OrganizationInvitationAccept journeyRef={invitationRef} /></IamProvider>)
  const review = await screen.findByRole('button', { name: 'Review updated invitation' })
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull()
  f.setView({ ...invitationView(), role: 'ADMIN', invitationVersion: 6 })
  fireEvent.click(review)
  const confirm = await screen.findByRole('button', { name: 'Accept invitation' })
  expect(f.calls.find(c => c.path.endsWith('/continue'))?.body).toEqual({ expectedVersion: 6 })
  expect(f.calls.some(c => c.path.endsWith('/confirm'))).toBe(false)
  fireEvent.click(confirm)
  await screen.findByText('Invitation accepted.')
  expect(f.calls.find(c => c.path.endsWith('/confirm'))?.body).toEqual({ expectedInvitationVersion: 6, expectedRole: 'ADMIN' })
})
