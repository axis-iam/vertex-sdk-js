import { managedIdentifiers } from '../core/identity-management-fixtures.test-support'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountPermissionSummary, AccountProfile, AccountSession, OIDCConfiguration } from '../core/types'
import { IamProvider } from '../provider/IamProvider'
import { makeTestJwt, makeTestUser, storeTestTokens, testProviderProps } from '../test-utils'
import { AccountPermissionsPanel } from './AccountPermissionsPanel'
import { AccountCenter } from './AccountCenter'
import { AccountProfilePanel } from './AccountProfilePanel'
import { AccountSessionsPanel } from './AccountSessionsPanel'
import { PasswordChangeForm } from './PasswordChangeForm'
import { accountCenterEnglish, resolveAccountCenterLocalization } from './accountCenterConfig'

const ISSUER = 'https://auth.test.com'
const mockOidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
}

const sessions: AccountSession[] = [
  {
    sessionId: 'sid-current',
    ipAddress: '127.0.0.1',
    userAgent: 'Chrome on macOS',
    deviceId: 'device-current',
    createdAt: '2026-07-07T08:00:00Z',
    lastSeenAt: '2026-07-07T08:10:00Z',
    current: true,
  },
  {
    sessionId: 'sid-other',
    ipAddress: '10.0.0.5',
    userAgent: 'Firefox on Linux',
    deviceId: 'device-other',
    createdAt: '2026-07-06T08:00:00Z',
    lastSeenAt: '2026-07-06T08:10:00Z',
    current: false,
  },
]

const permissionSummary: AccountPermissionSummary = {
  applicationId: 'app-1',
  organizationId: 'org-1',
  roles: ['admin'],
  permissions: ['orders:read', 'orders:write'],
}

const profile: AccountProfile = {
  userId: 'user-1',
  applicationId: 'app-1',
  globalIdentityId: null,
  email: 'alex@example.com',
  emailVerified: true,
  username: 'alex',
  displayName: 'Alex Morgan',
  avatarUrl: null,
  status: 'ACTIVE',
  createdAt: '2026-07-01T08:00:00Z',
  updatedAt: '2026-07-07T08:00:00Z',
  currentOrganization: null,
}

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

function jsonResponse(data?: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => data === undefined ? '' : JSON.stringify(data),
  }
}

