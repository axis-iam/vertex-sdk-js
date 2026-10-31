import { securityEnglish, securityZhCN } from './security-localization'
import type { SecurityLocalization } from './security-localization'
import { identityEnglish, identityZhCN } from './identity-localization'
import type { IdentityLocalization } from './identity-localization'
import type { AccountCenterLocalization } from './components/accountCenterConfig'
import { accountCenterEnglish } from './components/accountCenterConfig'

export type IamLocale = 'en' | 'zh-CN' | (string & {})

type ErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_VERIFICATION_REQUIRED'
  | 'EMAIL_ALREADY_EXISTS'
  | 'PASSWORD_RESET_INVALID'
  | 'PASSWORD_RESET_EXPIRED'
  | 'REGISTRATION_IDENTIFIER_REJECTED'
  | 'REGISTRATION_GRANT_INVALID'
  | 'REGISTRATION_GRANT_REQUIRED'
  | 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED'
  | 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED'
  | 'REGISTRATION_DISABLED'
  | 'INVITATION_INVALID'
  | 'INVITATION_EXPIRED'
  | 'STEP_UP_REQUIRED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'

export interface IamLocalization {
  security: SecurityLocalization
  identity: IdentityLocalization
  accountCenter: AccountCenterLocalization
  auth: {
    signIn: string
    signedInAs: (email: string) => string
    loadingOptions: string
    optionsUnavailable: string
    noMethodAvailable: string
    identifierLabel: string
    identifierPlaceholder: string
    identifierInvalid: string
    continue: string
    signingInAs: (identifier: string) => string
    change: string
    noMethodForIdentifier: string
    or: string
    password: string
    passwordPlaceholder: string
    email: string
    emailPlaceholder: string
    phone: string
    phonePlaceholder: string
    verificationCode: string
    verificationCodePlaceholder: string
    sendCode: string
    resend: string
    resendIn: (seconds: number) => string
    verifying: string
    mfaDescription: string
    authenticatorCode: string
    verify: string
    back: string
    signInBusy: string
    forgotPassword: string
    providerSignIn: (provider: string) => string
    challengeExpired: string
    magicLinkSent: (email: string) => string
    sendMagicLink: string
    sendingMagicLink: string
    resendVerification: string
    verificationEmailSent: string
    verificationEmailFailed: string
    sending: string
    credentialMethod: (method: 'password' | 'sms' | 'magic_link' | 'email_otp') => string
    redirecting: string
    noAccount: string
    haveAccount: string
    signUp: string
    brandingLoading: string
    brandingUnavailable: string
    retryBranding: string
    logoAlt: string
  }
  authDialog: {
    close: string
    signInTab: string
    signUpTab: string
    title: (view: 'sign-in' | 'sign-up') => string
  }
  signUp: {
    title: string
    username: string
    usernamePlaceholder: string
    email: string
    emailPlaceholder: string
    password: string
    passwordPlaceholder: string
    confirmPassword: string
    confirmPasswordPlaceholder: string
    createAccount: string
    creatingAccount: string
    checkEmail: string
    accountCreated: string
    accountCreatedDetail: (email: string) => string
    verificationOptional: (email: string) => string
    verificationRequired: (email: string) => string
    verificationUnknown: string
    resendVerification: string
    resendIn: (seconds: number) => string
    sending: string
    verificationEmailSent: string
    verificationEmailFailed: string
    accessCode: string
    accessCodeOptional: string
    accessCodeRequired: string
    accessCodePlaceholder: string
    invitationRequired: string
    invitationOrAccessCodeRequired: string
    passwordMismatch: string
    passwordMinLength: string
    passwordRequirements: (minimum: number, rules?: { requireUppercase: boolean; requireLowercase: boolean; requireDigit: boolean; requireSpecialChar: boolean; breachedPasswordCheck: boolean }) => string
    unavailable: string
    grantNotAccepted: string
    signUp: string
  }
  passwordReset: {
    resetPassword: string
    createNewPassword: string
    checkEmail: string
    resetSent: string
    email: string
    emailPlaceholder: string
    sendResetLink: string
    sending: string
    newPassword: string
    passwordPlaceholder: string
    confirmPassword: string
    confirmPasswordPlaceholder: string
    resetting: string
    resetComplete: string
    resetCompleteDetail: string
    resetTokenRequired: string
    passwordMinLength: string
    passwordMismatch: string
    invalidEmail: string
  }
  connectedAccounts: {
    aria: string
    title: string
    description: string
    signInMethods: string
    noSignInMethods: string
    connectAccount: string
    noProviders: string
    loading: string
    disconnect: string
    disconnecting: string
    disconnectAria: (name: string) => string
    connect: string
    opening: string
    connectAria: (name: string) => string
    connected: string
    connectedAt: (value: string) => string
    requiredForAccess: string
    confirmDisconnect: (name: string) => string
    stepUpRequired: string
    stepUpRequiredWithMethods: (methods: string) => string
    unavailable: string
    credential: string
    credentialType: (type: string | null | undefined) => string
    providerType: (providerType: string | null | undefined, protocol: string | null | undefined) => string
    stepUpMethod: (method: string | null | undefined) => string
  }
  userButton: {
    menuAria: string
    fallbackUser: string
    organization: (slug: string) => string
    signOut: string
  }
  userProfile: {
    title: string
    account: string
    email: string
    username: string
    name: string
    organization: string
    roles: string
    devices: string
    lastSeen: (value: string) => string
    revoke: string
    unavailable: string
  }
  organization: {
    select: string
    switching: string
    switchUnavailable: string
    role: (role: string | null | undefined) => string
  }
  invitation: {
    aria: string
    title: string
    join: (organization: string) => string
    detail: (application: string, email: string, role: string) => string
    loading: string
    expires: (value: string) => string
    accept: string
    accepting: string
    accepted: string
    loginRequired: string
    invalidEntry: string
    unknownResult: string
    retryPreparation: string
    preparationNotSubmitted: string
    navigationFailed: string
    accountKept: string
    applicationLabel: string
    roleLabel: string
    recipientLabel: string
    enrollmentRequired: string
    explicitConfirmation: string
    reviewChanges: string
    cancel: string
    checkResult: string
    checkRegistration: string
    navigate: string
    switchAccount: string
    loginCompleted: string
    mfaMethod: string
    recoveryCode: string
    useSession: string
    terminal: (state: string) => string
  }
  errors: {
    generic: string
    signInOptionsUnavailable: string
    signInFailed: string
    signUpFailed: string
    resetRequestFailed: string
    resetFailed: string
    invitationFailed: string
    organizationSwitchFailed: string
    accountLinkFailed: string
    accountUnlinkFailed: string
    codes: Record<ErrorCode, string>
  }
}

