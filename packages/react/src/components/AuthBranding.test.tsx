import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import type { IamProviderProps } from '../provider/IamProvider'
import { testProviderProps } from '../test-utils'
import { flowCapabilities, flowPolicy } from '../core/auth-flow-fixtures.test-support'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'
import { AuthDialog } from './AuthDialog'
import type { BrandingConfig } from './useBranding'
const brand: BrandingConfig = { showLogo: true, logoUrl: 'https://assets.test/logo.svg', primaryColor: '#166534', secondaryColor: '#075985', backgroundColor: '#f0fdf4', textColor: '#172d20', welcomeTitle: 'Author title', welcomeSubtitle: 'Author subtitle', loginButtonText: 'Enter product', signupButtonText: 'Join product', footerText: 'Author footer' }
function setup(patch: Partial<BrandingConfig> = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); let body: unknown
    if (url.pathname.includes('openid-configuration')) body = { issuer: url.origin, authorization_endpoint: `${url.origin}/authorize`, token_endpoint: `${url.origin}/token`, userinfo_endpoint: `${url.origin}/userinfo`, jwks_uri: `${url.origin}/jwks` }
    else if (url.pathname.endsWith('/branding')) body = { ...brand, welcomeTitle: url.searchParams.get('intent') === 'signup' ? 'Signup authored' : brand.welcomeTitle, ...patch }
    else if (url.pathname.endsWith('/auth-policy')) body = flowPolicy
    else if (url.pathname.endsWith('/auth-methods')) body = { ...flowCapabilities, methods: flowCapabilities.methods.filter(m => m.type === 'PASSWORD'), idpProviders: [] }
    else return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }); vi.stubGlobal('fetch', fetch); return fetch
}
function mount(children: ReactNode, props: Partial<IamProviderProps> = {}) {
  return render(<IamProvider {...testProviderProps()} {...props}>{children}</IamProvider>)
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it.each(['embedded', 'signup', 'dialog'] as const)('%s uses the same scoped logo/copy/footer and intent-specific primary actions', async (mode) => {
  const fetch = setup()
  const view = mount(mode === 'embedded' ? <SignIn mode="embedded" /> : mode === 'signup' ? <SignUp mode="embedded" /> : <AuthDialog open onOpenChange={() => {}} />)
  await screen.findByText(mode === 'signup' ? 'Signup authored' : 'Author title')
  expect(screen.getByAltText('Application logo').getAttribute('src')).toBe(brand.logoUrl)
  expect(screen.getByText('Author subtitle')).toBeTruthy(); expect(screen.getByText('Author footer')).toBeTruthy()
  const shell = view.container.querySelector<HTMLElement>('[data-axis-branded-auth]')!
  expect(shell.style.backgroundColor).toBe('rgb(240, 253, 244)')
  if (mode !== 'signup') {
    fireEvent.change(screen.getByLabelText('Email or phone number'), { target: { value: 'brand@example.test' } })
    fireEvent.submit(screen.getByLabelText('Email or phone number').closest('form')!)
    await screen.findByRole('button', { name: 'Enter product' })
    fireEvent.click(screen.getByRole('button', { name: /Sign up$/ }))
    await screen.findByText('Signup authored')
  }
  expect(screen.getByRole('button', { name: 'Join product' }).style.backgroundColor).toBe('rgb(22, 101, 52)')
  expect(fetch.mock.calls.some(([url]) => String(url).includes('intent=signup'))).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /Sign in$/ }))
  await screen.findByText('Author title')
})
it('honors false logo and preserves explicitly empty copy and English equal to defaults in Chinese UI', async () => {
  setup({ showLogo: false, welcomeTitle: 'Welcome back', welcomeSubtitle: '', footerText: '', signupButtonText: '' })
  const view = mount(<SignUp mode="embedded" />, { locale: 'zh-CN' })
  await screen.findByText('Welcome back')
  expect(screen.queryByRole('img')).toBeNull(); expect(screen.queryByText('Author subtitle')).toBeNull()
  expect(view.container.querySelector('button[type="submit"]')?.textContent).toBe('')
})
it('keeps dark brand accents with readable dark surfaces; explicit provider dark and component tokens win', async () => {
  setup()
  const view = mount(<SignUp mode="embedded" />, { colorScheme: 'dark' })
  const button = await screen.findByRole('button', { name: 'Join product' })
  expect(button.style.backgroundColor).toBe('rgb(22, 101, 52)')
  const shell = () => view.container.querySelector<HTMLElement>('[data-axis-branded-auth]')!
  expect(shell().style.backgroundColor).toBe('rgb(16, 20, 23)')
  expect(shell().style.color).toBe('rgb(244, 247, 248)')
  expect(screen.getByRole('button', { name: /Sign in$/ }).style.color).toBe('rgb(56, 189, 248)')
  view.rerender(<IamProvider {...testProviderProps()} colorScheme="dark" appearance={{ primaryColor: '#123456' }} darkAppearance={{ primaryColor: '#654321', backgroundColor: '#202020' }}><SignUp mode="embedded" appearance={{ primaryColor: '#345678' }} /></IamProvider>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Join product' }).style.backgroundColor).toBe('rgb(52, 86, 120)'))
  expect(shell().style.backgroundColor).toBe('rgb(32, 32, 32)')
})
it('shows failed branding as an observable retry state while keeping authentication usable', async () => {
  const fetch = setup(); const implementation = fetch.getMockImplementation()!
  fetch.mockImplementation(async (...args) => String(args[0]).includes('/branding') ? { ok: false, status: 503, json: async () => ({ message: 'private backend detail' }) } : implementation(...args))
  mount(<SignIn mode="embedded" />)
  await screen.findByRole('button', { name: 'Retry branding' })
  expect(screen.queryByText('Loading application branding…')).toBeNull()
  expect(screen.getByLabelText('Email or phone number')).toBeTruthy()
  expect(screen.queryByText('private backend detail')).toBeNull()
  fetch.mockImplementation(implementation)
  fireEvent.click(screen.getByRole('button', { name: 'Retry branding' }))
  await screen.findByText('Author title')
})
it('gives an empty authored dialog title a localized accessible name without replacing the authored copy', async () => {
  setup({ welcomeTitle: '' })
  mount(<AuthDialog open onOpenChange={() => {}} />)
  const dialog = await screen.findByRole('dialog', { name: 'Sign in' })
  await waitFor(() => expect(dialog.getAttribute('aria-label')).toBe('Sign in'))
  expect(dialog.querySelector('h2')?.textContent).toBe('')
})
it('lets provider then component light tokens override the actual server brand', async () => {
  setup()
  const view = mount(<SignUp mode="embedded" appearance={{ primaryColor: '#345678' }} />, { appearance: { primaryColor: '#654321', backgroundColor: '#fff8ef', textColor: '#222222' } })
  await screen.findByRole('button', { name: 'Join product' })
  const button = () => screen.getByRole('button', { name: 'Join product' })
  expect(button().style.backgroundColor).toBe('rgb(52, 86, 120)')
  expect(view.container.querySelector<HTMLElement>('[data-axis-branded-auth]')?.style.backgroundColor).toBe('rgb(255, 248, 239)')
  view.rerender(<IamProvider {...testProviderProps()} appearance={{ primaryColor: '#654321' }}><SignUp mode="embedded" /></IamProvider>)
  expect(button().style.backgroundColor).toBe('rgb(101, 67, 33)')
})
