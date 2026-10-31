import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AccountCenter,
  AuthDialog,
  accountCenterEnglish,
  ConnectedAccounts,
  ForgotPassword,
  IamProvider,
  OrganizationInvitationAccept,
  ResetPassword,
  SignIn,
  SignInButton,
  SignUp,
} from '../src'
import type { AccountCenterColorScheme, AccountCenterLocalization } from '../src'

const issuer = 'http://account-smoke.local'
const scenario = new URLSearchParams(window.location.search).get('scenario') ?? 'success'
const locale = new URLSearchParams(window.location.search).get('locale') ?? 'en'
const surface = new URLSearchParams(window.location.search).get('surface') ?? 'account-center'
const initialScheme = (new URLSearchParams(window.location.search).get('scheme') ?? 'light') as AccountCenterColorScheme

const longLocalization = Object.fromEntries(Object.entries(accountCenterEnglish).map(([key, value]) => [
  key,
  typeof value === 'string' ? `${value} with deliberately extended explanatory wording for layout validation` : value,
])) as AccountCenterLocalization

const profile = {
  userId: 'user-visual-smoke',
  applicationId: 'app-visual-smoke',
  globalIdentityId: null,
  email: 'alex.morgan@example.com',
  emailVerified: true,
  username: 'alex.morgan',
  displayName: 'Alex Morgan',
  avatarUrl: null,
  status: 'ACTIVE',
  createdAt: '2026-07-01T08:00:00Z',
  updatedAt: '2026-07-12T08:00:00Z',
  currentOrganization: null,
}

const sessions = [
  {
    sessionId: 'session-current',
    ipAddress: '203.0.113.24',
    userAgent: 'Chrome on macOS',
    deviceId: 'device-current',
    createdAt: '2026-07-10T08:00:00Z',
    lastSeenAt: '2026-07-12T08:10:00Z',
    current: true,
  },
  {
    sessionId: 'session-mobile',
    ipAddress: '198.51.100.18',
    userAgent: 'Mobile Safari on iPhone',
    deviceId: 'device-mobile',
    createdAt: '2026-07-08T08:00:00Z',
    lastSeenAt: '2026-07-11T18:20:00Z',
    current: false,
  },
]

const activeProfile = scenario === 'long' ? {
  ...profile,
  email: 'alexandra.morgan.account-owner.with-a-very-long-address@international-enterprise-example.test',
  username: 'alexandra_morgan_with_a_deliberately_long_unbroken_username_for_responsive_layout_validation',
  displayName: 'Alexandra Morgan, Principal Account Administrator for International Operations',
  avatarUrl: 'https://assets.international-enterprise-example.test/account/profile/images/alexandra-morgan/avatar-with-a-very-long-resource-path.png',
  status: 'ACTIVE_WITH_A_DELIBERATELY_LONG_STATUS_VALUE',
} : profile

const activeSessions = scenario === 'long' ? sessions.map((session, index) => ({
  ...session,
  ipAddress: index === 0 ? '2001:0db8:85a3:0000:0000:8a2e:0370:7334' : session.ipAddress,
  userAgent: `${session.userAgent} on a managed enterprise device with an intentionally long descriptive device name`,
  deviceId: `${session.deviceId}-with-a-deliberately-long-device-identifier`,
  createdAt: index === 0 ? 'A-deliberately-long-unparseable-date-value-that-must-remain-readable' : session.createdAt,
})) : sessions

const longPermission = 'accounting:quarterly-report-with-a-deliberately-long-unbroken-action-name-for-overflow-validation'