export type PartialIamLocalization = DeepPartial<IamLocalization>
type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export const iamLocalizationEnglish: IamLocalization = {
  security: securityEnglish,
  identity: identityEnglish,
  accountCenter: { ...accountCenterEnglish, profileStatus: (status) => formatProfileStatus(status, 'en') },
  auth: {
    signIn: 'Sign in', signedInAs: (email) => `Signed in as ${email}`, loadingOptions: 'Loading sign-in options...',
    optionsUnavailable: 'Sign-in options are unavailable right now.', noMethodAvailable: 'No sign-in method is currently available.',
    identifierLabel: 'Email or phone number', identifierPlaceholder: 'you@example.com or phone number', identifierInvalid: 'Enter a valid email address or phone number.',
    continue: 'Continue', signingInAs: (identifier) => `Signing in as ${identifier}`, change: 'Change', noMethodForIdentifier: 'No sign-in method is available for this identifier.',
    or: 'or', password: 'Password', passwordPlaceholder: 'Enter your password', email: 'Email', emailPlaceholder: 'you@example.com', phone: 'Phone number', phonePlaceholder: 'Phone number',
    verificationCode: 'Verification code', verificationCodePlaceholder: 'Enter 6-digit code', sendCode: 'Send code', resend: 'Resend', resendIn: (seconds) => `Resend in ${seconds}s`,
    verifying: 'Verifying...', signInBusy: 'Signing in...', forgotPassword: 'Forgot password?', providerSignIn: (provider) => `Continue with ${provider}`,
    challengeExpired: 'This code or link has expired. Request another to continue.',
    magicLinkSent: (email) => `We sent a sign-in link to ${email}.`, sendMagicLink: 'Send magic link', sendingMagicLink: 'Sending link...',
    resendVerification: 'Resend verification email', verificationEmailSent: 'Verification email sent.', verificationEmailFailed: 'Verification email could not be sent. Try again later.', sending: 'Sending...', credentialMethod: (method) => ({ password: 'Password', email_otp: 'Email code', magic_link: 'Magic link', sms: 'SMS code' })[method], redirecting: 'Redirecting...', noAccount: "Don't have an account?", haveAccount: 'Already have an account?', signUp: 'Sign up', brandingLoading: 'Loading application branding…', brandingUnavailable: 'Application branding could not be loaded.', retryBranding: 'Retry branding', logoAlt: 'Application logo',
    mfaDescription: 'Enter the code from your authenticator app to finish signing in.', authenticatorCode: 'Authenticator code', verify: 'Verify and sign in', back: 'Back',
  },
  authDialog: { close: 'Close authentication dialog', signInTab: 'Already have an account? Sign in', signUpTab: "Don't have an account? Sign up", title: (view) => view === 'sign-in' ? 'Sign in' : 'Create account' },
  signUp: {
    title: 'Create account', username: 'Username (optional)', usernamePlaceholder: 'Choose a username', email: 'Email', emailPlaceholder: 'you@example.com', password: 'Password', passwordPlaceholder: 'At least 8 characters',
    confirmPassword: 'Confirm password', confirmPasswordPlaceholder: 'Confirm your password', createAccount: 'Create account', creatingAccount: 'Creating account...',
    checkEmail: 'Check your email', accountCreated: 'Account created', accountCreatedDetail: (email) => `${email} can now sign in.`,
    verificationOptional: (email) => `We sent a verification email to ${email}. You can sign in now and verify your email when you are ready.`,
    verificationRequired: (email) => `We sent a verification email to ${email}. Verify your email before signing in.`, verificationUnknown: 'Your account was created. Check your email for any verification message from this application.',
    resendVerification: 'Resend verification email', resendIn: (seconds) => `Resend in ${seconds}s`, sending: 'Sending...', verificationEmailSent: 'Verification email sent.', verificationEmailFailed: 'Verification email could not be sent. Try again later.',
    accessCodeOptional: 'Registration access code (optional)', accessCodeRequired: 'Registration access code (required)', accessCode: 'Registration access code', accessCodePlaceholder: 'Enter access code', invitationRequired: 'An invitation is required to create an account.', invitationOrAccessCodeRequired: 'An invitation or registration access code is required.', passwordMismatch: 'Passwords do not match', passwordMinLength: 'Password must be at least 8 characters',
    passwordRequirements: (minimum, rules) => {
      const required = rules ? [rules.requireUppercase && 'an uppercase letter', rules.requireLowercase && 'a lowercase letter', rules.requireDigit && 'a digit', rules.requireSpecialChar && 'a symbol'].filter(Boolean) : []
      return `Use at least ${minimum} characters${required.length ? `, including ${required.join(', ')}` : ''}.${rules?.breachedPasswordCheck ? ' Passwords found in known data breaches are not allowed.' : ''}`
    }, unavailable: 'Sign-up is unavailable right now.', grantNotAccepted: 'This registration invitation is not accepted by this application.', signUp: 'Sign up',
  },
  passwordReset: {
    resetPassword: 'Reset password', createNewPassword: 'Create new password', checkEmail: 'Check your email', resetSent: 'If an account exists, a password reset link has been sent.',
    email: 'Email', emailPlaceholder: 'you@example.com', sendResetLink: 'Send reset link', sending: 'Sending...', newPassword: 'New password', passwordPlaceholder: 'At least 8 characters',
    confirmPassword: 'Confirm password', confirmPasswordPlaceholder: 'Confirm your password', resetting: 'Resetting...', resetComplete: 'Password reset', resetCompleteDetail: 'Your password has been updated. Sign in with your new password.', resetTokenRequired: 'Reset token is required', passwordMinLength: 'Password must be at least 8 characters', passwordMismatch: 'Passwords do not match', invalidEmail: 'Enter a valid email address',
  },
  connectedAccounts: {
    aria: 'Connected accounts', title: 'Connected accounts', description: 'Manage sign-in methods for this account.', signInMethods: 'Sign-in methods', noSignInMethods: 'No sign-in methods are available.',
    connectAccount: 'Connect account', noProviders: 'No providers are available to connect.', loading: 'Loading connected accounts', disconnect: 'Disconnect', disconnecting: 'Disconnecting', disconnectAria: (name) => `Disconnect ${name}`,
    connect: 'Connect', opening: 'Opening', connectAria: (name) => `Connect ${name}`, connected: 'Connected', connectedAt: (value) => `Connected ${value}`,
    requiredForAccess: 'This is required to keep account access available.', confirmDisconnect: (name) => `Disconnect ${name}?`, stepUpRequired: 'Verify again to continue.', stepUpRequiredWithMethods: (methods) => `Verify again to continue. Available methods: ${methods}.`, unavailable: 'Connected accounts are unavailable right now.', credential: 'Credential', credentialType: (type) => formatCredentialType(type, 'en'), providerType: (providerType, protocol) => formatProviderType(providerType, protocol, 'en'), stepUpMethod: (method) => formatStepUpMethod(method, 'en'),
  },
  userButton: { menuAria: 'User menu', fallbackUser: 'User', organization: (slug) => `Org: ${slug}`, signOut: 'Sign out' },
  userProfile: { title: 'Profile', account: 'Account', email: 'Email', username: 'Username', name: 'Name', organization: 'Organization', roles: 'Roles', devices: 'Devices', lastSeen: (value) => `Last seen: ${value}`, revoke: 'Revoke', unavailable: '—' },
  organization: { select: 'Select organization', switching: 'Switching organization...', switchUnavailable: 'Organization could not be switched', role: (role) => formatOrganizationRole(role, 'en') },
  invitation: { aria: 'Organization invitation', title: 'Organization invitation', join: (organization) => `Join ${organization}`, detail: (application, email, role) => `${application} invited ${email} as ${role}.`, loading: 'Loading invitation...', expires: (value) => `Expires ${value}`, accept: 'Accept invitation', accepting: 'Accepting', accepted: 'Invitation accepted.', loginRequired: 'Sign in or create an account to continue.', invalidEntry: 'This invitation entry is invalid. Open the original invitation again.', unknownResult: 'The response was lost. Check the result before trying another action.', retryPreparation: 'Retry loading invitation', preparationNotSubmitted: 'The entry has not been exchanged. Retry loading it to continue.', navigationFailed: 'Your invitation is complete, but the next page could not be opened.', accountKept: 'Your account is kept. You have not joined the organization.', applicationLabel: 'Application', roleLabel: 'Role', recipientLabel: 'Invited email', enrollmentRequired: 'Set up an allowed authenticator to verify this account. You will still confirm the invitation separately.', explicitConfirmation: 'Creating an account does not accept this invitation. Confirm separately after verification.', reviewChanges: 'Review updated invitation', cancel: 'Cancel invitation', checkResult: 'Check invitation result', checkRegistration: 'Check registration status', navigate: 'Continue to application', switchAccount: 'Switch account', loginCompleted: 'I have signed in', mfaMethod: 'Verification method', recoveryCode: 'Recovery code', useSession: 'Use current signed-in account', terminal: (state) => ({ CANCELLED: 'Invitation cancelled.', EXPIRED: 'Invitation expired.', REVOKED: 'Invitation revoked.', UNAVAILABLE: 'Invitation unavailable.' })[state] ?? 'Invitation unavailable.' },
  errors: {
    generic: 'Something went wrong. Please try again.', signInOptionsUnavailable: 'Sign-in options are unavailable right now.', signInFailed: 'Sign-in failed. Please try again.', signUpFailed: 'We could not create your account. Please try again.', resetRequestFailed: 'We could not request a password reset. Please try again.', resetFailed: 'We could not reset your password. Please try again.', invitationFailed: 'We could not process this invitation. Please try again.', organizationSwitchFailed: 'We could not switch organizations. Please try again.', accountLinkFailed: 'We could not connect this account. Please try again.', accountUnlinkFailed: 'We could not disconnect this account. Please try again.',
    codes: { REGISTRATION_IDENTIFIER_REJECTED: 'This address cannot be used to register here. Choose another address or contact support.', INVALID_CREDENTIALS: 'The email, phone number, or password is incorrect.', EMAIL_VERIFICATION_REQUIRED: 'Verify your email before signing in.', EMAIL_ALREADY_EXISTS: 'An account already exists for this email address.', PASSWORD_RESET_INVALID: 'This password reset link is invalid.', PASSWORD_RESET_EXPIRED: 'This password reset link has expired.', REGISTRATION_GRANT_INVALID: 'This registration invitation or access code is invalid.', REGISTRATION_GRANT_REQUIRED: 'An invitation or registration access code is required.', REGISTRATION_GRANT_TYPE_NOT_ALLOWED: 'This registration invitation or access code is unavailable.', REGISTRATION_GRANT_HOSTED_UNSUPPORTED: 'This registration invitation or access code is unavailable.', REGISTRATION_DISABLED: 'This registration invitation or access code is unavailable.', INVITATION_INVALID: 'This invitation is invalid.', INVITATION_EXPIRED: 'This invitation has expired.', STEP_UP_REQUIRED: 'Verify again to continue.', RATE_LIMITED: 'Too many requests. Please try again later.', UNAUTHORIZED: 'Please sign in and try again.', FORBIDDEN: 'You do not have permission to do that.' },
  },
}

