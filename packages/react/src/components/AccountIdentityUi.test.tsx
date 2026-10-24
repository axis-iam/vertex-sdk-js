import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../core/oauth-client'
import { identityOperationStore } from '../core/identity-operation-store'
import { makeTestJwt } from '../test-utils'
import { IamUiProvider } from '../provider/IamUiProvider'
import { AccountProfilePanel } from './AccountProfilePanel'
import { ConnectedAccounts } from './ConnectedAccounts'
import { AccountCenter } from './AccountCenter'
import { SessionTransportError } from '@axis-iam/vertex'

let client: OAuthClient
vi.mock('../provider/IamProvider', () => ({ useIamContext: () => ({ client, user: client.state.getUser(), isAuthenticated: true, isLoaded: true }) }))
const response = (value: unknown) => new Response(JSON.stringify(value))
let items: { id: string; kind: string; displayValue: string; status: string; verificationState: string; isPrimary: boolean; managedBy: string | null }[]
let operationState: string
const op = () => ({ id: 'fixture-operation-ref', type: 'ADD', state: operationState, expiresAt: new Date(Date.now() + 600000).toISOString(),
  requiredProofs: [{ purpose: 'CURRENT_ACCOUNT', methods: ['PASSWORD'], strength: 'POLICY', satisfied: false }] })
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  sessionStorage.clear()
  client = new OAuthClient({ issuerUri: 'https://auth.test.com', clientId: 'c', redirectUri: 'https://app.test/callback' })
  client.tokenManager.store({ access_token: makeTestJwt(), expires_in: 3600, token_type: 'Bearer' }, 'OAUTH_AUTHORIZATION_CODE', null)
  vi.spyOn(client, 'discover').mockResolvedValue({ issuer: 'https://auth.test.com', authorization_endpoint: 'https://auth.test.com/authorize', token_endpoint: 'https://auth.test.com/token', userinfo_endpoint: 'https://auth.test.com/userinfo', jwks_uri: 'https://auth.test.com/jwks' })
  // jsdom does not implement the browser's modal/focus boundary; browser proof covers it separately.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } })
  items = [{ id: 'email', kind: 'EMAIL', displayValue: 'primary@example.invalid', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true, managedBy: null }]
  operationState = 'AWAITING_REAUTH'
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    const path = String(url)
    if (path.endsWith('/identifiers')) return response({ loginMethodVersion: 1, items })
    if (path.endsWith('/login-methods')) return response({ loginMethodVersion: 1, methods: [{ methodId: 'method-1', kind: 'PROVIDER', providerId: 'missing-provider', roles: ['FIRST_FACTOR'], status: 'AVAILABLE', capabilities: { unlink: false }, unavailableReasons: [] }] })
    if (path.endsWith('/linkable-identity-providers')) return response([])
    if (path.endsWith('/profile')) return response({ userId: 'u', displayName: 'Sample', email: 'stale@example.invalid', emailVerified: false, username: null, avatarUrl: null, status: 'ACTIVE' })
    if (path.endsWith('/security')) return response({ emailVerified: false, passwordCredentialPresent: true, mfaEnrolled: false, activeSessionCount: 1 })
    if (path.endsWith('/cancel')) { operationState = 'CANCELLED'; return response(op()) }
    if (path.includes('/identity-operations')) return response(op())
    throw new Error(`Unexpected fixture route ${path} ${init?.method}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); client.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function add() {
  render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
  await screen.findByText('primary@example.invalid')
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'new@example.invalid' } })
  fireEvent.submit(within(dialog).getByLabelText('Email').closest('form')!)
  await within(dialog).findByRole('heading', { name: 'Confirm account control' })
  return dialog
}
describe('account identity UI contract', () => {
  it('binds the profile email and badge to the same primary identifier, not legacy profile booleans', async () => {
    render(<IamUiProvider><AccountProfilePanel /></IamUiProvider>)
    expect(await screen.findByText('primary@example.invalid')).toBeTruthy()
    expect(screen.getByText('Email verified')).toBeTruthy()
    expect(screen.queryByText('Email not verified')).toBeNull()
    expect(screen.queryByText('stale@example.invalid')).toBeNull()
  })
  it.each(['UNKNOWN', 'none'])('does not label %s primary-email facts as unverified', async (state) => {
    if (state === 'none') items = []
    else items[0].verificationState = state
    render(<IamUiProvider><AccountProfilePanel /></IamUiProvider>)
    await screen.findByText('Sample')
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/identifiers'))).toBe(true))
    expect(screen.queryByText('Email not verified')).toBeNull()
    expect(screen.queryByText('Email verified')).toBeNull()
    if (state === 'UNKNOWN') expect(await screen.findByText('Verification status unavailable')).toBeTruthy()
  })
  it('shows authoritative managed source and explicit missing-provider information; has no manual operation ID form', async () => {
    items[0].managedBy = 'Directory SCIM'
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('primary@example.invalid')
    expect(screen.getByText(/Directory SCIM/)).toBeTruthy()
    expect(screen.getByText('Connection information unavailable')).toBeTruthy()
    expect(screen.queryByLabelText('Operation ID')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull()
  })
  it('continues the same operation after closing, clears secret inputs, and never sends cancel on close', async () => {
    const dialog = await add()
    fireEvent.change(within(dialog).getByLabelText('Confirm your current password'), { target: { value: 'fixture-secret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue later' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(identityOperationStore(client).getSnapshot().operation?.state).toBe('AWAITING_REAUTH')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Continue change' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/identity-operations/fixture-operation-ref'))).toBe(true))
    expect((screen.getByLabelText('Confirm your current password') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('fixture-secret')).toBeNull()
  })
  it('retains an uncertain cancellation and reconciles its exact ref with GET before allowing proofs', async () => {
    const dialog = await add()
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/cancel')) throw new TypeError('fixture response lost')
      return original(url, init)
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel this change' }))
    await screen.findByText('Cancellation is unconfirmed. Reopen this operation before continuing.')
    expect(identityOperationStore(client).getSnapshot().operation).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Verify and continue' }).matches(':disabled')).toBe(true)
    fireEvent.click(screen.getAllByRole('button', { name: 'Check latest status' })[0])
    await waitFor(() => expect(identityOperationStore(client).getSnapshot().cancelUnconfirmed).toBe(false))
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/identity-operations/fixture-operation-ref') && init?.method === 'GET')).toBe(true)
    await waitFor(() => expect(screen.queryByText('This change could not be completed. Refresh the operation and try again.')).toBeNull())
  })
  it('localizes Cookie transport stale-version failures and reloads authoritative account facts', async () => {
    const store = identityOperationStore(client)
    vi.spyOn(store, 'create').mockRejectedValue(new SessionTransportError('STALE_LOGIN_METHOD_VERSION', 409))
    render(<IamUiProvider><ConnectedAccounts /></IamUiProvider>)
    await screen.findByText('primary@example.invalid')
    const readsBefore = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/identifiers')).length
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.invalid' } })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    await screen.findByText('Login methods changed. Refresh them before starting again.')
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/identifiers')).length).toBeGreaterThan(readsBefore))
  })
  it('keeps AccountCenter a single protected dialog and closing it does not cancel a live operation', async () => {
    const close = vi.fn()
    render(<IamUiProvider><AccountCenter open onOpenChange={close} initialSection="methods" /></IamUiProvider>)
    await screen.findByText('primary@example.invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Add email' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.invalid' } })
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!)
    await screen.findByRole('heading', { name: 'Confirm account control' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await act(async () => {})
    expect(close).toHaveBeenCalledWith(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/cancel'))).toBe(false)
  })
})