function jwt() {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    sub: activeProfile.userId,
    email: activeProfile.email,
    name: activeProfile.displayName,
    roles: ['workspace-admin', 'billing-reviewer-with-a-deliberately-long-role-name'],
    org_id: 'org-visual-smoke-with-a-deliberately-long-organization-identifier',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.visual-smoke-signature`
}

sessionStorage.setItem('axis_iam_session', JSON.stringify({
  version: 6,
  expiresAt: Date.now() + 3600_000,
  owner: null,
  tokens: {
    access_token: jwt(),
    refresh_token: 'visual-smoke-refresh-value',
    token_type: 'Bearer',
    expires_in: 3600,
  },
  authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
  refreshProvenance: 'OAUTH_TOKEN_ENDPOINT',
}))

function response(data?: unknown, status = 200): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
  })
}

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = init?.method ?? 'GET'

  if (url.includes('/.well-known/openid-configuration')) {
    return response({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/oauth2/jwks`,
    })
  }
  if (url.includes('/api/v1/apps/visual-smoke-public-client/auth-methods')) {
    return response({
      clientId: 'visual-smoke-public-client', passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: false,
      socialLoginEnabled: true, signupEnabled: true, selfRegistrationEnabled: true, idpAutoProvisioningEnabled: false,
      loginInitiationUri: null, postVerificationRedirectUri: null,
      methods: [
        { type: 'PASSWORD', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
        { type: 'EMAIL_OTP', enabled: true, configured: true, availableForLogin: true, availableForSignup: true, unavailableReason: null },
      ],
      identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD', 'EMAIL_OTP'] }, { kind: 'PHONE', methods: ['PASSWORD'] }, { kind: 'USERNAME', methods: ['PASSWORD'] }],
      defaultIdentifierKind: 'EMAIL',
      defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' },
      identifierRestrictions: {signup:{email:{restricted:false},phone:{restricted:false,allowedRegions:null}},login:{email:{restricted:false},phone:{restricted:false,allowedRegions:null}}},
      allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'],
      allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'],
      idpProviders: [{ id: 'idp-github', providerType: 'GITHUB', displayName: 'GitHub', enabled: true, configured: true, clickable: true, availableForLogin: true, availableForSignup: true, unavailableReason: null, authorizationUrl: `${issuer}/provider` }],
      resend: { emailVerificationCooldownSeconds: 60 },
    })
  }
  if (url.includes('/api/v1/apps/visual-smoke-public-client/auth-policy')) {
    return response({ identifierRestrictions: {signup:{email:{restricted:false},phone:{restricted:false,allowedRegions:null}},login:{email:{restricted:false},phone:{restricted:false,allowedRegions:null}}}, defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' }, allowedSignupIdentifierKinds: ['EMAIL', 'USERNAME'], allowedPasswordIdentifierKinds: ['EMAIL', 'USERNAME', 'PHONE'], passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: true, smsOtpEnabled: false, socialLoginEnabled: true, smsAutoProvisioningEnabled: false, minPasswordLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecialChar: false, breachedPasswordCheck: false, totpEnabled: false, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [], deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false, idpAutoProvisioningEnabled: false, signupMode: 'OPEN', allowedRegistrationGrantTypes: ['ACCESS_CODE'] })
  }
  if (url.endsWith('/api/v1/auth/me/login-methods') && method !== 'DELETE') {
    return response({ loginMethodVersion: 1, methods: [{
      methodId: 'credential:PASSWORD', kind: 'PASSWORD', roles: ['FIRST_FACTOR'], status: 'AVAILABLE',
      capabilities: {}, unavailableReasons: [],
    }] })
  }
  if (url.endsWith('/api/v1/auth/me/identifiers')) {
    return response({ loginMethodVersion: 1, items: [{
      id: 'email-visual', kind: 'EMAIL', displayValue: activeProfile.email,
      status: 'ACTIVE', verificationState: 'VERIFIED', isPrimary: true,
    }] })
  }
  if (url.includes('/api/v1/auth/me/linkable-identity-providers')) {
    return response([{
      id: 'idp-github', providerType: 'GITHUB', protocol: 'OAUTH2', displayName: 'GitHub', enabled: true,
      linked: false, linkedAt: null, supportsAccountLinking: true,
      canLink: true, canReauthenticate: false, unavailableReasons: [],
    }])
  }

  if (scenario === 'loading' && /\/api\/v1\/auth\/(me|sessions)/.test(url)) {
    return await new Promise<Response>(() => undefined)
  }
  if (scenario === 'error' && /\/api\/v1\/auth\/(me|sessions)/.test(url)) {
    return response({ message: 'This visual-smoke request failed' }, 503)
  }

  const busyMutation = scenario === 'busy' && (
    (url.endsWith('/api/v1/auth/me/profile') && method === 'PATCH')
    || url.endsWith('/api/v1/auth/password/change')
    || (url.includes('/api/v1/auth/sessions/') && method === 'DELETE')
    || url.includes('/api/v1/auth/me/permissions:check')
  )
  if (busyMutation) return await new Promise<Response>(() => undefined)

  if (url.endsWith('/api/v1/auth/me/profile') && method === 'GET') return response(activeProfile)
  if (url.endsWith('/api/v1/auth/me/profile') && method === 'PATCH') {
    return response({ ...activeProfile, ...JSON.parse(String(init?.body)) })
  }
  if (url.endsWith('/api/v1/auth/me/security')) {
    return response({
      emailVerified: true,
      passwordCredentialPresent: true,
      mfaEnrolled: false,
      totpEnrolled: false,
      webAuthnEnrolled: false,
      activeSessionCount: activeSessions.length,
    })
  }
  if (url.endsWith('/api/v1/auth/password/change')) return response()
  if (url.endsWith('/api/v1/auth/sessions') && method === 'GET') return response(scenario === 'empty' ? [] : activeSessions)
  if (url.includes('/api/v1/auth/sessions') && method === 'DELETE') return response()
  if (url.endsWith('/api/v1/auth/logout')) return response()
  if (url.includes('/api/v1/auth/me/permissions:check')) {
    const request = JSON.parse(String(init?.body)) as { permission: string; organizationId?: string | null }
    return response({
      applicationId: activeProfile.applicationId,
      organizationId: request.organizationId ?? null,
      permission: request.permission,
      allowed: request.permission === 'orders:read',
      roles: ['workspace-admin'],
    })
  }
  if (url.endsWith('/api/v1/auth/me')) return response({ id: activeProfile.userId, email: activeProfile.email, username: null, status:'ACTIVE', emailVerified:true, metadata:{}, authenticationContext:{subjectType:'USER',applicationId:activeProfile.applicationId,clientId:'visual-smoke-public-client',sessionId:'session-current',workspaceId:null,workspaceSelectionRequired:true,organizationId:null,organizationSlug:null,organizationRole:null,authTime:null,authenticationMethods:[],assuranceLevel:null,impersonation:null} })
  if (url.includes('/api/v1/auth/me/permissions')) {
    return response({
      applicationId: activeProfile.applicationId,
      organizationId: scenario === 'long' ? 'org-visual-smoke-with-a-deliberately-long-organization-identifier-and-context-value' : 'org-visual-smoke',
      roles: scenario === 'empty' ? [] : ['workspace-admin', 'billing-reviewer-with-a-deliberately-long-role-name'],
      permissions: scenario === 'empty' ? [] : ['orders:read', 'invoices:approve', longPermission],
    })
  }
  return response({ message: `Unhandled visual-smoke request: ${url}` }, 404)
}

function App() {
  const [accountCenterOpen, setAccountCenterOpen] = useState(false)
  const [colorScheme, setColorScheme] = useState<AccountCenterColorScheme>(initialScheme)
  const localization = locale === 'long' ? { accountCenter: longLocalization } : undefined

  if (surface === 'auth') {
    return (
      <IamProvider
        clientId="visual-smoke-public-client"
        issuerUri={issuer}
        redirectUri="/callback"
        tokenStorage="sessionStorage"
        locale={locale === 'zh' ? 'zh-CN' : 'en'}
        colorScheme={colorScheme}
      >
        <main id="auth-localization-smoke" data-color-scheme={colorScheme}>
          <IamProvider
            clientId="visual-smoke-public-client"
            issuerUri={issuer}
            redirectUri="/callback"
            tokenStorage="memory"
            locale={locale === 'zh' ? 'zh-CN' : 'en'}
            colorScheme={colorScheme}
          >
            <SignIn />
            <SignUp />
            <ForgotPassword />
            <ResetPassword token="visual-reset-token" />
            <OrganizationInvitationAccept continuation={'c'.repeat(43)} />
          </IamProvider>
          <ConnectedAccounts redirectUri="/callback" />
        </main>
      </IamProvider>
    )
  }

  if (surface === 'auth-dialog') {
    const authLocalization = locale === 'long' ? {
      authDialog: {
        signInTab: 'Sign in using your organization account with deliberately extended explanatory wording',
        signUpTab: 'Create a new account for your organization with deliberately extended explanatory wording',
      },
    } : undefined
    return (
      <IamProvider
        clientId="visual-smoke-public-client"
        issuerUri={issuer}
        redirectUri="/callback"
        tokenStorage="memory"
        locale={locale === 'zh' ? 'zh-CN' : 'en'}
        colorScheme={colorScheme}
        localization={authLocalization}
      >
        <main id="auth-dialog-smoke" data-color-scheme={colorScheme}>
          <button id="theme-light" type="button" onClick={() => setColorScheme('light')}>Light</button>
          <button id="theme-dark" type="button" onClick={() => setColorScheme('dark')}>Dark</button>
          <button id="theme-system" type="button" onClick={() => setColorScheme('system')}>System</button>
          <AuthDialog open={accountCenterOpen} onOpenChange={setAccountCenterOpen} initialView={scenario === 'signup' ? 'sign-up' : 'sign-in'} signUpProps={{ registrationGrant: { type: 'ACCESS_CODE', registrationAccessCode: 'visual-smoke-proof' } }}>
            <SignInButton id="auth-dialog-trigger">{locale === 'long' ? 'Open authentication experience with a deliberately extended host-controlled label' : undefined}</SignInButton>
          </AuthDialog>
        </main>
      </IamProvider>
    )
  }

  return (
    <IamProvider
      clientId="visual-smoke-public-client"
      issuerUri={issuer}
      redirectUri="/callback"
      tokenStorage="sessionStorage"
      locale={locale === 'zh' ? 'zh-CN' : 'en'}
      colorScheme={colorScheme}
      localization={localization}
    >
      <main>
        <header className="page-header">
          <div>
            <span>Account center</span>
            <h1>Personal settings</h1>
          </div>
          <code>{scenario}</code>
        </header>
        <button id="account-center-trigger" type="button" onClick={() => setAccountCenterOpen(true)}>Open account center</button>
        <button id="theme-light" type="button" onClick={() => setColorScheme('light')}>Light</button>
        <button id="theme-dark" type="button" onClick={() => setColorScheme('dark')}>Dark</button>
        <button id="theme-system" type="button" onClick={() => setColorScheme('system')}>System</button>
        <AccountCenter
          open={accountCenterOpen}
          onOpenChange={setAccountCenterOpen}
          organizationId={scenario === 'long' ? 'org-visual-smoke-with-a-deliberately-long-organization-identifier-and-context-value' : 'org-visual-smoke'}
        />
      </main>
    </IamProvider>
  )
}

createRoot(document.getElementById('root')!).render(<App />)

const pageCss = document.createElement('style')
pageCss.textContent = `
  :root { color-scheme: light; background:#eef2f5; font-family:Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin:0; min-width:0; }
  main { width:min(1180px, calc(100% - 40px)); margin:0 auto; padding:36px 0 64px; }
  #auth-localization-smoke { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); align-items:start; gap:20px; }
  #auth-localization-smoke > * { width:100%; }
  .page-header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:22px; }
  .page-header span { color:#52606d; font-size:12px; font-weight:700; text-transform:uppercase; }
  .page-header h1 { margin:5px 0 0; color:#17202a; font-size:28px; line-height:34px; letter-spacing:0; }
  .page-header code { color:#52606d; font-size:12px; }
  #theme-light, #theme-dark, #theme-system { margin-left:8px; }
  @media (max-width:760px) {
    main { width:min(100% - 24px, 620px); padding-top:22px; }
    #auth-localization-smoke { grid-template-columns:1fr; gap:14px; }
    .page-header h1 { font-size:24px; line-height:30px; }
  }
`
document.head.append(pageCss)
