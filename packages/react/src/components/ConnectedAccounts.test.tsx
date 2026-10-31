import { managedIdentifiers, managementCapability } from '../core/identity-management-fixtures.test-support'
import type { ReactElement } from 'react'
import * as webauthn from '../core/identity-webauthn'
import { IamUiProvider } from '../provider/IamUiProvider'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../core/oauth-client'
import { ConnectedAccounts } from './ConnectedAccounts'
import { AccountProfilePanel } from './AccountProfilePanel'
import { AccountCenter } from './AccountCenter'
import { makeTestJwt } from '../test-utils'
import { identityEnglish, identityZhCN } from '../identity-localization'
import { identityOperationStore } from '../core/identity-operation-store'
import { useIdentityOperations } from '../hooks/useIdentityOperations'
import { flowCapabilities } from '../core/auth-flow-fixtures.test-support'

vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client, user: client.tokenManager.getUser(), isAuthenticated: true, isLoaded: true }) }))
const issuer = 'https://auth.test.com'
let client: OAuthClient
const fetchMock = vi.fn<typeof fetch>()
const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })
const operation = (state = 'AWAITING_REAUTH') => ({ id: 'op', type: 'ADD', state, expiresAt: new Date(Date.now()+600000).toISOString(), proofOptions: [{ method: 'PASSWORD' }], completion: null, requiredProofs: [
  { purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: state !== 'AWAITING_REAUTH' },
  { purpose: 'TARGET_OWNERSHIP', methods: ['EMAIL_OTP'], strength: 'OWNERSHIP', satisfied: state === 'COMMITTED' },
] })
function openAdd(l = identityEnglish) {
  fireEvent.click(screen.getByRole('button', { name: l.addEmail }))
  return screen.getByRole('dialog')
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false } })
  client = new OAuthClient({ issuerUri: issuer, clientId: 'c', redirectUri: '/callback' })
  client.tokenManager.store({ access_token: makeTestJwt(), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/jwks` })
  vi.spyOn(client, 'getPublicAuthMethods').mockResolvedValue(flowCapabilities)
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith('/identifiers')) return response(managedIdentifiers([{ id: 'email-1', kind: 'EMAIL', displayValue: 'a@example.invalid', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true, managedBy: null }], 3))
    if (path.endsWith('/login-methods')) return response({ loginMethodVersion: 3, methods: [{ methodId: 'opaque-provider', kind: 'PROVIDER', roles: ['FIRST_FACTOR'], status: 'AVAILABLE', providerId: 'p1', capabilities: { unlink: true }, unavailableReasons: [] }] })
    if (path.endsWith('/linkable-identity-providers')) return response([{ id: 'p1', displayName: 'Provider One', providerType: 'OIDC', protocol: 'OIDC', enabled: true, linked: true, linkedAt: null, supportsAccountLinking: true, canLink: false, canReauthenticate: true, unavailableReasons: [] }])
    if (path.endsWith('/profile')) return response({ userId: 'u1', email: null, username: null, displayName: 'User', emailVerified: false, status: 'ACTIVE', avatarUrl: null })
    if (path.endsWith('/mfa/capabilities')) return response({ loginMethodVersion: 4, totpEnroll: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null }, totpDisable: { allowed: false, proofRequirement: 'SESSION', proofOptions: [], reasonCode: 'METHOD_UNAVAILABLE' }, recoveryCodesGenerate: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null } })
    if (path.endsWith('/mfa/recovery-codes/remaining')) return response({ remaining: 0 })
    if (path.endsWith('/security')) return response({ emailVerified: false, passwordCredentialPresent: true, mfaEnrolled: false, activeSessionCount: 1 })
    if (path.endsWith('/reauthenticate')) return response(operation('AWAITING_PROOF'))
    if (path.endsWith('/complete')) return response(operation('COMMITTED'))
    if (path.endsWith('/cancel')) return response(operation('CANCELLED'))
    if (path.includes('/identity-operations')) return response(operation())
    throw new Error(`Unexpected test route ${path} ${init?.method}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); client.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('AccountCenter real login-method consumer', () => {
  it('uses authenticated per-kind/per-record decisions, including grandfathered and directory verification capabilities', async () => {
    const facts = managedIdentifiers([{ id: 'managed-email', kind: 'EMAIL', displayValue: 'old@outside.invalid', status: 'ACTIVE', verificationState: 'UNVERIFIED', isPrimary: true, managedBy: 'directory' }], 3)
    facts.management.add.PHONE = managementCapability(['TARGET_PROOF_UNAVAILABLE'], ['CURRENT_ACCOUNT_PROOF', 'NEW_IDENTIFIER', 'TARGET_PHONE_OTP'])
    facts.items[0].capabilities.REMOVE = managementCapability(['LAST_LOGIN_METHOD'], ['CURRENT_ACCOUNT_PROOF', 'REMAINING_LOGIN_PATH'])
    vi.spyOn(client.identity, 'identifiers').mockResolvedValue(facts)
    vi.mocked(client.getPublicAuthMethods).mockRejectedValue(new Error('anonymous metadata must not be used'))
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('old@outside.invalid')
    expect(screen.getByRole('button', { name: identityEnglish.addPhone }).matches(':disabled')).toBe(true)
    expect(screen.getByText('Verification delivery for this identifier is unavailable.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.manageEmails }))
    expect(screen.getByRole('button', { name: identityEnglish.verify, exact: true }).matches(':disabled')).toBe(false)
    expect(screen.getByRole('button', { name: identityEnglish.remove, exact: true }).matches(':disabled')).toBe(true)
    expect(screen.getByText('Add another complete sign-in path before removing this one.')).toBeTruthy()
    expect(client.getPublicAuthMethods).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.addEmail }))
    expect(screen.getByRole('region', { name: identityEnglish.managementRequirements })).toBeTruthy()
    expect(screen.getByText(identityEnglish.managementRequirement.TARGET_EMAIL_OTP)).toBeTruthy()
    expect(screen.getByText(identityEnglish.passwordMethod)).toBeTruthy()
  })
  it('bounds the email overview and pages five rows while retaining off-page primary candidates', async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({ id: `email-${index + 1}`, kind: 'EMAIL' as const,
      displayValue: `member${index + 1}@example.invalid`, status: 'ACTIVE' as const,
      verificationState: index === 1 ? 'UNVERIFIED' : 'VERIFIED', isPrimary: index === 0, managedBy: null }))
    const snapshot = managedIdentifiers(items, 3)
    snapshot.items[0].capabilities.REMOVE.replacementPrimaryIds = ['email-11']
    vi.spyOn(client.identity, 'identifiers').mockResolvedValue(snapshot)
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('member1@example.invalid')
    expect(screen.queryByText('member6@example.invalid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.manageEmails }))
    expect(screen.queryByText('member6@example.invalid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.next }))
    expect(screen.getByText('member6@example.invalid')).toBeTruthy()
    expect(screen.queryByText('member2@example.invalid')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.previous }))
    const more = screen.getByLabelText(`${identityEnglish.moreActions}: member1@example.invalid`).parentElement!
    fireEvent.click(within(more).getByRole('button', { name: identityEnglish.remove }))
    const primary = screen.getByLabelText(identityEnglish.replacementPrimary)
    expect(within(primary).queryByRole('option', { name: 'member3@example.invalid' })).toBeNull()
    expect(within(primary).getByRole('option', { name: 'member11@example.invalid' })).toBeTruthy()
    expect(within(primary).queryByRole('option', { name: 'member2@example.invalid' })).toBeNull()
    expect((primary as HTMLSelectElement).value).toBe('')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: identityEnglish.complete }))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')).toBe(false)
    fireEvent.change(primary, { target: { value: 'email-11' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: identityEnglish.complete }))
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ type: 'REMOVE', payload: { identifierId: 'email-1', replacementPrimaryId: 'email-11' } })
  })
  it('continues PHONE addition through current-account and target SMS proof to a definitive result', async () => {
    const previous = fetchMock.getMockImplementation()!
    const phoneOperation = (state: string) => ({ ...operation(state), maskedIdentifier: '+86 138****8000',
      requiredProofs: [{ purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: state !== 'AWAITING_REAUTH' },
        { purpose: 'TARGET_OWNERSHIP', methods: ['PHONE_OTP'], strength: 'OWNERSHIP', satisfied: state === 'COMMITTED' }],
      completion: state === 'COMMITTED' ? { completedAt: new Date().toISOString(), finalLoginMethodVersion: 4, sessionImpact: 'CURRENT_SESSION_RETAINED' } : null })
    fetchMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.endsWith('/identity-operations')) return response(phoneOperation('AWAITING_REAUTH'))
      if (path.endsWith('/reauthenticate') || path.endsWith('/challenges')) return response(phoneOperation('AWAITING_PROOF'))
      if (path.endsWith('/complete')) return response(phoneOperation('COMMITTED'))
      return previous(url, init)
    })
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.addPhone }))
    fireEvent.change(screen.getByLabelText(identityEnglish.PHONE), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText(identityEnglish.phoneCountry), { target: { value: 'CN' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: identityEnglish.add }))
    await screen.findByLabelText(identityEnglish.password)
    fireEvent.change(screen.getByLabelText(identityEnglish.password), { target: { value: 'fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyContinue }))
    await screen.findByLabelText(identityEnglish.otp)
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.send }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/challenges'))).toBe(true))
    fireEvent.change(screen.getByLabelText(identityEnglish.otp), { target: { value: '123456' } })
    await waitFor(() => expect(screen.getByRole('button', { name: identityEnglish.verifyComplete }).matches(':disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyComplete }))
    await screen.findByRole('heading', { name: identityEnglish.COMMITTED })
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/complete'))
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ proofs: [{ purpose: 'TARGET_OWNERSHIP', method: 'PHONE_OTP', code: '123456' }] })
  })
  it('preserves bound facts on authoritative last-path rejection and obeys provider unlink capability', async () => {
    vi.spyOn(client.identity, 'loginMethods').mockResolvedValue({ loginMethodVersion: 3, methods: [{ methodId: 'provider-last', kind: 'PROVIDER', roles: ['FIRST_FACTOR'], status: 'AVAILABLE', providerId: 'p1', capabilities: { unlink: false }, unavailableReasons: [] }] })
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    expect(screen.getByRole('button', { name: identityEnglish.unlink }).matches(':disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.manageEmails }))
    const more = screen.getByLabelText(`${identityEnglish.moreActions}: a@example.invalid`).parentElement!
    fireEvent.click(within(more).getByRole('button', { name: identityEnglish.remove }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'LAST_LOGIN_METHOD' }), { status: 409 }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: identityEnglish.complete }))
    await screen.findByText(identityEnglish.lastPathProtection)
    await waitFor(() => expect(identityOperationStore(client).getSnapshot().error).toMatchObject({ code: 'LAST_LOGIN_METHOD' }))
    expect(screen.getAllByText('a@example.invalid').length).toBeGreaterThan(0)
    expect(identityOperationStore(client).getSnapshot().uncertainCreate).toBeNull()
  })
  it('keeps a definitively range-rejected binding editable instead of requiring uncertain-create recovery', async () => {
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    const additions = openAdd()
    const input = within(additions).getByLabelText(identityEnglish.EMAIL)
    fireEvent.change(input, { target: { value: 'outside@other.invalid' } })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'IDENTIFIER_RANGE_REJECTED' }), { status: 403 }))
    fireEvent.click(within(additions).getByRole('button', { name: identityEnglish.add }))
    await screen.findByText('This address or phone region cannot be used here. Choose another identifier or contact support.')
    expect(screen.queryByText(identityEnglish.createUnconfirmed)).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.recoverCreate })).toBeNull()
    expect(input.matches(':disabled')).toBe(false)
    expect(within(additions).getByRole('button', { name: identityEnglish.add }).matches(':disabled')).toBe(false)
    expect(input.getAttribute('value')).toBe('outside@other.invalid')
  })

  it('does not use anonymous signup regions to grant or hide authenticated management actions', async () => {
    vi.mocked(client.getPublicAuthMethods).mockResolvedValue({
      ...flowCapabilities,
      identifierRestrictions: {
        signup: { email: { restricted: false }, phone: { restricted: true, allowedRegions: ['CA'] } },
        login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } },
      },
    })
    render(<IamUiProvider locale="en"><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.addPhone }))
    const region = screen.getByRole('combobox', { name: identityEnglish.phoneCountry })
    expect(within(region).getAllByRole('option').length).toBeGreaterThan(2)
    expect(within(region).getByRole('option', { name: 'Canada (+1)' })).toBeTruthy()
    expect(within(region).getByRole('option', { name: 'China (+86)' })).toBeTruthy()
    expect(client.getPublicAuthMethods).not.toHaveBeenCalled()
    expect(screen.getByText('a@example.invalid')).toBeTruthy()
  })

  it.each(['en', 'zh-CN'] as const)('locks edits and dialog close while %s recovers the exact original create', async locale => {
    const l = locale === 'en' ? identityEnglish : identityZhCN
    const close = vi.fn()
    const previous = fetchMock.getMockImplementation()!
    let lost = true
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/identity-operations') && init?.method === 'POST' && lost) {
        lost = false
        throw new TypeError('response lost')
      }
      return previous(url, init)
    })
    render(<IamUiProvider locale={locale}><AccountCenter open onOpenChange={close} initialSection="methods" /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    const additions = openAdd(l)
    const input = within(additions).getByLabelText(l.EMAIL)
    fireEvent.change(input, { target: { value: 'original@example.invalid' } })
    fireEvent.click(within(additions).getByRole('button', { name: l.add }))
    await screen.findByText(l.createUnconfirmed)
    expect(input.matches(':disabled')).toBe(true)
    expect(within(additions).getByRole('button', { name: l.add }).matches(':disabled')).toBe(true)
    // Synthetic events can bypass a native disabled fieldset; recovery must still use the retained request.
    fireEvent.change(input, { target: { value: 'changed@example.invalid' } })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
    const requests = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')
    expect(requests()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: l.recoverCreate }))
    await screen.findByRole('heading', { name: l.AWAITING_REAUTH })
    expect(requests()).toHaveLength(2)
    expect(requests()[1][1]?.body).toBe(requests()[0][1]?.body)
    expect(JSON.parse(String(requests()[1][1]?.body))).toEqual({ type: 'ADD', expectedLoginMethodVersion: 3,
      payload: { identifier: { kind: 'EMAIL', value: 'original@example.invalid' } } })
    expect(new Headers(requests()[1][1]?.headers).get('Idempotency-Key')).toBe(new Headers(requests()[0][1]?.headers).get('Idempotency-Key'))
    expect(screen.queryByText(l.createUnconfirmed)).toBeNull()
  })
  it('refreshes version facts after a definitive stale rejection and requires a deliberate fresh submission', async () => {
    const previous = fetchMock.getMockImplementation()!
    let stale = true
    let refreshed = false
    fetchMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.endsWith('/identity-operations') && init?.method === 'POST' && stale) {
        stale = false
        refreshed = true
        return new Response(JSON.stringify({ error: 'STALE_LOGIN_METHOD_VERSION' }), { status: 409 })
      }
      const result = await previous(url, init)
      if (refreshed && (path.endsWith('/identifiers') || path.endsWith('/login-methods'))) {
        return response({ ...await result.json(), loginMethodVersion: 4 })
      }
      return result
    })
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    openAdd()
    const additions = () => screen.getByRole('dialog')
    fireEvent.change(within(additions()).getByLabelText(identityEnglish.EMAIL), { target: { value: 'fresh@example.invalid' } })
    fireEvent.click(within(additions()).getByRole('button', { name: identityEnglish.add }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/identifiers'))).toHaveLength(2))
    const requests = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')
    expect(requests()).toHaveLength(1)
    expect(identityOperationStore(client).getSnapshot().uncertainCreate).toBeNull()
    fireEvent.click(within(additions()).getByRole('button', { name: identityEnglish.add }))
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    expect(JSON.parse(String(requests()[1][1]?.body)).expectedLoginMethodVersion).toBe(4)
    expect(new Headers(requests()[1][1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(requests()[0][1]?.headers).get('Idempotency-Key'))
  })
  it('exposes uncertain request state and recovery to a Custom hook consumer', async () => {
    const { result } = renderHook(() => useIdentityOperations())
    const input = { type: 'ADD' as const, expectedLoginMethodVersion: 3,
      payload: { identifier: { kind: 'EMAIL' as const, value: 'custom@example.invalid' } } }
    fetchMock.mockRejectedValueOnce(new TypeError('response lost'))
    await act(async () => { await expect(result.current.actions.create(input, 'custom-key')).rejects.toThrow() })
    expect(result.current.state.uncertainCreate).toEqual({ request: input, idempotencyKey: 'custom-key' })
    await act(async () => { await expect(result.current.actions.create({ ...input, expectedLoginMethodVersion: 4 })).rejects.toMatchObject({ code: 'CREATE_UNCONFIRMED' }) })
    expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => { await result.current.actions.retryCreate() })
    expect(result.current.state).toMatchObject({ uncertainCreate: null, operation: { id: 'op' } })
    expect(fetchMock.mock.calls[1][1]?.body).toBe(fetchMock.mock.calls[0][1]?.body)
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Idempotency-Key')).toBe('custom-key')
  })
  it('keeps invalid input editable after a definitive rejection and sends the correction with a fresh key', async () => {
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    const additions = openAdd()
    const input = within(additions).getByLabelText(identityEnglish.EMAIL)
    fireEvent.change(input, { target: { value: 'invalid@example.invalid' } })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'INVALID_IDENTIFIER' }), { status: 400 }))
    fireEvent.click(within(additions).getByRole('button', { name: identityEnglish.add }))
    await screen.findByText('Check the identifier and phone region.')
    expect(input.matches(':disabled')).toBe(false)
    expect(screen.queryByText(identityEnglish.createUnconfirmed)).toBeNull()
    fireEvent.change(input, { target: { value: 'corrected@example.invalid' } })
    fireEvent.click(within(additions).getByRole('button', { name: identityEnglish.add }))
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    const requests = fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')
    expect(JSON.parse(String(requests[1][1]?.body)).payload.identifier.value).toBe('corrected@example.invalid')
    expect(new Headers(requests[1][1]?.headers).get('Idempotency-Key')).not.toBe(new Headers(requests[0][1]?.headers).get('Idempotency-Key'))
  })
  it('blocks host close during creation and retains uncertain cancellation across a later host close', async () => {
    const store = identityOperationStore(client)
    let finish!: (r: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = store.create({ type: 'ADD', expectedLoginMethodVersion: 3, payload: { identifier: { kind: 'EMAIL', value: 'new@example.invalid' } } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const close = vi.fn()
    render(<IamUiProvider><AccountCenter open onOpenChange={close} initialSection="methods" /></IamUiProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Close account center' }))
    expect(close).not.toHaveBeenCalled()
    await act(async () => { finish(response(operation())); await pending })
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    const previous = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/cancel')) throw new TypeError('offline')
      return previous(url, init)
    })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.cancelChange }))
    await screen.findByText(identityEnglish.cancelUnconfirmed)
    fireEvent.click(screen.getByRole('button', { name: 'Close account center' }))
    expect(close).toHaveBeenCalledWith(false)
    expect(store.getSnapshot().operation?.id).toBe('op')
  })
  it('orders identifiers before connected providers before additions and uses durable create/reauth/complete', async () => {
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('a@example.invalid')
    const facts = screen.getByRole('region', { name: identityEnglish.identifiers })
    const providers = screen.getByRole('region', { name: identityEnglish.providers })
    let additions = screen.getByRole('region', { name: identityEnglish.add })
    expect(facts.compareDocumentPosition(providers) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(providers.compareDocumentPosition(additions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    additions = openAdd()
    fireEvent.change(within(additions).getByLabelText(identityEnglish.EMAIL), { target: { value: 'new@example.invalid' } })
    fireEvent.click(within(additions).getByRole('button', { name: identityEnglish.add }))
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    const request = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/identity-operations'))!
    expect(JSON.parse(String(request[1]?.body))).toEqual({ type: 'ADD', expectedLoginMethodVersion: 3, payload: { identifier: { kind: 'EMAIL', value: 'new@example.invalid' } } })
    fireEvent.change(screen.getByLabelText(identityEnglish.password), { target: { value: 'private-password' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyContinue }))
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_PROOF })
    fireEvent.change(screen.getByLabelText(identityEnglish.otp), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyComplete }))
    await screen.findByRole('heading', { name: identityEnglish.COMMITTED })
    expect(document.body.textContent).not.toContain('private-password')
  })
  it('reopens the same uncertain operation after remount and shows cancellation uncertainty', async () => {
    const store = identityOperationStore(client)
    await store.reopen('op')
    const view = render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByRole('heading', { name: identityEnglish.AWAITING_REAUTH })
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline') })
    await act(async () => { try { await store.cancel() } catch { /* observable error state */ } })
    expect(screen.getByText(identityEnglish.cancelUnconfirmed)).toBeTruthy()
    view.unmount()
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await waitFor(() => expect(store.getSnapshot().cancelUnconfirmed).toBe(false))
    expect(store.getSnapshot().operation?.id).toBe('op')
  })
  it('ordinary profile edits have no username control or username write', async () => {
    render(<IamUiProvider><AccountProfilePanel /></IamUiProvider>)
    const displayName = await screen.findByLabelText('Display name')
    await waitFor(() => expect((displayName as HTMLInputElement).value).toBe('User'))
    expect(screen.queryByLabelText('Username')).toBeNull()
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Display' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true))
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(String(request[1]?.body))).toEqual({ displayName: 'Display', avatarUrl: null })
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function switchIdentity(view: ReturnType<typeof render>, tree: () => ReactElement, userId = 'new-user') {
  act(() => {
    client.tokenManager.clear()
    client.tokenManager.store({ access_token: makeTestJwt({ sub: userId, sid: 'new-session' }), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
  })
  view.rerender(tree())
}
async function controlOperation() {
  const previous = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation(async (url, init) => {
    if (String(url).includes('/identity-operations')) return response({
      ...operation(), proofOptions: [{ method: 'STEP_UP_PROOF', availableMethods: ['TOTP', 'WEBAUTHN'] }, { method: 'PROVIDER', methodId: 'opaque-provider', displayName: 'Provider One' }], requiredProofs: [{ purpose: 'CURRENT_ACCOUNT', methods: ['STEP_UP_PROOF', 'PROVIDER'], strength: 'POLICY', satisfied: false }],
    })
    return previous(url, init)
  })
  await act(async () => { await identityOperationStore(client).reopen('op') })
}
describe('SDK-C01 mounted identity form isolation', () => {
  it.each(['REPLACE', 'TRANSFER'] as const)('discards the old %s draft before new facts arrive on the same mounted client', async type => {
    const identifiers = vi.spyOn(client.identity, 'identifiers').mockResolvedValue(managedIdentifiers([
        { id: 'old-id', kind: 'EMAIL', displayValue: 'old@example.invalid', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true },
        { id: 'old-primary', kind: 'EMAIL', displayValue: 'other@example.invalid', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: false },
      ], 3))
    const tree = () => <IamUiProvider><ConnectedAccounts /></IamUiProvider>
    const view = render(tree())
    await screen.findByText('old@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.manageEmails }))
    const oldItem = screen.getAllByText('old@example.invalid').find(item => item.tagName === 'STRONG')!.parentElement!
    const root = screen.getByRole('region', { name: identityEnglish.title })
    expect(screen.queryByLabelText(identityEnglish.operationId)).toBeNull()
    fireEvent.click(within(oldItem).getByText(identityEnglish.moreActions))
    fireEvent.click(within(oldItem).getByRole('button', { name: type === 'REPLACE' ? identityEnglish.replace : identityEnglish.transfer }))
    if (type === 'REPLACE') {
      expect(screen.getByLabelText(identityEnglish.kind).matches(':disabled')).toBe(true)
      fireEvent.change(screen.getByLabelText(identityEnglish.value), { target: { value: 'old-draft@example.invalid' } })
      fireEvent.click(screen.getByLabelText(identityEnglish.removeOld))
    } else fireEvent.change(screen.getByLabelText(identityEnglish.targetUser), { target: { value: 'old-recipient' } })
    if (type === 'TRANSFER') fireEvent.change(screen.getByLabelText(identityEnglish.replacementPrimary), { target: { value: 'old-primary' } })
    const newFacts = deferred<Awaited<ReturnType<typeof client.identity.identifiers>>>()
    identifiers.mockReturnValue(newFacts.promise)
    vi.spyOn(client.identity, 'loginMethods').mockResolvedValue({ loginMethodVersion: 4, methods: [] })
    switchIdentity(view, tree, type === 'TRANSFER' ? 'user-1' : 'new-user')
    expect(screen.getByRole('region', { name: identityEnglish.title })).toBe(root)
    expect(screen.queryByText('old@example.invalid')).toBeNull()
    expect(screen.queryByRole('heading', { name: /old@example/ })).toBeNull()
    expect(screen.queryByLabelText(identityEnglish.operationId)).toBeNull()
    expect(screen.queryByLabelText(identityEnglish.value)).toBeNull()
    expect(screen.queryByLabelText(identityEnglish.kind)).toBeNull()
    expect(screen.queryByLabelText(identityEnglish.targetUser)).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.addEmail, exact: true })).toBeNull()
    await act(async () => { newFacts.resolve(managedIdentifiers([
      { id: 'new-id', kind: 'EMAIL', displayValue: 'new@example.invalid', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true },
    ], 4)) })
    await screen.findByText('new@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.manageEmails }))
    fireEvent.click(screen.getByText(identityEnglish.moreActions, { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: type === 'REPLACE' ? identityEnglish.replace : identityEnglish.transfer }))
    expect(screen.queryByLabelText(identityEnglish.replacementPrimary)).toBeNull()
    if (type === 'REPLACE') {
      expect((screen.getByLabelText(identityEnglish.removeOld) as HTMLInputElement).checked).toBe(true)
      expect(screen.getByLabelText(identityEnglish.kind).matches(':disabled')).toBe(true)
      fireEvent.change(screen.getByLabelText(identityEnglish.value), { target: { value: 'replacement@example.invalid' } })
    } else {
      expect((screen.getByLabelText(identityEnglish.targetUser) as HTMLInputElement).value).toBe('')
      fireEvent.change(screen.getByLabelText(identityEnglish.targetUser), { target: { value: 'new-recipient' } })
    }
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.complete }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')).toBe(true))
    const request = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/identity-operations') && init?.method === 'POST')!
    expect(JSON.parse(String(request[1]?.body))).toEqual({
      type, expectedLoginMethodVersion: 4, payload: type === 'REPLACE'
        ? { identifierId: 'new-id', replacement: { kind: 'EMAIL', value: 'replacement@example.invalid' }, removeOld: true }
        : { identifierId: 'new-id', targetUserId: 'new-recipient' },
    })
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })
  it.each(['existing', 'late-success', 'late-failure'] as const)('discards %s step-up state across a mounted session switch', async boundary => {
    const pending = deferred<{ challengeId: string; availableMethods: ('TOTP' | 'WEBAUTHN')[] }>()
    const start = vi.spyOn(client.identity, 'startOperationStepUp').mockReturnValue(pending.promise)
    const tree = () => <IamUiProvider><ConnectedAccounts /></IamUiProvider>
    const view = render(tree())
    await screen.findByText('a@example.invalid')
    const root = screen.getByRole('region', { name: identityEnglish.title })
    await controlOperation()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.stepUp }))
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    if (boundary === 'existing') {
      await act(async () => pending.resolve({ challengeId: 'old-challenge', availableMethods: ['TOTP'] }))
      fireEvent.change(await screen.findByLabelText(identityEnglish.otp), { target: { value: '654321' } })
    }
    switchIdentity(view, tree)
    await controlOperation()
    await act(async () => {
      if (boundary === 'late-success') pending.resolve({ challengeId: 'old-challenge', availableMethods: ['TOTP'] })
      if (boundary === 'late-failure') pending.reject(new Error('old account failure'))
    })
    expect(screen.getByRole('region', { name: identityEnglish.title })).toBe(root)
    expect(screen.queryByLabelText(identityEnglish.otp)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toContain('old-challenge')
    expect(sessionStorage.length).toBe(0)
  })
  it('does not apply a late TOTP verification to the new identity operation', async () => {
    vi.spyOn(client.identity, 'startOperationStepUp').mockResolvedValue({ challengeId: 'old-challenge', availableMethods: ['TOTP'] })
    const pending = deferred<ReturnType<typeof operation>>()
    const verify = vi.spyOn(client.identity, 'verifyOperationStepUp').mockReturnValue(pending.promise)
    const reauth = vi.spyOn(client.identity, 'reauthenticate')
    const tree = () => <IamUiProvider><ConnectedAccounts /></IamUiProvider>
    const view = render(tree())
    await screen.findByText('a@example.invalid')
    await controlOperation()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.stepUp }))
    fireEvent.change(await screen.findByLabelText(identityEnglish.otp), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyContinue }))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('op', 'old-challenge', '654321'))
    switchIdentity(view, tree)
    await controlOperation()
    await act(async () => pending.resolve(operation('AWAITING_PROOF')))
    expect(reauth).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(identityEnglish.otp)).toBeNull()
  })
  it('discards a late native WebAuthn assertion before verification or reauthentication', async () => {
    vi.spyOn(client.identity, 'startOperationStepUp').mockResolvedValue({ challengeId: 'old-challenge', availableMethods: ['WEBAUTHN'] })
    vi.spyOn(client.identity, 'startOperationWebAuthn').mockResolvedValue({ requestId: 'old-request', publicKey: '{}' })
    const pending = deferred<string>()
    const assertion = vi.spyOn(webauthn, 'assertIdentityWebAuthn').mockReturnValue(pending.promise)
    const verify = vi.spyOn(client.identity, 'verifyOperationWebAuthn')
    const reauth = vi.spyOn(client.identity, 'reauthenticate')
    const tree = () => <IamUiProvider><ConnectedAccounts /></IamUiProvider>
    const view = render(tree())
    await screen.findByText('a@example.invalid')
    await controlOperation()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.stepUp }))
    fireEvent.click(await screen.findByRole('button', { name: identityEnglish.webauthn }))
    await waitFor(() => expect(assertion).toHaveBeenCalledOnce())
    switchIdentity(view, tree)
    await controlOperation()
    await act(async () => pending.resolve('old-private-assertion'))
    expect(verify).not.toHaveBeenCalled()
    expect(reauth).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: identityEnglish.webauthn })).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })
  it('closes the old provider popup and clears pending state before a late authorization returns', async () => {
    const popup = { location: { href: 'about:blank' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const pending = deferred<{ authorizationId: string; authorizationUrl: string; expiresAt: string }>()
    const authorize = vi.spyOn(client.identity, 'authorize').mockReturnValue(pending.promise)
    const tree = () => <IamUiProvider><ConnectedAccounts redirectUri="/identity-callback" /></IamUiProvider>
    const view = render(tree())
    await screen.findByText('a@example.invalid')
    await controlOperation()
    fireEvent.click(screen.getByText(identityEnglish.otherProofs, { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.providerMethod('Provider One') }))
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.providerMethod('Provider One') }))
    await waitFor(() => expect(authorize).toHaveBeenCalledOnce())
    switchIdentity(view, tree)
    await screen.findByText('a@example.invalid')
    expect((screen.getByRole('button', { name: identityEnglish.addEmail, exact: true }) as HTMLButtonElement).disabled).toBe(false)
    expect(popup.close).toHaveBeenCalled()
    await act(async () => pending.resolve({ authorizationId: 'old-auth', authorizationUrl: 'https://old-provider.invalid', expiresAt: '2099-01-01T00:00:00Z' }))
    expect(popup.location.href).toBe('about:blank')
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByRole('button', { name: identityEnglish.addEmail, exact: true }) as HTMLButtonElement).disabled).toBe(false)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
  })
})

