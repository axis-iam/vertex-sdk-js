import { fireEvent, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AccountCenter } from '../components/AccountCenter'
import { ForgotPassword } from '../components/ForgotPassword'
import { OrganizationInvitationAccept } from '../components/OrganizationInvitationAccept'
import { ResetPassword } from '../components/ResetPassword'
import { SignIn } from '../components/SignIn'
import { SignUp } from '../components/SignUp'
import { localizeError, normalizeIamLocale, resolveIamLocalization } from '../localization'
import { testProviderProps } from '../test-utils'
import { IamProvider, useIamContext } from './IamProvider'

describe('IamProvider localization', () => {
  it('resolves complete built-ins, typed partial overrides, and whole-catalog unsupported fallback', () => {
    const chinese = resolveIamLocalization('zh-Hans')
    expect(chinese.locale).toBe('zh-CN')
    expect(chinese.localization.accountCenter.currentPassword).toBe('当前密码')
    expect(chinese.localization.auth.signIn).toBe('登录')
    expect(chinese.localization.auth.identifierPlaceholder).not.toContain('or')
    expect(Object.keys(chinese.localization)).toEqual(Object.keys(resolveIamLocalization('en').localization))

    const overridden = resolveIamLocalization('zh-CN', { auth: { signIn: '立即登录' } })
    expect(overridden.localization.auth.signIn).toBe('立即登录')
    expect(overridden.localization.accountCenter.title).toBe('账户中心')

    expect(normalizeIamLocale('en-GB')).toEqual({ locale: 'en', unsupported: false })
    expect(normalizeIamLocale('fr-FR')).toEqual({ locale: 'en', unsupported: true })
  })

  it.each(['en', 'zh-CN'] as const)('shows the effective breach requirement only when enabled in %s', (locale) => {
    const l = resolveIamLocalization(locale).localization
    const rules = { requireUppercase: true, requireLowercase: true, requireDigit: true, requireSpecialChar: true, breachedPasswordCheck: false }
    const off = l.signUp.passwordRequirements(10, rules)
    const on = l.signUp.passwordRequirements(10, { ...rules, breachedPasswordCheck: true })
    expect(off).not.toMatch(/breach|泄露/)
    expect(on).toMatch(/breach|泄露/)
    expect(on).toContain('10')
    if (locale === 'zh-CN') {
      expect(l.authDialog.signUpTab).toBe('还没有账户？注册')
      expect(l.authDialog.signInTab).toBe('已有账户？登录')
    }
  })

  it('is deterministic in SSR and applies component copy after the provider override', () => {
    const html = renderToString(createElement(
      IamProvider,
      {
        ...testProviderProps(),
        tokenStorage: 'memory',
        locale: 'zh-CN',
        localization: { accountCenter: { title: '提供方账户中心' } },
      },
      createElement(AccountCenter, {
        open: true,
        onOpenChange: () => undefined,
        initialSection: 'password',
        localization: { title: '组件账户中心' },
      }),
    ))

    expect(html).toContain('组件账户中心')
    expect(html).toContain('aria-label="修改密码"')
    expect(html).toContain('当前密码')
    expect(html).not.toContain('Current password')
  })

  it('switches locale in place without recreating OAuthClient, closing AccountCenter, clearing form state, or refetching', () => {
    const clients: unknown[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('openid-configuration')) {
        return {
          ok: true,
          json: async () => ({
            issuer: 'https://auth.test.com',
            authorization_endpoint: 'https://auth.test.com/authorize',
            token_endpoint: 'https://auth.test.com/token',
            userinfo_endpoint: 'https://auth.test.com/userinfo',
            jwks_uri: 'https://auth.test.com/oauth2/jwks',
          }),
        }
      }
      return { ok: true, json: async () => ({ applicationId: 'app-test', organizationId: null, roles: [], permissions: [] }) }
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    function ClientProbe() {
      clients.push(useIamContext().client)
      return null
    }

    function Harness() {
      const [locale, setLocale] = useState<'en' | 'zh-CN'>('en')
      return createElement(
        IamProvider,
        { ...testProviderProps(), locale },
        createElement(ClientProbe),
        createElement('button', { type: 'button', onClick: () => setLocale('zh-CN') }, 'switch locale'),
        createElement(AccountCenter, { open: true, onOpenChange: () => undefined, initialSection: 'password' }),
      )
    }

    render(createElement(Harness))
    const password = screen.getByLabelText('Current password') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'state-preserved-password' } })
    const requestsBeforeSwitch = fetchMock.mock.calls.length

    fireEvent.click(screen.getByText('switch locale'))

    const localizedPassword = screen.getByLabelText('当前密码') as HTMLInputElement
    expect(localizedPassword.value).toBe('state-preserved-password')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: '密码' }).getAttribute('aria-current')).toBe('page')
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeSwitch)
    expect(new Set(clients).size).toBe(1)
  })

  it('uses stable codes and status mappings instead of raw response messages', () => {
    const { localization } = resolveIamLocalization('zh-CN')
    expect(localizeError({ code: 'EMAIL_VERIFICATION_REQUIRED', message: 'raw server text' }, localization, 'signInFailed')).toBe('请先验证邮箱再登录。')
    expect(localizeError({ status: 429, message: 'proof=secret' }, localization, 'signUpFailed')).toBe('请求过于频繁，请稍后重试。')
    expect(localizeError({ message: 'access_token=secret' }, localization, 'signUpFailed')).toBe('无法创建账户，请重试。')
  })

  it('applies provider dark tokens to auth surfaces and preserves component appearance patches', () => {
    const { container } = render(createElement(
      IamProvider,
      {
        ...testProviderProps(),
        tokenStorage: 'memory',
        locale: 'zh-CN',
        colorScheme: 'dark',
        appearance: { borderRadius: '3px', fontFamily: 'Test Sans' },
        darkAppearance: { backgroundColor: '#121820', borderColor: '#405060' },
      },
      createElement(SignIn, { appearance: { borderRadius: '12px' } }),
      createElement(SignUp),
      createElement(ForgotPassword),
      createElement(ResetPassword, { token: 'reset-token' }),
      createElement(OrganizationInvitationAccept, { token: 'invitation-token' }),
    ))

    const roots = [
      screen.getByRole('heading', { name: '登录' }).parentElement,
      screen.getByRole('heading', { name: '创建账户' }).parentElement,
      screen.getByRole('heading', { name: '重置密码' }).parentElement,
      screen.getByRole('heading', { name: '创建新密码' }).parentElement,
      screen.getByRole('heading', { name: '组织邀请' }).parentElement,
    ]
    for (const root of roots.slice(1)) {
      expect(root?.style.backgroundColor).toBe('rgb(18, 24, 32)')
      expect(root?.style.borderRadius).toBe('3px')
      expect(root?.style.fontFamily).toContain('Test Sans')
    }
    expect(roots[0]?.style.borderRadius).toBe('12px')
    expect(container.textContent).not.toContain('Sign in')
  })

  it('owns Chinese dynamic values instead of exposing status or credential enums', () => {
    const { localization } = resolveIamLocalization('zh-CN')
    expect(localization.accountCenter.profileStatus('ACTIVE')).toBe('正常')
    expect(localization.connectedAccounts.credentialType('PASSWORD')).toBe('密码')
    expect(localization.connectedAccounts.credentialType('RECOVERY_CODE')).toBe('恢复代码')
    expect(localization.connectedAccounts.providerType('GOOGLE', 'OIDC')).toBe('Google（OpenID Connect）')
    expect(localization.connectedAccounts.providerType('SAML', 'SAML')).toBe('SAML 单点登录')
    expect(localization.connectedAccounts.providerType('UNKNOWN_PROVIDER', 'UNKNOWN_PROTOCOL')).toBe('身份提供商')
    expect(localization.connectedAccounts.stepUpMethod('TOTP')).toBe('身份验证器应用')
    expect(localization.connectedAccounts.stepUpMethod('PASSWORD')).toBe('密码')
    expect(localization.connectedAccounts.stepUpMethod('UNKNOWN_METHOD')).toBe('验证方式')
    expect(localization.auth.logoAlt).toBe('应用标志')
    expect(localization.auth.phonePlaceholder).toBe('+86 13800138000')
  })
})
