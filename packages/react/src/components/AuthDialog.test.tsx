import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement, StrictMode, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IamProvider } from '../provider/IamProvider'
import { testProviderProps } from '../test-utils'
import { AuthDialog, SignInButton, SignUpButton } from './AuthDialog'

const oidc = {
  issuer: 'https://auth.test.com', authorization_endpoint: 'https://auth.test.com/authorize', token_endpoint: 'https://auth.test.com/token', userinfo_endpoint: 'https://auth.test.com/userinfo', jwks_uri: 'https://auth.test.com/jwks',
}

function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

function setupFetch({ signupMode = 'OPEN' }: { signupMode?: 'OPEN' | 'INVITE_REQUIRED' } = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.includes('openid-configuration')) return response(oidc)
    if (url.includes('/auth-methods')) return response({ clientId: 'test-app', passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: false, smsOtpEnabled: false, socialLoginEnabled: false, signupEnabled: true, selfRegistrationEnabled: true, emailVerificationMode: 'OFF', idpAutoProvisioningEnabled: false, loginInitiationUri: null, postVerificationRedirectUri: null, methods: [{ type: 'PASSWORD', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null }], idpProviders: [], resend: { emailVerificationCooldownSeconds: 60 } })
    if (url.includes('/auth-policy')) return response({ passwordLoginEnabled: true, passwordlessEnabled: false, minPasswordLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecialChar: false, breachedPasswordCheck: false, totpEnabled: false, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [], deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false, emailVerificationMode: 'OFF', idpAutoProvisioningEnabled: false, signupMode, allowedRegistrationGrantTypes: ['ACCESS_CODE'] })
    if (url.includes('/branding')) return response({}, 404)
    if (url.includes('/permissions')) return response({ permissions: [] })
    return response({ message: 'not found' }, 404)
  }) as typeof fetch
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

function renderWithProvider(ui: React.ReactElement, props = {}) {
  return render(createElement(IamProvider, { ...testProviderProps(), ...props }, ui))
}