describe('SDK-C02 AccountCenter local methods theme', () => {
  it.each(['dark', 'light'] as const)('honors local %s over the opposite provider scheme for body, input and buttons', async local => {
    const light = { backgroundColor: '#f1f4f7', surfaceColor: '#e5edf5', textColor: '#102030', inputBackgroundColor: '#fafcfe', primaryColor: '#245678' }
    const dark = { backgroundColor: '#112233', surfaceColor: '#152637', textColor: '#eff6ff', inputBackgroundColor: '#203448', primaryColor: '#17618c' }
    render(<IamUiProvider colorScheme={local === 'dark' ? 'light' : 'dark'} darkAppearance={{ textColor: '#ff0000' }}>
      <AccountCenter open onOpenChange={() => undefined} initialSection="methods" colorScheme={local} appearance={light} darkAppearance={dark} />
    </IamUiProvider>)
    await screen.findByText('a@example.invalid')
    const tokens = local === 'dark' ? dark : light
    const rgb = (value: string) => { const div = document.createElement('div'); div.style.color = value; return div.style.color }
    const root = screen.getByRole('region', { name: identityEnglish.title })
    expect(screen.getByRole('dialog').getAttribute('data-color-scheme')).toBe(local)
    expect(getComputedStyle(root).backgroundColor).toBe(rgb(tokens.backgroundColor))
    expect(getComputedStyle(root).color).toBe(rgb(tokens.textColor))
    openAdd()
    const input = screen.getByLabelText(identityEnglish.EMAIL)
    expect(getComputedStyle(input).backgroundColor).toBe(rgb(tokens.inputBackgroundColor))
    expect(getComputedStyle(input).color).toBe(rgb(tokens.textColor))
    expect(getComputedStyle(screen.getByRole('button', { name: identityEnglish.add, exact: true })).backgroundColor).toBe(rgb(tokens.primaryColor))
    expect(getComputedStyle(screen.getByRole('button', { name: identityEnglish.later })).backgroundColor).toBe(rgb(tokens.surfaceColor))
    expect(getComputedStyle(screen.getByRole('button', { name: identityEnglish.later })).color).toBe(rgb(tokens.textColor))
  })
})