function setupFetch(options: {
  emptyPermissions?: boolean
  emptySessions?: boolean
  failPasswordChange?: boolean
  failPermissionCheck?: boolean
  failSessionsOnce?: boolean
  longPermission?: boolean
} = {}) {
  let sessionRequests = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (init?.body ? 'POST' : 'GET')
    if (url.endsWith('/api/v1/auth/me')) {
      const user = makeTestUser({ metadata: { displayName: 'Alex Morgan' } })
      user.authenticationContext.applicationId = 'app-1'
      user.authenticationContext.organizationId = 'org-1'
      user.authenticationContext.organizationSlug = 'acme'
      user.authenticationContext.organizationRole = 'ADMIN'
      return jsonResponse(user)
    }
    if (url.endsWith('/api/v1/auth/me/identifiers')) return jsonResponse(managedIdentifiers([{ id: 'primary-email', kind: 'EMAIL', displayValue: 'alex@example.com', status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true }], 4))
    if (url.includes('/.well-known/openid-configuration')) {
      return jsonResponse(mockOidcConfig)
    }
    if (url.includes('/api/v1/auth/permissions') && !url.includes('/api/v1/auth/me/permissions')) {
      return jsonResponse({ permissions: ['orders:read'] })
    }
    if (url.endsWith('/api/v1/auth/password/change') && method === 'POST') {
      if (options.failPasswordChange) return jsonResponse({ message: 'Weak password' }, 400)
      return jsonResponse()
    }
    if (url.endsWith('/api/v1/auth/me/profile') && method === 'GET') {
      return jsonResponse(profile)
    }
    if (url.endsWith('/api/v1/auth/me/profile') && method === 'PATCH') {
      const body = JSON.parse(init?.body as string) as Partial<AccountProfile>
      return jsonResponse({ ...profile, ...body })
    }
    if (url.endsWith('/mfa/capabilities')) return jsonResponse({ loginMethodVersion: 4, totpEnroll: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null }, totpDisable: { allowed: false, proofRequirement: 'SESSION', proofOptions: [], reasonCode: 'METHOD_UNAVAILABLE' }, recoveryCodesGenerate: { allowed: true, proofRequirement: 'SESSION', proofOptions: [], reasonCode: null } })
    if (url.endsWith('/mfa/recovery-codes/remaining')) return jsonResponse({ remaining: 0 })
    if (url.endsWith('/api/v1/auth/me/security') && method === 'GET') {
      return jsonResponse({
        emailVerified: true,
        passwordCredentialPresent: true,
        mfaEnrolled: false,
        totpEnrolled: false,
        webAuthnEnrolled: false,
        activeSessionCount: 2,
      })
    }
    if (url.endsWith('/api/v1/auth/sessions') && method === 'GET') {
      sessionRequests += 1
      if (options.failSessionsOnce && sessionRequests === 1) return jsonResponse({ message: 'Sessions unavailable' }, 503)
      return jsonResponse(options.emptySessions ? [] : sessions)
    }
    if (url.endsWith('/api/v1/auth/sessions') && method === 'DELETE') {
      return jsonResponse()
    }
    if (url.endsWith('/api/v1/auth/sessions/sid-current') && method === 'DELETE') {
      return jsonResponse()
    }
    if (url.endsWith('/api/v1/auth/sessions/sid-other') && method === 'DELETE') {
      return jsonResponse()
    }
    if (url.endsWith('/api/v1/auth/logout') && method === 'POST') {
      return jsonResponse()
    }
    if (url.includes('/api/v1/auth/me/permissions:check') && method === 'POST') {
      if (options.failPermissionCheck) return jsonResponse({ message: 'Permission check failed' }, 500)
      const body = JSON.parse(init?.body as string) as { permission: string; organizationId?: string | null }
      return jsonResponse({
        applicationId: 'app-1',
        organizationId: body.organizationId ?? null,
        permission: body.permission,
        allowed: body.permission === 'orders:read',
        roles: ['admin'],
      })
    }
    if (url.includes('/api/v1/auth/me/permissions') && method === 'GET') {
      if (options.emptyPermissions) return jsonResponse({ ...permissionSummary, roles: [], permissions: [] })
      if (options.longPermission) {
        return jsonResponse({
          ...permissionSummary,
          permissions: ['accounting:quarterly-report-with-a-deliberately-long-unbroken-action-name-for-overflow-validation'],
        })
      }
      return jsonResponse(permissionSummary)
    }
    return jsonResponse({ message: 'Not found' }, 404)
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe('Account Center components', () => {
  beforeEach(() => {
    sessionStorage.clear()
    storeTestTokens(makeTestJwt(), ['orders:read'])
    setupFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders all four Account Center surfaces through React SSR', () => {
    const html = renderToString(createElement(
      IamProvider,
      { ...testProviderProps(), tokenStorage: 'memory' },
      createElement('div', null,
        createElement(AccountProfilePanel),
        createElement(PasswordChangeForm),
        createElement(AccountSessionsPanel),
        createElement(AccountPermissionsPanel),
      ),
    ))

    expect(html).toContain('aria-label="Account profile"')
    expect(html).toContain('aria-label="Password change"')
    expect(html).toContain('aria-label="Account sessions"')
    expect(html).toContain('aria-label="Account permissions"')
  })

  it('renders the controlled AccountCenter dialog through SSR without browser globals', () => {
    const html = renderToString(createElement(
      IamProvider,
      { ...testProviderProps(), tokenStorage: 'memory' },
      createElement(AccountCenter, { open: true, onOpenChange: () => undefined, initialSection: 'permissions', organizationId: 'org-ssr' }),
    ))

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('Account permissions')
    expect(html).not.toContain('Account profile')
  })

  it('merges partial localization once and renders explicit dark localization through SSR', () => {
    const localization = resolveAccountCenterLocalization(
      { title: '账户中心', passwordSection: '密码与安全', retry: undefined },
      { close: undefined },
    )
    expect(localization.title).toBe('账户中心')
    expect(localization.passwordSection).toBe('密码与安全')
    expect(localization.retry).toBe(accountCenterEnglish.retry)
    expect(localization.close).toBe(accountCenterEnglish.close)

    const html = renderToString(createElement(
      IamProvider,
      { ...testProviderProps(), tokenStorage: 'memory' },
      createElement(AccountCenter, {
        open: true,
        onOpenChange: () => undefined,
        initialSection: 'password',
        colorScheme: 'dark',
        localization: { title: '账户中心', passwordSection: '密码与安全', passwordAria: undefined },
        labels: { close: undefined },
      }),
    ))

    expect(html).toContain('data-color-scheme="dark"')
    expect(html).toContain('账户中心')
    expect(html).toContain('密码与安全')
    expect(html).toContain('aria-label="Password change"')
    expect(html).toContain('aria-label="Close account center"')
    expect(html).not.toContain('aria-label=""')
  })

  it('switches explicit and system themes without clearing form state, changing section, or refetching', async () => {
    let mediaChange: (() => void) | null = null
    let prefersDark = true
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return prefersDark },
      media: '(prefers-color-scheme: dark)',
      get onchange() { return mediaChange },
      set onchange(listener: (() => void) | null) { mediaChange = listener },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    })))
    const fetchMock = setupFetch()

    function ThemeHarness() {
      const [scheme, setScheme] = useState<'light' | 'dark' | 'system'>('light')
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setScheme('dark') }, 'Use dark theme'),
        createElement('button', { type: 'button', onClick: () => setScheme('system') }, 'Use system theme'),
        createElement(AccountCenter, { open: true, onOpenChange: () => undefined, initialSection: 'password', colorScheme: scheme }),
      )
    }

    renderWithProvider(createElement(ThemeHarness))
    const currentPassword = screen.getByLabelText('Current password') as HTMLInputElement
    fireEvent.change(currentPassword, { target: { value: 'typed-value' } })
    fireEvent.click(screen.getByText('Use dark theme'))
    expect(currentPassword.value).toBe('typed-value')
    expect(screen.getByRole('dialog').getAttribute('data-color-scheme')).toBe('dark')
    expect(screen.getByRole('button', { name: 'Password' }).getAttribute('aria-current')).toBe('page')

    fireEvent.click(screen.getByRole('button', { name: 'Permissions' }))
    await waitFor(() => expect(screen.getByText('orders:write')).toBeTruthy())
    const permission = screen.getByLabelText('Check permission') as HTMLInputElement
    fireEvent.change(permission, { target: { value: 'orders:read' } })
    const permissionGets = () => fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/v1/auth/me/permissions') && !String(call[0]).includes(':check')).length
    const beforeSwitch = permissionGets()
    fireEvent.click(screen.getByText('Use system theme'))
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-color-scheme')).toBe('dark'))
    expect(permission.value).toBe('orders:read')
    expect(screen.getByRole('button', { name: 'Permissions' }).getAttribute('aria-current')).toBe('page')
    expect(permissionGets()).toBe(beforeSwitch)

    prefersDark = false
    act(() => { mediaChange?.() })
    expect(screen.getByRole('dialog').getAttribute('data-color-scheme')).toBe('light')
    expect(permission.value).toBe('orders:read')
  })

  it('AccountCenter closes with Escape, restores trigger focus, navigates sections, and forwards panel props', async () => {
    const onOpenChange = vi.fn()
    const onChecked = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Open account center'
    document.body.append(trigger)
    trigger.focus()

    const { rerender } = renderWithProvider(createElement(AccountCenter, {
      open: true,
      onOpenChange,
      organizationId: 'org-1',
      permissionsProps: { onChecked },
    }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close account center' }))
    expect(screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByLabelText('Account profile').classList.contains('axis-ac-e')).toBe(true)
    expect(screen.queryByLabelText('Password change')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Permissions' }))
    expect(screen.getByRole('button', { name: 'Permissions' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(screen.getByLabelText('Account permissions')).toBeTruthy())
    expect(screen.getByLabelText('Account permissions').classList.contains('axis-ac-e')).toBe(true)
    fireEvent.click(screen.getByText('Check a permission'))
    fireEvent.change(screen.getByLabelText('Check permission'), { target: { value: 'orders:read' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    await waitFor(() => expect(onChecked).toHaveBeenCalledWith('orders:read', true))

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(createElement(IamProvider, testProviderProps(), createElement(AccountCenter, { open: false, onOpenChange })))
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('AccountCenter returns to the mobile menu state and honors initialSection on open', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return createElement(AccountCenter, { open, onOpenChange: setOpen, initialSection: 'sessions' })
    }
    const rendered = renderWithProvider(createElement(Harness))

    expect(screen.getByRole('button', { name: 'Sessions' }).getAttribute('aria-current')).toBe('page')
    await waitFor(() => expect(screen.getByText('Chrome on macOS')).toBeTruthy())
    const menuButton = rendered.container.querySelector<HTMLButtonElement>('.axis-ac-back')
    expect(menuButton).toBeTruthy()
    fireEvent.click(menuButton!)
    expect(screen.getByRole('dialog').className).toContain('axis-ac-menu')
    fireEvent.click(screen.getByRole('button', { name: 'Password' }))
    expect(screen.getByRole('dialog').className).not.toContain('axis-ac-menu')
    expect(screen.getByRole('button', { name: 'Password' }).getAttribute('aria-current')).toBe('page')
    rendered.unmount()
  })

  it('AccountCenter recovers hidden navigation focus after responsive changes and releases its listener', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const onOpenChange = vi.fn()
    const rendered = renderWithProvider(createElement(AccountCenter, { open: true, onOpenChange, initialSection: 'password' }))
    const navigation = screen.getByRole('button', { name: 'Password', exact: true })
    navigation.focus()
    fireEvent(window, new Event('resize'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close account center' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rendered.unmount()
    expect(document.activeElement).toBe(trigger)
    fireEvent(window, new Event('resize'))
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('AccountProfilePanel prioritizes identity and verification, supports shared composition, and updates profile fields', async () => {
    const fetchMock = setupFetch()
    const onUpdated = vi.fn()
    const { container } = renderWithProvider(createElement(AccountProfilePanel, {
      className: 'host-account-section',
      style: { padding: 30 },
      appearance: { primaryColor: '#164e63', backgroundColor: '#fefefe', mutedTextColor: '#475569' },
      onUpdated,
    }))

    await waitFor(() => expect(screen.getByText('Alex Morgan')).toBeTruthy())
    expect(screen.getByText('Email verified')).toBeTruthy()
    expect(screen.getByText('Security overview')).toBeTruthy()
    expect(container.querySelector('.host-account-section')).toBeTruthy()
    expect((screen.getByLabelText('Account profile') as HTMLElement).style.maxWidth).toBe('')
    expect((screen.getByLabelText('Account profile') as HTMLElement).style.padding).toBe('30px')
    expect((screen.getByLabelText('Account profile') as HTMLElement).style.background).toBe('rgb(254, 254, 254)')

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Alex Rivera' } })
    await act(async () => { fireEvent.click(screen.getByText('Save profile')) })

    await waitFor(() => expect(screen.getByText('Profile saved')).toBeTruthy())
    expect(onUpdated).toHaveBeenCalled()
    const request = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/me/profile') && call[1]?.method === 'PATCH')
    expect(JSON.parse(request?.[1]?.body as string)).toMatchObject({ displayName: 'Alex Rivera' })
  })

  it('PasswordChangeForm submits the password change payload and hides raw tokens', async () => {
    const fetchMock = setupFetch()
    const onChanged = vi.fn()
    const { container } = renderWithProvider(createElement(PasswordChangeForm, { onChanged }))
    await act(async () => {})

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-pass' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Change password'))
    })

    await waitFor(() => expect(screen.getByText('Password changed')).toBeTruthy())
    expect(onChanged).toHaveBeenCalled()
    const request = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/password/change'))
    expect(request?.[1]?.method).toBe('POST')
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      currentPassword: 'old-pass',
      newPassword: 'new-pass',
    })
    expect(container.textContent).not.toContain('rt-test')
  })

  it('PasswordChangeForm validates matching confirmation before calling the account API', async () => {
    const fetchMock = setupFetch()
    renderWithProvider(createElement(PasswordChangeForm))

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different-pass' } })
    fireEvent.click(screen.getByText('Change password'))

    expect(screen.getByRole('alert').textContent).toContain('New passwords do not match')
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/api/v1/auth/password/change'))).toBe(false)
  })

  it('PasswordChangeForm renders API errors without completing the success state', async () => {
    setupFetch({ failPasswordChange: true })
    renderWithProvider(createElement(PasswordChangeForm))

    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-pass' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Change password'))
    })

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy())
    expect(screen.queryByText('Password changed')).toBeNull()
  })

  it('AccountSessionsPanel renders sessions and revokes other sessions', async () => {
    const fetchMock = setupFetch()
    const onOtherSessionsRevoked = vi.fn()
    renderWithProvider(createElement(AccountSessionsPanel, { onOtherSessionsRevoked }))

    await waitFor(() => expect(screen.getByText('Chrome on macOS')).toBeTruthy())
    expect(screen.getByText('Firefox on Linux')).toBeTruthy()
    expect(screen.getByText('Current device')).toBeTruthy()
    expect(screen.getAllByText('Last active').length).toBe(2)

    await act(async () => {
      fireEvent.click(screen.getByText('Revoke other sessions'))
    })

    await waitFor(() => expect(screen.queryByText('Firefox on Linux')).toBeNull())
    expect(onOtherSessionsRevoked).toHaveBeenCalled()
    const request = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/sessions') && call[1]?.method === 'DELETE')
    expect(request).toBeTruthy()
  })

  it('AccountSessionsPanel renders an empty state and retries a failed list request', async () => {
    setupFetch({ emptySessions: true })
    const emptyRender = renderWithProvider(createElement(AccountSessionsPanel, { showLogout: false }))
    await waitFor(() => expect(screen.getByText('No active sessions')).toBeTruthy())
    emptyRender.unmount()

    const fetchMock = setupFetch({ failSessionsOnce: true })
    renderWithProvider(createElement(AccountSessionsPanel, { showLogout: false }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(accountCenterEnglish.errorMessage('')))
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(screen.getByText('Chrome on macOS')).toBeTruthy())
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/api/v1/auth/sessions') && call[1]?.method === 'GET').length).toBe(2)
  })

  it('AccountSessionsPanel can call account logout without rendering stored tokens', async () => {
    const fetchMock = setupFetch()
    const onLoggedOut = vi.fn()
    const { container } = renderWithProvider(createElement(AccountSessionsPanel, { onLoggedOut }))

    await waitFor(() => expect(screen.getByText('Chrome on macOS')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('Log out'))
    })

    await waitFor(() => expect(onLoggedOut).toHaveBeenCalled())
    const request = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/v1/auth/logout'))
    expect(request?.[1]?.method).toBe('POST')
    expect(request?.[1]?.body).toBeUndefined()
    expect(new Headers(request?.[1]?.headers).get('Authorization')).toMatch(/^Bearer /)
    expect(container.textContent).not.toContain('rt-test')
  })

  it('AccountPermissionsPanel renders summary and checks current-user permissions', async () => {
    const fetchMock = setupFetch()
    const onChecked = vi.fn()
    renderWithProvider(createElement(AccountPermissionsPanel, { organizationId: 'org-1', onChecked }))

    await waitFor(() => expect(screen.getByText('orders:write')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Check permission'), { target: { value: 'orders:read' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Check'))
    })

    await waitFor(() => expect(screen.getByText('orders:read: Allowed')).toBeTruthy())
    expect(onChecked).toHaveBeenCalledWith('orders:read', true)
    const request = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/v1/auth/me/permissions:check'))
    expect(JSON.parse(request?.[1]?.body as string)).toEqual({
      permission: 'orders:read',
      organizationId: 'org-1',
    })
  })

  it('AccountPermissionsPanel renders permission check errors without success state', async () => {
    setupFetch({ failPermissionCheck: true })
    renderWithProvider(createElement(AccountPermissionsPanel, { organizationId: 'org-1' }))

    await waitFor(() => expect(screen.getByText('orders:write')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Check permission'), { target: { value: 'orders:read' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Check'))
    })

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBeTruthy())
    expect(screen.queryByText('orders:read: Allowed')).toBeNull()
  })

  it('AccountPermissionsPanel handles empty summaries and long permission strings', async () => {
    setupFetch({ emptyPermissions: true })
    const emptyRender = renderWithProvider(createElement(AccountPermissionsPanel))
    await waitFor(() => expect(screen.getByText('No roles assigned.')).toBeTruthy())
    expect(screen.getByText('No permissions granted.')).toBeTruthy()
    emptyRender.unmount()

    setupFetch({ longPermission: true })
    const { container } = renderWithProvider(createElement(AccountPermissionsPanel))
    await waitFor(() => expect(screen.getByText(/deliberately-long-unbroken/)).toBeTruthy())
    expect(container.querySelector('.axis-iam-permission-list code')).toBeTruthy()
  })

  it('AccountSessionsPanel fails closed when authentication is missing', async () => {
    sessionStorage.clear()
    const fetchMock = setupFetch()
    renderWithProvider(createElement(AccountSessionsPanel))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(accountCenterEnglish.errorMessage('')))
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/api/v1/auth/sessions'))).toBe(false)
  })
})