describe('AuthDialog', () => {
  beforeEach(() => { setupFetch(); sessionStorage.clear() })
  afterEach(() => vi.restoreAllMocks())

  it('restores an external controlled opener after backdrop close in StrictMode', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open authentication'),
        createElement(AuthDialog, { open, onOpenChange: setOpen }),
      )
    }

    renderWithProvider(createElement(StrictMode, null, createElement(Harness)))
    const opener = screen.getByRole('button', { name: 'Open authentication' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    const defaultAllowed = fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    if (defaultAllowed) {
      document.body.tabIndex = -1
      document.body.focus()
      document.body.removeAttribute('tabindex')
    }
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('restores an external controlled opener after Escape in StrictMode', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open authentication'),
        createElement(AuthDialog, { open, onOpenChange: setOpen }),
      )
    }

    renderWithProvider(createElement(StrictMode, null, createElement(Harness)))
    const opener = screen.getByRole('button', { name: 'Open authentication' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('restores an external controlled opener after close-button click', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open authentication'),
        createElement(AuthDialog, { open, onOpenChange: setOpen }),
      )
    }

    renderWithProvider(createElement(Harness))
    const opener = screen.getByRole('button', { name: 'Open authentication' })
    opener.focus()
    fireEvent.click(opener)
    const close = await screen.findByRole('button', { name: 'Close authentication dialog' })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('closes safely without focusing a disconnected opener', async () => {
    let disconnectOpener = () => undefined
    function Harness() {
      const [open, setOpen] = useState(false)
      const [showOpener, setShowOpener] = useState(true)
      disconnectOpener = () => setShowOpener(false)
      return createElement('div', null,
        showOpener && createElement('button', { type: 'button', onClick: () => setOpen(true) }, 'Open authentication'),
        createElement(AuthDialog, { open, onOpenChange: setOpen }),
      )
    }

    renderWithProvider(createElement(Harness))
    const opener = screen.getByRole('button', { name: 'Open authentication' })
    const focus = vi.spyOn(opener, 'focus')
    opener.focus()
    fireEvent.click(opener)
    const close = await screen.findByRole('button', { name: 'Close authentication dialog' })
    act(disconnectOpener)
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not restore unrelated focus when initially rendered open', async () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return createElement(AuthDialog, { open, onOpenChange: setOpen })
    }

    render(createElement('button', { type: 'button' }, 'Unrelated action'))
    const unrelated = screen.getByRole('button', { name: 'Unrelated action' })
    unrelated.focus()
    renderWithProvider(createElement(StrictMode, null, createElement(Harness)))
    const close = await screen.findByRole('button', { name: 'Close authentication dialog' })
    expect(document.activeElement).toBe(close)
    fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).not.toBe(unrelated)
  })

  it('renders the controlled dialog through SSR without browser globals', () => {
    const html = renderToString(createElement(IamProvider, testProviderProps(), createElement(AuthDialog, { open: true, onOpenChange: () => undefined, initialView: 'sign-up', signUpProps: { registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'short-lived-proof' } } })))
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Create account')
    expect(html).not.toContain('short-lived-proof')
  })

  it('opens only through the controlled callback and restores focus after Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement(AuthDialog, { open, onOpenChange: setOpen }, createElement(SignInButton, { 'data-testid': 'trigger' }))
    }
    renderWithProvider(createElement(Harness))
    const trigger = screen.getByTestId('trigger')
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close authentication dialog' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  it('uses the nested SignUpButton as an explicit sign-up trigger', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement(AuthDialog, { open, onOpenChange: setOpen }, createElement(SignUpButton, null))
    }
    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
  })

  it('uses the latest controlled initial view when the host opens in the same event', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const [initialView, setInitialView] = useState<'sign-in' | 'sign-up'>('sign-in')
      return createElement('div', null,
        createElement(SignUpButton, {
          onClick: () => {
            setInitialView('sign-up')
            setOpen(true)
          },
        }),
        createElement('button', {
          type: 'button',
          onClick: () => {
            setInitialView('sign-in')
            setOpen(true)
          },
        }, 'Open sign in'),
        createElement(AuthDialog, { open, onOpenChange: setOpen, initialView }),
      )
    }

    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy()
    expect(screen.queryByPlaceholderText('you@example.com or +86 13800138000')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Close authentication dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Open sign in' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign in' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
  })

  it('normalizes a disabled-signup initial view to the mounted sign-in pane', async () => {
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange: () => undefined, allowSignUp: false, initialView: 'sign-up' }))
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy())
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('normalizes a disabled-signup SignUpButton trigger to the mounted sign-in pane', async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement(AuthDialog, { open, onOpenChange: setOpen, allowSignUp: false }, createElement(SignUpButton, { 'data-testid': 'sign-up-trigger' }))
    }
    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByTestId('sign-up-trigger'))
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy())
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })

  it('unmounts a visited signup pane when the host disables signup', async () => {
    const fetchMock = setupFetch()
    function Harness() {
      const [allowSignUp, setAllowSignUp] = useState(true)
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setAllowSignUp(false) }, 'Disable sign up'),
        createElement('button', { type: 'button', onClick: () => setAllowSignUp(true) }, 'Enable sign up'),
        createElement(AuthDialog, { open: true, onOpenChange: () => undefined, allowSignUp }),
      )
    }

    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    const initialSignUpEmail = await screen.findByPlaceholderText('you@example.com')
    fireEvent.change(initialSignUpEmail, { target: { value: 'discarded@example.com' } })
    const policyRequests = fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy')).length

    fireEvent.click(screen.getByRole('button', { name: 'Disable sign up' }))
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy())
    expect(screen.queryByRole('tab', { name: 'Sign up' })).toBeNull()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-up"]')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-in"]')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy'))).toHaveLength(policyRequests)

    fireEvent.click(screen.getByRole('button', { name: 'Enable sign up' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' })).toBeTruthy())
    expect(document.querySelector('[data-auth-view="sign-up"]')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    const remountedSignUpEmail = await screen.findByPlaceholderText('you@example.com') as HTMLInputElement
    expect(remountedSignUpEmail.value).toBe('')
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy'))).toHaveLength(policyRequests)
  })

  it('preserves registered form values and the embedded sign-in method step across view round trips', async () => {
    setupFetch({ signupMode: 'INVITE_REQUIRED' })
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange: () => undefined }))

    const identifier = await screen.findByPlaceholderText('you@example.com or +86 13800138000')
    fireEvent.change(identifier, { target: { value: 'sign-in@example.com' } })
    fireEvent.submit(identifier.closest('form')!)
    await waitFor(() => expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    const email = await screen.findByPlaceholderText('you@example.com')
    const accessCode = screen.getByPlaceholderText('Enter access code')
    fireEvent.change(email, { target: { value: 'sign-up@example.com' } })
    fireEvent.change(accessCode, { target: { value: 'ACCESS-1234' } })
    fireEvent.change(screen.getByPlaceholderText('At least 8 characters'), { target: { value: 'dialog-password' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), { target: { value: 'dialog-password' } })

    fireEvent.click(screen.getByRole('tab', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByPlaceholderText('Enter your password')).toBeTruthy())
    expect(screen.getByText('Signing in as sign-in@example.com')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    await waitFor(() => expect((screen.getByPlaceholderText('you@example.com') as HTMLInputElement).value).toBe('sign-up@example.com'))
    expect((screen.getByPlaceholderText('Enter access code') as HTMLInputElement).value).toBe('ACCESS-1234')
    expect((screen.getByPlaceholderText('At least 8 characters') as HTMLInputElement).value).toBe('dialog-password')
    expect((screen.getByPlaceholderText('Confirm your password') as HTMLInputElement).value).toBe('dialog-password')
  })

  it('selects the next trigger view before open and does not remount the hidden signup engine after close', async () => {
    const fetchMock = setupFetch()
    function Harness() {
      const [open, setOpen] = useState(false)
      const [nextTrigger, setNextTrigger] = useState<'sign-in' | 'sign-up'>('sign-up')
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setNextTrigger('sign-in') }, 'Use sign in trigger'),
        createElement(AuthDialog, { open, onOpenChange: setOpen }, nextTrigger === 'sign-up'
          ? createElement(SignUpButton, { 'data-testid': 'entry' })
          : createElement(SignInButton, { 'data-testid': 'entry' })),
      )
    }
    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByTestId('entry'))
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy())
    const policyCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy')).length
    fireEvent.click(screen.getByRole('button', { name: 'Close authentication dialog' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Use sign in trigger' }))
    fireEvent.click(screen.getByTestId('entry'))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign in' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy()
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy'))).toHaveLength(policyCalls)
  })

  it('uses one dialog title and a compact auth-engine presentation instead of a nested auth card', async () => {
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange: () => undefined }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com or +86 13800138000')).toBeTruthy())
    expect(dialog.querySelectorAll('h2')).toHaveLength(1)
    expect(dialog.querySelectorAll('[data-auth-dialog-panels] h2')).toHaveLength(0)
    const activeEngine = dialog.querySelector<HTMLElement>('[data-auth-dialog-panels] > div:not([hidden]) > div')
    expect(activeEngine?.style.backgroundColor).toBe('transparent')
    expect(activeEngine?.style.padding).toBe('0px')
  })

  it('switches localized views, traps Tab, and keeps the sign-up grant inside the composed flow', async () => {
    const onOpenChange = vi.fn()
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange, signUpProps: { registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'short-lived-proof' } } }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    await waitFor(() => expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy())
    expect(screen.queryByText('short-lived-proof')).toBeNull()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sign up' }), { key: 'ArrowLeft' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign in' }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sign in' }), { key: 'End' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected')).toBe('true'))
    const close = screen.getByRole('button', { name: 'Close authentication dialog' })
    close.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!, { target: screen.getByRole('dialog').parentElement! })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('inherits locale, host labels, and theme changes without closing or remounting the active form', async () => {
    function Harness() {
      const [scheme, setScheme] = useState<'light' | 'dark' | 'system'>('light')
      return createElement('div', null,
        createElement('button', { type: 'button', onClick: () => setScheme('dark') }, 'theme'),
        createElement(IamProvider, { ...testProviderProps(), locale: 'zh-CN', colorScheme: scheme }, createElement(AuthDialog, { open: true, onOpenChange: () => undefined }, createElement(SignUpButton, null, 'Host label'))),
      )
    }
    render(createElement(Harness))
    await waitFor(() => expect(screen.getByRole('tab', { name: '注册' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: '注册' }))
    const email = await screen.findByPlaceholderText('you@example.com')
    fireEvent.change(email, { target: { value: 'kept@example.com' } })
    fireEvent.click(screen.getByText('theme'))
    await waitFor(() => expect(screen.getByRole('dialog').getAttribute('data-color-scheme')).toBe('dark'))
    expect((screen.getByPlaceholderText('you@example.com') as HTMLInputElement).value).toBe('kept@example.com')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Host label')).toBeTruthy()
  })

  it('uses the existing redirect engine when requested and supports explicit non-sign-up mode', async () => {
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange: () => undefined, mode: 'redirect', allowSignUp: false }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('does not render duplicate tabs for redirect mode without a registration grant', async () => {
    renderWithProvider(createElement(AuthDialog, { open: true, onOpenChange: () => undefined, mode: 'redirect', allowSignUp: true }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(1)
  })

  it('normalizes a redirect SignUpButton to hosted sign in without mounting signup policy', async () => {
    const fetchMock = setupFetch()
    function Harness() {
      const [open, setOpen] = useState(false)
      return createElement(AuthDialog, { open, onOpenChange: setOpen, mode: 'redirect' }, createElement(SignUpButton, { 'data-testid': 'hosted-entry' }))
    }
    renderWithProvider(createElement(Harness))
    fireEvent.click(screen.getByTestId('hosted-entry'))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.queryByRole('tab')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-up"]')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-in"]')).toBeTruthy()
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/auth-policy'))).toHaveLength(0)
  })

  it('keeps a distinct redirect signup pane only for a non-blank supported grant', async () => {
    const proof = 'short-lived-proof'
    const { rerender } = renderWithProvider(createElement(AuthDialog, {
      open: true,
      onOpenChange: () => undefined,
      mode: 'redirect',
      initialView: 'sign-up',
      signUpProps: { registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: '  ' } },
    }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-up"]')).toBeNull()

    rerender(createElement(IamProvider, testProviderProps(), createElement(AuthDialog, {
      open: true,
      onOpenChange: () => undefined,
      mode: 'redirect',
      initialView: 'sign-up',
      signUpProps: { registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: proof } },
    })))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sign up' })).toBeTruthy())
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }))
    expect(screen.getByRole('tab', { name: 'Sign up' }).getAttribute('aria-selected')).toBe('true')
    expect(document.documentElement.textContent).not.toContain(proof)
  })

  it('normalizes an organization invitation to hosted sign in because hosted signup rejects it', () => {
    const proof = 'organization-invitation-proof'
    renderWithProvider(createElement(AuthDialog, {
      open: true,
      onOpenChange: () => undefined,
      mode: 'redirect',
      initialView: 'sign-up',
      signUpProps: { registrationGrant: { type: 'ORG_INVITATION', organizationInvitationToken: proof } },
    }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-up"]')).toBeNull()
    expect(document.querySelector('[data-auth-view="sign-in"]')).toBeTruthy()
    expect(document.documentElement.textContent).not.toContain(proof)
  })
})