export const iamLocalizationZhCN: IamLocalization = {
  security: securityZhCN,
  identity: identityZhCN,
  accountCenter: {
    title: '账户中心', close: '关闭账户中心', sectionsAria: '账户栏目', menu: '账户', back: '菜单', securitySection: '安全验证', profileSection: '个人资料', passwordSection: '密码', sessionsSection: '会话', permissionsSection: '权限', retry: '重试', retrying: '正在重试',
    profileAria: '账户资料', profileDescription: '身份与账户信息', accountFallback: '账户', profileLoading: '正在加载个人资料', emailVerified: '邮箱已验证', emailNotVerified: '邮箱未验证', profileSaved: '资料已保存', displayName: '显示名称', username: '用户名', avatarUrl: '头像地址', saveProfile: '保存资料', savingProfile: '正在保存资料', securityOverview: '安全概览', securityLoading: '正在加载安全信息', configured: '已配置', notConfigured: '未配置', multiFactorAuthentication: '多因素认证', enabled: '已启用', notEnabled: '未启用', activeSessions: '活跃会话', securityUnavailable: '无法获取安全详情', profileEmptyTitle: '个人资料不可用', profileEmptyDetail: '无法加载账户详情',
    passwordAria: '修改密码', passwordDescription: '修改您的密码', passwordRequiredError: '请输入当前密码和新密码', passwordMismatchError: '两次输入的新密码不一致', passwordChanged: '密码已修改', currentPassword: '当前密码', newPassword: '新密码', confirmPassword: '确认新密码', passwordHelp: '密码仅会在提交时发送', changePassword: '修改密码', changingPassword: '正在修改密码',
    sessionsAria: '账户会话', sessionsDescription: '已登录设备', sessionsLoading: '正在加载会话', noSessionsTitle: '没有活跃会话', noSessionsDetail: '未找到已登录设备', unknownDevice: '未知设备', currentDevice: '当前设备', ipAddress: 'IP 地址', unknownValue: '未知', lastActive: '最近活跃', signedIn: '登录时间', revokeCurrentSession: '撤销当前会话', revokeSession: '撤销会话', sessionControls: '会话控制', sessionControlsDetail: '已撤销的设备需要重新登录。', revokeOtherSessions: '撤销其他会话', revokingOtherSessions: '正在撤销其他会话', logOut: '退出登录', loggingOut: '正在退出登录',
    permissionsAria: '账户权限', permissionsTitle: '访问权限', permissionsDescription: '角色与权限', permissionRequiredError: '请输入权限', permissionsLoading: '正在加载权限', role: '角色', roles: '角色', permissions: '权限', organization: '组织', noRoles: '未分配角色。', grantedPermissions: '已授予权限', noPermissions: '未授予权限。', accessEmptyTitle: '访问权限摘要不可用', accessEmptyDetail: '无法加载角色或权限。', checkPermissionSummary: '检查权限', checkPermissionDetail: '测试此账户是否拥有某项权限', checkPermissionLabel: '检查权限', permissionPlaceholder: 'orders:read', check: '检查', checkingPermission: '正在检查权限',
    sessionCount: (count) => `${count} 个活跃会话`, revokeSessionAria: (sessionId) => `撤销会话 ${sessionId}`, permissionResult: (permission, allowed) => `${permission}：${allowed ? '允许' : '拒绝'}`, profileStatus: (status) => formatProfileStatus(status, 'zh-CN'), errorMessage: () => '无法完成该操作，请重试。', formatDateTime: (value) => formatDateTime(value, 'zh-CN'),
  },
  auth: {
    signIn: '登录', signedInAs: (email) => `已登录为 ${email}`, loadingOptions: '正在加载登录选项…', optionsUnavailable: '暂时无法使用登录选项。', noMethodAvailable: '当前没有可用的登录方式。', identifierLabel: '邮箱或手机号', identifierPlaceholder: '邮箱或手机号', identifierInvalid: '请输入有效的邮箱地址或手机号。', continue: '继续', signingInAs: (identifier) => `正在以 ${identifier} 登录`, change: '更改', noMethodForIdentifier: '此标识没有可用的登录方式。', or: '或', password: '密码', passwordPlaceholder: '请输入您的密码', email: '邮箱', emailPlaceholder: 'you@example.com', phone: '手机号', phonePlaceholder: '手机号', verificationCode: '验证码', verificationCodePlaceholder: '请输入 6 位验证码', sendCode: '发送验证码', resend: '重新发送', resendIn: (seconds) => `${seconds} 秒后重新发送`, verifying: '正在验证…', signInBusy: '正在登录…', forgotPassword: '忘记密码？', providerSignIn: (provider) => `使用 ${provider} 继续`, challengeExpired: '验证码或链接已过期，请重新发送后继续。', magicLinkSent: (email) => `我们已向 ${email} 发送登录链接。`, sendMagicLink: '发送登录链接', sendingMagicLink: '正在发送链接…', resendVerification: '重新发送验证邮件', verificationEmailSent: '验证邮件已发送。', verificationEmailFailed: '无法发送验证邮件，请稍后重试。', sending: '正在发送…', credentialMethod: (method) => ({ password: '密码', email_otp: '邮箱验证码', magic_link: '登录链接', sms: '短信验证码' })[method], redirecting: '正在跳转…', noAccount: '还没有账户？', haveAccount: '已有账户？', signUp: '注册', brandingLoading: '正在加载应用品牌…', brandingUnavailable: '无法加载应用品牌。', retryBranding: '重试品牌加载', logoAlt: '应用标志',
    mfaDescription: '请输入身份验证器中的验证码以完成登录。', authenticatorCode: '身份验证器验证码', verify: '验证并登录', back: '返回',
  },
  authDialog: { close: '关闭认证窗口', signInTab: '已有账户？登录', signUpTab: '还没有账户？注册', title: (view) => view === 'sign-in' ? '登录' : '创建账户' },
  signUp: {
    title: '创建账户', username: '用户名（可选）', usernamePlaceholder: '请输入用户名', email: '邮箱', emailPlaceholder: 'you@example.com', password: '密码', passwordPlaceholder: '至少 8 个字符', confirmPassword: '确认密码', confirmPasswordPlaceholder: '再次输入您的密码', createAccount: '创建账户', creatingAccount: '正在创建账户…', checkEmail: '查看您的邮箱', accountCreated: '账户已创建', accountCreatedDetail: (email) => `${email} 现在可以登录。`, verificationOptional: (email) => `我们已向 ${email} 发送验证邮件。您可以现在登录，并在方便时完成验证。`, verificationRequired: (email) => `我们已向 ${email} 发送验证邮件。请先验证邮箱再登录。`, verificationUnknown: '您的账户已创建。请查看来自此应用的验证邮件。', resendVerification: '重新发送验证邮件', resendIn: (seconds) => `${seconds} 秒后重新发送`, sending: '正在发送…', verificationEmailSent: '验证邮件已发送。', verificationEmailFailed: '无法发送验证邮件，请稍后重试。', accessCodeOptional: '注册访问码（选填）', accessCodeRequired: '注册访问码（必填）', accessCode: '注册访问码', accessCodePlaceholder: '请输入访问码', invitationRequired: '创建账户需要邀请。', invitationOrAccessCodeRequired: '注册需要邀请或注册访问码。', passwordMismatch: '两次输入的密码不一致', passwordMinLength: '密码至少需要 8 个字符',
    passwordRequirements: (minimum, rules) => {
      const required = rules ? [rules.requireUppercase && '大写字母', rules.requireLowercase && '小写字母', rules.requireDigit && '数字', rules.requireSpecialChar && '符号'].filter(Boolean) : []
      return `请使用至少 ${minimum} 个字符${required.length ? `，并包含${required.join('、')}` : ''}。${rules?.breachedPasswordCheck ? '不得使用已知泄露的密码。' : ''}`
    }, unavailable: '暂时无法注册。', grantNotAccepted: '此应用不接受该注册邀请。', signUp: '注册',
  },
  passwordReset: { resetPassword: '重置密码', createNewPassword: '创建新密码', checkEmail: '查看您的邮箱', resetSent: '如果该账户存在，密码重置链接已发送。', email: '邮箱', emailPlaceholder: 'you@example.com', sendResetLink: '发送重置链接', sending: '正在发送…', newPassword: '新密码', passwordPlaceholder: '至少 8 个字符', confirmPassword: '确认密码', confirmPasswordPlaceholder: '再次输入您的密码', resetting: '正在重置…', resetComplete: '密码已重置', resetCompleteDetail: '您的密码已更新，请使用新密码登录。', resetTokenRequired: '需要密码重置令牌', passwordMinLength: '密码至少需要 8 个字符', passwordMismatch: '两次输入的密码不一致', invalidEmail: '请输入有效的邮箱地址' },
  connectedAccounts: { aria: '已关联账户', title: '已关联账户', description: '管理此账户的登录方式。', signInMethods: '登录方式', noSignInMethods: '没有可用的登录方式。', connectAccount: '关联账户', noProviders: '没有可关联的身份提供商。', loading: '正在加载已关联账户', disconnect: '解除关联', disconnecting: '正在解除关联', disconnectAria: (name) => `解除 ${name} 的关联`, connect: '关联', opening: '正在打开', connectAria: (name) => `关联 ${name}`, connected: '已关联', connectedAt: (value) => `关联时间：${value}`, requiredForAccess: '需要保留此方式以确保账户可以登录。', confirmDisconnect: (name) => `解除 ${name} 的关联吗？`, stepUpRequired: '请再次验证后继续。', stepUpRequiredWithMethods: (methods) => `请再次验证后继续。可用方式：${methods}。`, unavailable: '暂时无法使用已关联账户。', credential: '凭据', credentialType: (type) => formatCredentialType(type, 'zh-CN'), providerType: (providerType, protocol) => formatProviderType(providerType, protocol, 'zh-CN'), stepUpMethod: (method) => formatStepUpMethod(method, 'zh-CN') },
  userButton: { menuAria: '用户菜单', fallbackUser: '用户', organization: (slug) => `组织：${slug}`, signOut: '退出登录' },
  userProfile: { title: '个人资料', account: '账户', email: '邮箱', username: '用户名', name: '姓名', organization: '组织', roles: '角色', devices: '设备', lastSeen: (value) => `最近活跃：${value}`, revoke: '撤销', unavailable: '—' },
  organization: { select: '选择组织', switching: '正在切换组织…', switchUnavailable: '无法切换组织', role: (role) => formatOrganizationRole(role, 'zh-CN') },
  invitation: { aria: '组织邀请', title: '组织邀请', join: (organization) => `加入 ${organization}`, detail: (application, email, role) => `${application} 邀请 ${email} 以 ${role} 身份加入。`, loading: '正在加载邀请…', expires: (value) => `过期时间：${value}`, accept: '接受邀请', accepting: '正在接受', accepted: '已接受邀请。', loginRequired: '请登录或创建账户后继续。', invalidEntry: '邀请入口无效，请重新打开原始邀请。', unknownResult: '提交响应丢失，请先查询结果，不要重复提交。', retryPreparation: '重新加载邀请', preparationNotSubmitted: '尚未交换邀请入口，请重新加载后继续。', navigationFailed: '邀请已完成，但无法打开后续页面。', accountKept: '账户已保留，您尚未加入组织。', applicationLabel: '应用', roleLabel: '角色', recipientLabel: '受邀邮箱', enrollmentRequired: '请设置允许的验证器以验证本账户，之后仍需单独确认邀请。', explicitConfirmation: '创建账户不会接受邀请。完成验证后，仍需单独确认。', reviewChanges: '查看更新后的邀请', cancel: '取消邀请', checkResult: '查询邀请结果', checkRegistration: '查询注册状态', navigate: '前往应用', switchAccount: '切换账户', loginCompleted: '我已完成登录', mfaMethod: '验证方式', recoveryCode: '恢复码', useSession: '使用当前登录账户', terminal: (state) => ({ CANCELLED: '邀请已取消。', EXPIRED: '邀请已过期。', REVOKED: '邀请已撤销。', UNAVAILABLE: '邀请不可用。' })[state] ?? '邀请不可用。' },
  errors: { generic: '发生了错误，请重试。', signInOptionsUnavailable: '暂时无法使用登录选项。', signInFailed: '登录失败，请重试。', signUpFailed: '无法创建账户，请重试。', resetRequestFailed: '无法请求密码重置，请重试。', resetFailed: '无法重置密码，请重试。', invitationFailed: '无法处理此邀请，请重试。', organizationSwitchFailed: '无法切换组织，请重试。', accountLinkFailed: '无法关联此账户，请重试。', accountUnlinkFailed: '无法解除此账户关联，请重试。', codes: { REGISTRATION_IDENTIFIER_REJECTED: '此地址不能用于注册。请更换地址或联系支持人员。', INVALID_CREDENTIALS: '邮箱、手机号或密码不正确。', EMAIL_VERIFICATION_REQUIRED: '请先验证邮箱再登录。', EMAIL_ALREADY_EXISTS: '该邮箱地址已存在账户。', PASSWORD_RESET_INVALID: '此密码重置链接无效。', PASSWORD_RESET_EXPIRED: '此密码重置链接已过期。', REGISTRATION_GRANT_INVALID: '此注册邀请或访问码无效。', REGISTRATION_GRANT_REQUIRED: '注册需要邀请或注册访问码。', REGISTRATION_GRANT_TYPE_NOT_ALLOWED: '此注册邀请或访问码不可用。', REGISTRATION_GRANT_HOSTED_UNSUPPORTED: '此注册邀请或访问码不可用。', REGISTRATION_DISABLED: '此注册邀请或访问码不可用。', INVITATION_INVALID: '此邀请无效。', INVITATION_EXPIRED: '此邀请已过期。', STEP_UP_REQUIRED: '请再次验证后继续。', RATE_LIMITED: '请求过于频繁，请稍后重试。', UNAUTHORIZED: '请登录后重试。', FORBIDDEN: '您没有执行此操作的权限。' } },
}