describe('ui-sdk2 operation action stages', () => {
  async function mounted(initial: ReturnType<typeof operation>) {
    let view = initial
    vi.spyOn(client.identity, 'get').mockImplementation(async () => view)
    await identityOperationStore(client).reopen('op')
    render(<IamUiProvider><ConnectedAccounts redirectUri="/identity-callback" /></IamUiProvider>)
    await screen.findByRole('heading', { name: identityEnglish[initial.state as 'AWAITING_REAUTH'] })
    return { set: (next: ReturnType<typeof operation>) => { view = next } }
  }
  it('offers one proof action, no premature completion or refresh, and submits OTP only once before terminal exit', async () => {
    const h = await mounted(operation())
    expect(screen.getAllByRole('button', { name: identityEnglish.verifyContinue })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: identityEnglish.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.reopen })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.queryStatus })).toBeNull()
    fireEvent.change(screen.getByLabelText(identityEnglish.password), { target: { value: 'private-test-password' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyContinue }))
    await screen.findByRole('button', { name: identityEnglish.verifyComplete })
    expect(screen.queryByRole('button', { name: identityEnglish.complete })).toBeNull()
    expect(screen.queryByLabelText(identityEnglish.password)).toBeNull()
    const complete = vi.spyOn(client.identity, 'complete')
    fireEvent.change(screen.getByLabelText(identityEnglish.otp), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyComplete }))
    await screen.findByRole('heading', { name: identityEnglish.COMMITTED })
    expect(complete).toHaveBeenCalledExactlyOnceWith('op', { proofs: [{ purpose: 'TARGET_OWNERSHIP', method: 'EMAIL_OTP', code: '123456' }] })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.later })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.cancelChange })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.done }))
    expect(screen.queryByRole('dialog')).toBeNull()
    h.set(operation('COMMITTED'))
  })
  it('shows generic completion only for READY and all satisfied proofs, guarded against synthetic premature submission', async () => {
    const ready = { ...operation('READY'), requiredProofs: operation('COMMITTED').requiredProofs }
    const h = await mounted(ready)
    expect(screen.getAllByRole('button', { name: identityEnglish.complete })).toHaveLength(1)
    expect(screen.queryByRole('textbox')).toBeNull()
    h.set({ ...ready, state: 'AWAITING_PROOF' })
    await act(() => identityOperationStore(client).reopen())
    expect(screen.queryByRole('button', { name: identityEnglish.complete })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/complete'))).toBe(false)
  })
  it('chooses one available account path and clears passwords when switching to a named Provider', async () => {
    await mounted({ ...operation(), proofOptions: [{ method: 'PASSWORD' }, { method: 'STEP_UP_PROOF', availableMethods: ['TOTP'] }, { method: 'PROVIDER', methodId: 'opaque-provider', displayName: 'Provider One' }], requiredProofs: [
      { purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD', 'STEP_UP_PROOF', 'PROVIDER'], strength: 'POLICY', satisfied: false },
    ] })
    fireEvent.change(screen.getByLabelText(identityEnglish.password), { target: { value: 'discard-me' } })
    expect(screen.getAllByRole('button', { name: identityEnglish.verifyContinue })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: identityEnglish.providerDone })).toBeNull()
    fireEvent.click(screen.getByText(identityEnglish.otherProofs, { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.providerMethod('Provider One') }))
    expect(screen.queryByLabelText(identityEnglish.password)).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.verifyContinue })).toBeNull()
    expect(screen.getAllByRole('button', { name: identityEnglish.providerMethod('Provider One') })).toHaveLength(1)
    expect(document.body.innerHTML).not.toContain('discard-me')
  })
  it('blocks proof replay after a lost completion and queries the exact operation before terminal exit', async () => {
    const h = await mounted(operation('AWAITING_PROOF'))
    const complete = vi.spyOn(client.identity, 'complete').mockRejectedValue(new TypeError('lost completion response'))
    fireEvent.change(screen.getByLabelText(identityEnglish.otp), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyComplete }))
    await screen.findByRole('button', { name: identityEnglish.queryStatus })
    const form = screen.getByLabelText(identityEnglish.otp).closest('form')!
    fireEvent.change(screen.getByLabelText(identityEnglish.otp), { target: { value: '123456' } })
    fireEvent.submit(form)
    expect(complete).toHaveBeenCalledOnce()
    h.set(operation('COMMITTED'))
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.queryStatus }))
    await screen.findByRole('heading', { name: identityEnglish.COMMITTED })
    expect(client.identity.get).toHaveBeenLastCalledWith('op')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.queryStatus })).toBeNull()
  })
  it('preserves recipient transfer decisions after account proof and never substitutes complete or initiator cancel', async () => {
    const transfer = { ...operation(), type: 'TRANSFER', requiredProofs: [
      { purpose: 'TRANSFER_COUNTERPART', methods: ['PASSWORD'], strength: 'POLICY', satisfied: false },
    ] }
    let view = transfer
    vi.spyOn(client.identity, 'get').mockImplementation(async () => view)
    vi.spyOn(client.identity, 'reauthenticate').mockImplementation(async () => transfer)
    const confirm = vi.spyOn(client.identity, 'confirmTransfer').mockImplementation(async (_id, decision) => {
      view = { ...transfer, state: decision === 'ACCEPT' ? 'READY' : 'REJECTED', requiredProofs: transfer.requiredProofs.map(p => ({ ...p, satisfied: true })) }
      return view
    })
    await identityOperationStore(client).reopen('op')
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByLabelText(identityEnglish.password)
    expect(screen.queryByRole('button', { name: identityEnglish.accept })).toBeNull()
    expect(screen.getByRole('button', { name: identityEnglish.reject })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(identityEnglish.password), { target: { value: 'recipient-password' } })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.verifyContinue }))
    await screen.findByRole('button', { name: identityEnglish.accept })
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.accept }))
    await waitFor(() => expect(confirm).toHaveBeenCalledExactlyOnceWith('op', 'ACCEPT'))
    expect(screen.queryByRole('button', { name: identityEnglish.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.cancelChange })).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/complete') || String(url).endsWith('/cancel'))).toBe(false)
  })
  it('lets a recipient reject without account proof and displays the real terminal result', async () => {
    const transfer = { ...operation(), type: 'TRANSFER', requiredProofs: [
      { purpose: 'TRANSFER_COUNTERPART', methods: ['PASSWORD'], strength: 'POLICY', satisfied: false },
    ] }
    const confirm = vi.spyOn(client.identity, 'confirmTransfer').mockResolvedValue({ ...transfer, state: 'REJECTED' })
    await mounted(transfer)
    fireEvent.click(screen.getByRole('button', { name: identityEnglish.reject }))
    await screen.findByRole('heading', { name: identityEnglish.REJECTED })
    expect(confirm).toHaveBeenCalledExactlyOnceWith('op', 'REJECT')
    expect(screen.queryByRole('button', { name: identityEnglish.later })).toBeNull()
    expect(screen.getByRole('button', { name: identityEnglish.done })).toBeTruthy()
  })
  it('does not let the initiating account complete a transfer while the other account is still pending', async () => {
    await mounted({ ...operation('AWAITING_PROOF'), type: 'TRANSFER', requiredProofs: [
      { purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: true },
      { purpose: 'TRANSFER_COUNTERPART', methods: [], strength: 'POLICY', satisfied: false },
    ] })
    expect(screen.getByText(identityEnglish.awaitingCounterpart)).toBeTruthy()
    expect(screen.queryByRole('button', { name: identityEnglish.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.accept })).toBeNull()
    expect(screen.getByRole('button', { name: identityEnglish.cancelChange })).toBeTruthy()
  })
  it('does not leave proof forms or writable actions on an expired operation', async () => {
    const expired = { ...operation(), expiresAt: new Date(Date.now() - 1).toISOString() }
    await identityOperationStore(client).reopen('op')
    vi.spyOn(client.identity, 'get').mockResolvedValue(expired)
    await identityOperationStore(client).reopen()
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByRole('heading', { name: identityEnglish.EXPIRED })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.verifyContinue })).toBeNull()
    expect(screen.queryByRole('button', { name: identityEnglish.cancelChange })).toBeNull()
    expect(screen.getByRole('button', { name: identityEnglish.done })).toBeTruthy()
  })
})
