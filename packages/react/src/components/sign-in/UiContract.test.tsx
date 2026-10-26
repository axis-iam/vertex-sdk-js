import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthFlowActions, AuthFlowState } from '../../core/auth-flow-types'
import { flowCapabilities, flowPolicy } from '../../core/auth-flow-fixtures.test-support'
import { validateFlowMetadata } from '../../core/auth-flow-client'
import { IamUiProvider } from '../../provider/IamUiProvider'
import { AuthFlowForm } from './AuthFlowForm'
import { resolveAppearance } from '../styles'

const common = {
  intent: 'sign-in', step: 'identifier', capabilities: flowCapabilities, policy: flowPolicy,
  providers: [], pending: null, error: null, retryAfterSeconds: 0, verificationResendDeadline: null,
  registrationCancelUnconfirmed: false, verificationEmail: null, transactionExpiresAt: null,
  challengeExpiresAt: null, cancellationUnconfirmed: false, completionPending: false,
} satisfies AuthFlowState
function setup(patch: Partial<AuthFlowState> = {}, locale: 'en' | 'zh-CN' = 'en') {
  const actions = Object.fromEntries([
    'retryOptions', 'setIntent', 'continueWithIdentifier', 'selectMethod', 'back', 'cancel', 'reset',
    'submitPassword', 'sendCode', 'verifyCode', 'sendMagicLink', 'verifyMfa', 'signUp', 'completeRegistration',
    'cancelRegistration', 'resumeRegistration', 'resendVerification', 'startProvider', 'resumeProviderCallback',
  ].map((key) => [key, vi.fn().mockResolvedValue(undefined)])) as unknown as AuthFlowActions
  let state: AuthFlowState = { ...common, ...patch } as AuthFlowState
  const view = () => <IamUiProvider locale={locale}><AuthFlowForm appearance={resolveAppearance({ primaryColor: '#164e63' })} flow={{ state, actions }} /></IamUiProvider>
  const result = render(view())
  return { ...result, actions, update(next: Partial<AuthFlowState>) { state = { ...state, ...next } as AuthFlowState; result.rerender(view()) } }
}
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('approved SDK UI contracts', () => {
  it('uses the explicit default, discloses alternatives, clears and focuses the typed field, and handles Escape', () => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    expect(screen.getByRole('combobox', { name: 'Country / region' })).toBeTruthy()
    const phone = screen.getByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '+12025550123' } })
    expect((screen.getByRole('combobox', { name: 'Country / region' }) as HTMLSelectElement).value).toBe('US')
    const trigger = screen.getByRole('button', { name: 'Use another sign-in method' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(screen.getByRole('button', { name: 'Sign in with email' }), { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with username' }))
    const username = screen.getByLabelText('Username') as HTMLInputElement
    expect(username.value).toBe('')
    expect(document.activeElement).toBe(username)
    fireEvent.change(username, { target: { value: 'sample' } })
    fireEvent.submit(username.closest('form')!)
    expect(h.actions.continueWithIdentifier).toHaveBeenCalledWith({ kind: 'USERNAME', value: 'sample' })
  })
  it('normalizes a selected local phone to E.164 without sending a region', () => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'CN' } })
    const phone = screen.getByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '13800138000' } })
    fireEvent.submit(phone.closest('form')!)
    expect(h.actions.continueWithIdentifier).toHaveBeenCalledWith({ kind: 'PHONE', value: '+8613800138000' })
  })
  it('rejects an incomplete phone without calling the flow action', () => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Country / region' }), { target: { value: 'CN' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '123' } })
    fireEvent.submit(screen.getByLabelText('Phone number').closest('form')!)
    expect(h.actions.continueWithIdentifier).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')[0].textContent).toContain('valid phone number')
  })
  it.each(['+8613800138000', '+86 13800138000'])('synchronizes international paste %s without a locale-selected default', value => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } }, 'zh-CN')
    const country = screen.getByLabelText('国家/地区') as HTMLSelectElement
    const phone = screen.getByLabelText('手机号') as HTMLInputElement
    expect(country.value).toBe('')
    fireEvent.change(phone, { target: { value } })
    expect(country.value).toBe('CN')
    expect(phone.value).toBe('13800138000')
    fireEvent.submit(phone.closest('form')!)
    expect(h.actions.continueWithIdentifier).toHaveBeenCalledWith({ kind: 'PHONE', value: '+8613800138000' })
  })
  it.each(['', '13800138000', '+18005550123', '+99912345', '+8613800138000abc'])('never calls the flow with a missing country or invalid international input %j', value => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    const phone = screen.getByLabelText('Phone number')
    fireEvent.change(phone, { target: { value } })
    fireEvent.submit(phone.closest('form')!)
    expect(h.actions.continueWithIdentifier).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
  it('clears the previous country for an unresolved international edit and clears drafts on country change', () => {
    setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    const country = screen.getByLabelText('Country / region') as HTMLSelectElement
    const phone = screen.getByLabelText('Phone number') as HTMLInputElement
    fireEvent.change(phone, { target: { value: '+12025550123' } })
    expect(country.value).toBe('US')
    fireEvent.change(phone, { target: { value: '+18005550123' } })
    expect(country.value).toBe('')
    fireEvent.submit(phone.closest('form')!)
    fireEvent.change(country, { target: { value: 'CN' } })
    expect(phone.value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(phone)
  })
  it.each(['email', 'username'])('clears phone state across a round trip through %s', alternative => {
    const h = setup({ capabilities: { ...flowCapabilities, defaultIdentifierKind: 'PHONE' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+8613800138000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use another sign-in method' }))
    fireEvent.click(screen.getByRole('button', { name: `Sign in with ${alternative}` }))
    expect(screen.queryByLabelText('Country / region')).toBeNull()
    const input = screen.getByLabelText(alternative === 'email' ? 'Email' : 'Username') as HTMLInputElement
    expect(input.value).toBe('')
    fireEvent.change(input, { target: { value: alternative === 'email' ? 'member@example.invalid' : 'member' } })
    fireEvent.submit(input.closest('form')!)
    expect(h.actions.continueWithIdentifier).toHaveBeenCalledWith({
      kind: alternative === 'email' ? 'EMAIL' : 'USERNAME', value: input.value,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use another sign-in method' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with phone number' }))
    expect((screen.getByLabelText('Country / region') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('does not invent a field or switcher for Provider-only or a single supported kind', () => {
    const h = setup({ capabilities: { ...flowCapabilities, identifierMethods: [{ kind: 'PHONE', methods: ['PASSWORD'] }], defaultIdentifierKind: 'PHONE', smsOtpEnabled: false } })
    expect(screen.getByLabelText('Phone number')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /another sign-in|Sign in with/ })).toBeNull()
    h.update({ capabilities: { ...flowCapabilities, identifierMethods: [], defaultIdentifierKind: null }, providers: flowCapabilities.idpProviders })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with Test provider' })).toBeTruthy()
  })
  it.each([
    undefined,
    [{ kind: 'PHONE', methods: ['EMAIL_OTP'] }],
    [{ kind: 'USERNAME', methods: ['SMS_OTP'] }],
    [{ kind: 'EMAIL', methods: [] }],
    [{ kind: 'EMAIL', methods: ['PASSWORD'] }, { kind: 'EMAIL', methods: ['PASSWORD'] }],
  ])('rejects missing or malformed capability sets %j', (identifierMethods) => {
    expect(() => validateFlowMetadata({ ...flowCapabilities, identifierMethods } as typeof flowCapabilities, flowPolicy)).toThrow()
  })
  it('rejects an absent or unsupported default rather than choosing the first kind', () => {
    for (const defaultIdentifierKind of [undefined, null, 'OTHER'])
      expect(() => validateFlowMetadata({ ...flowCapabilities, defaultIdentifierKind } as typeof flowCapabilities, flowPolicy)).toThrow()
  })
  it.each(['en', 'zh-CN'] as const)('keeps %s verification hierarchy, input and focus stable through cooldown and failures', async (locale) => {
    const h = setup({
      step: 'verification', intent: 'sign-up', verificationEmail: 'sample@example.invalid', retryAfterSeconds: 2,
      registration: { registrationId: 'private-operation', status: 'PENDING_VERIFICATION', nextAction: 'VERIFY_EMAIL', expiresAt: new Date(Date.now() + 60000).toISOString() },
    }, locale)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Verify email' : '验证邮箱', exact: true })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Verify and sign in|验证并登录/ })).toBeNull()
    expect(screen.getByText('sample@example.invalid', { exact: true })).toBeTruthy()
    fireEvent.change(input, { target: { value: '123456' } }); input.focus()
    expect(screen.queryByRole('button', { name: /Start registration again|重新注册/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Resend|重新发送/ })).toBeNull()
    h.update({ retryAfterSeconds: 1 })
    expect(screen.getByRole('textbox')).toBe(input); expect(document.activeElement).toBe(input)
    h.update({ retryAfterSeconds: 0 })
    vi.mocked(h.actions.resendVerification).mockRejectedValue(new Error('fixture send failure'))
    fireEvent.click(screen.getByRole('button', { name: /^(Resend|重新发送)$/ }))
    await act(async () => {})
    expect(input.value).toBe('123456')
    h.update({ error: new Error('fixture send failure'), registrationCancelUnconfirmed: true })
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Open or refresh|打开或刷新/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start registration again|重新注册/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Cancel registration|取消注册/ }).getAttribute('type')).toBe('button')
  })
  it('removes expired verification input without presenting cancellation as success', async () => {
    vi.useFakeTimers()
    setup({ step: 'verification', intent: 'sign-up', verificationEmail: 'sample@example.invalid',
      registration: { registrationId: 'ref', status: 'PENDING_VERIFICATION', nextAction: 'VERIFY_EMAIL', expiresAt: new Date(Date.now() + 1000).toISOString() } })
    await act(async () => { vi.advanceTimersByTime(1001) })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start registration again' })).toBeTruthy()
  })
})