export function resolveIamLocalization(locale: IamLocale | undefined, overrides?: PartialIamLocalization): { locale: 'en' | 'zh-CN'; localization: IamLocalization; unsupported: boolean } {
  const normalized = normalizeIamLocale(locale)
  const base = normalized.locale === 'zh-CN' ? iamLocalizationZhCN : iamLocalizationEnglish
  return { locale: normalized.locale, unsupported: normalized.unsupported, localization: mergeDefined<IamLocalization>(base, overrides) }
}

export function normalizeIamLocale(locale: IamLocale | undefined): { locale: 'en' | 'zh-CN'; unsupported: boolean } {
  const value = locale?.trim().toLowerCase()
  if (!value || value === 'en' || value.startsWith('en-')) return { locale: 'en', unsupported: false }
  if (value === 'zh' || value === 'zh-hans' || value === 'zh-cn') return { locale: 'zh-CN', unsupported: false }
  return { locale: 'en', unsupported: true }
}

export function localizeError(error: unknown, localization: IamLocalization, fallback: keyof IamLocalization['errors'] = 'generic'): string {
  const code = errorCode(error)
  if (code) return localization.errors.codes[code]
  const message = localization.errors[fallback]
  return typeof message === 'string' ? message : localization.errors.generic
}

function errorCode(error: unknown): ErrorCode | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as { code?: unknown }).code
  if (typeof value === 'string' && value in iamLocalizationEnglish.errors.codes) return value as ErrorCode
  const status = (error as { status?: unknown }).status
  if (status === 429) return 'RATE_LIMITED'
  if (status === 401) return 'UNAUTHORIZED'
  if (status === 403) return 'FORBIDDEN'
  return null
}

