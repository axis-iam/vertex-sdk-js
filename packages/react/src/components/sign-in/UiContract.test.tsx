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
    expect(screen.queryByRole('combobox')).toBeNull()
    const phone = screen.getByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '+12025550123' } })
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