function mergeDefined<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (!overrides) return base
  const result = { ...base } as Record<string, unknown>
  for (const [key, override] of Object.entries(overrides)) {
    if (override === undefined) continue
    const value = (base as Record<string, unknown>)[key]
    result[key] = isPlainObject(value) && isPlainObject(override)
      ? mergeDefined(value, override)
      : override
  }
  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatDateTime(value: string, locale: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatProfileStatus(status: string, locale: 'en' | 'zh-CN'): string {
  const labels: Record<string, readonly [string, string]> = {
    ACTIVE: ['Active', '正常'],
    PENDING: ['Pending', '待验证'],
    INACTIVE: ['Inactive', '未激活'],
    DISABLED: ['Disabled', '已禁用'],
    SUSPENDED: ['Suspended', '已暂停'],
    LOCKED: ['Locked', '已锁定'],
    DELETED: ['Deleted', '已删除'],
    INVITED: ['Invited', '已邀请'],
  }
  const label = labels[status.toUpperCase()]
  return label ? label[locale === 'zh-CN' ? 1 : 0] : locale === 'zh-CN' ? '未知状态' : 'Unknown status'
}

function formatCredentialType(type: string | null | undefined, locale: 'en' | 'zh-CN'): string {
  const labels: Record<string, readonly [string, string]> = {
    PASSWORD: ['Password', '密码'],
    RECOVERY_CODE: ['Recovery code', '恢复代码'],
    TOTP: ['Authenticator app', '身份验证器应用'],
    WEBAUTHN: ['Passkey', '通行密钥'],
    PASSKEY: ['Passkey', '通行密钥'],
    SMS: ['SMS code', '短信验证码'],
    EMAIL_OTP: ['Email code', '邮箱验证码'],
  }
  const label = type ? labels[type.toUpperCase()] : undefined
  return label ? label[locale === 'zh-CN' ? 1 : 0] : locale === 'zh-CN' ? '凭据' : 'Credential'
}

function formatProviderType(providerType: string | null | undefined, protocol: string | null | undefined, locale: 'en' | 'zh-CN'): string {
  const providers: Record<string, readonly [string, string]> = {
    GOOGLE: ['Google', 'Google'],
    GITHUB: ['GitHub', 'GitHub'],
    WECHAT: ['WeChat', '微信'],
    ENTERPRISE_WECHAT: ['Enterprise WeChat', '企业微信'],
    SAML: ['SAML single sign-on', 'SAML 单点登录'],
    OIDC: ['OpenID Connect provider', 'OpenID Connect 身份提供商'],
  }
  const protocols: Record<string, string> = {
    OIDC: 'OpenID Connect',
    OAUTH2: 'OAuth 2.0',
    SAML: 'SAML',
  }
  const provider = providerType ? providers[providerType.toUpperCase()] : undefined
  if (!provider) return locale === 'zh-CN' ? '身份提供商' : 'Identity provider'
  if (providerType?.toUpperCase() === 'SAML') return provider[locale === 'zh-CN' ? 1 : 0]
  const protocolLabel = protocol ? protocols[protocol.toUpperCase()] : undefined
  if (!protocolLabel) return locale === 'zh-CN' ? `${provider[1]} 身份提供商` : `${provider[0]} provider`
  return locale === 'zh-CN'
    ? `${provider[1]}（${protocolLabel}）`
    : `${provider[0]} (${protocolLabel})`
}

function formatStepUpMethod(method: string | null | undefined, locale: 'en' | 'zh-CN'): string {
  const labels: Record<string, readonly [string, string]> = {
    TOTP: ['Authenticator app', '身份验证器应用'],
    PASSWORD: ['Password', '密码'],
    SMS: ['SMS code', '短信验证码'],
    SMS_OTP: ['SMS code', '短信验证码'],
    EMAIL_OTP: ['Email code', '邮箱验证码'],
    WEBAUTHN: ['Passkey', '通行密钥'],
    PASSKEY: ['Passkey', '通行密钥'],
    RECOVERY_CODE: ['Recovery code', '恢复代码'],
    MAGIC_LINK: ['Email link', '邮箱登录链接'],
  }
  const label = method ? labels[method.toUpperCase()] : undefined
  return label ? label[locale === 'zh-CN' ? 1 : 0] : locale === 'zh-CN' ? '验证方式' : 'Verification method'
}

function formatOrganizationRole(role: string | null | undefined, locale: 'en' | 'zh-CN'): string {
  const labels: Record<string, readonly [string, string]> = {
    OWNER: ['Owner', '所有者'],
    ADMIN: ['Administrator', '管理员'],
    MEMBER: ['Member', '成员'],
    VIEWER: ['Viewer', '查看者'],
  }
  const label = role ? labels[role.toUpperCase()] : undefined
  return label ? label[locale === 'zh-CN' ? 1 : 0] : locale === 'zh-CN' ? '成员' : 'Member'
}
