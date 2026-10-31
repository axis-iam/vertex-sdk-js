import type { CSSProperties } from 'react'
import type { Appearance } from './styles'
import { useResolvedAppearance } from './styles'

export type AccountCenterColorScheme = 'light' | 'dark' | 'system'

export interface AccountCenterLocalization {
  title: string
  close: string
  sectionsAria: string
  menu: string
  back: string
  securitySection: string
  profileSection: string
  passwordSection: string
  sessionsSection: string
  permissionsSection: string
  retry: string
  retrying: string
  profileAria: string
  profileDescription: string
  accountFallback: string
  profileLoading: string
  emailVerified: string
  emailNotVerified: string
  profileSaved: string
  displayName: string
  username: string
  avatarUrl: string
  saveProfile: string
  savingProfile: string
  securityOverview: string
  securityLoading: string
  configured: string
  notConfigured: string
  multiFactorAuthentication: string
  enabled: string
  notEnabled: string
  activeSessions: string
  securityUnavailable: string
  profileEmptyTitle: string
  profileEmptyDetail: string
  passwordAria: string
  passwordDescription: string
  passwordRequiredError: string
  passwordMismatchError: string
  passwordChanged: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
  passwordHelp: string
  changePassword: string
  changingPassword: string
  sessionsAria: string
  sessionsDescription: string
  sessionsLoading: string
  noSessionsTitle: string
  noSessionsDetail: string
  unknownDevice: string
  currentDevice: string
  ipAddress: string
  unknownValue: string
  lastActive: string
  signedIn: string
  revokeCurrentSession: string
  revokeSession: string
  sessionControls: string
  sessionControlsDetail: string
  revokeOtherSessions: string
  revokingOtherSessions: string
  logOut: string
  loggingOut: string
  permissionsAria: string
  permissionsTitle: string
  permissionsDescription: string
  permissionRequiredError: string
  permissionsLoading: string
  role: string
  roles: string
  permissions: string
  organization: string
  noRoles: string
  grantedPermissions: string
  noPermissions: string
  accessEmptyTitle: string
  accessEmptyDetail: string
  checkPermissionSummary: string
  checkPermissionDetail: string
  checkPermissionLabel: string
  permissionPlaceholder: string
  check: string
  checkingPermission: string
  sessionCount: (count: number) => string
  revokeSessionAria: (sessionId: string) => string
  permissionResult: (permission: string, allowed: boolean) => string
  profileStatus: (status: string) => string
  errorMessage: (message: string) => string
  formatDateTime: (value: string) => string
}

export const accountCenterEnglish: AccountCenterLocalization = {
  title: 'Account center', close: 'Close account center', sectionsAria: 'Account sections', menu: 'Account', back: 'Menu',
  securitySection: 'Security', profileSection: 'Profile', passwordSection: 'Password', sessionsSection: 'Sessions', permissionsSection: 'Permissions', retry: 'Retry', retrying: 'Retrying',
  profileAria: 'Account profile', profileDescription: 'Identity and account', accountFallback: 'Account',
  profileLoading: 'Loading profile', emailVerified: 'Email verified', emailNotVerified: 'Email not verified',
  profileSaved: 'Profile saved', displayName: 'Display name', username: 'Username', avatarUrl: 'Avatar URL', saveProfile: 'Save profile', savingProfile: 'Saving profile',
  securityOverview: 'Security overview', securityLoading: 'Loading security', configured: 'Configured', notConfigured: 'Not configured',
  multiFactorAuthentication: 'Multi-factor authentication', enabled: 'Enabled', notEnabled: 'Not enabled', activeSessions: 'Active sessions',
  securityUnavailable: 'Security details unavailable', profileEmptyTitle: 'Profile unavailable', profileEmptyDetail: 'Account details could not be loaded',
  passwordAria: 'Password change', passwordDescription: 'Change your password',
  passwordRequiredError: 'Enter current and new passwords', passwordMismatchError: 'New passwords do not match', passwordChanged: 'Password changed',
  currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password',
  passwordHelp: 'Passwords are sent only on submit', changePassword: 'Change password', changingPassword: 'Changing password',
  sessionsAria: 'Account sessions', sessionsDescription: 'Signed-in devices', sessionsLoading: 'Loading sessions',
  noSessionsTitle: 'No active sessions', noSessionsDetail: 'No signed-in devices found', unknownDevice: 'Unknown device', currentDevice: 'Current device',
  ipAddress: 'IP address', unknownValue: 'Unknown', lastActive: 'Last active', signedIn: 'Signed in', revokeCurrentSession: 'Revoke current session', revokeSession: 'Revoke session',
  sessionControls: 'Session controls', sessionControlsDetail: 'Revoked devices must sign in again.', revokeOtherSessions: 'Revoke other sessions',
  revokingOtherSessions: 'Revoking other sessions', logOut: 'Log out', loggingOut: 'Logging out',
  permissionsAria: 'Account permissions', permissionsTitle: 'Access', permissionsDescription: 'Roles and permissions',
  permissionRequiredError: 'Permission is required', permissionsLoading: 'Loading permissions', role: 'Role', roles: 'Roles', permissions: 'Permissions', organization: 'Organization',
  noRoles: 'No roles assigned.', grantedPermissions: 'Granted permissions', noPermissions: 'No permissions granted.',
  accessEmptyTitle: 'Access summary unavailable', accessEmptyDetail: 'We could not load roles or permissions.', checkPermissionSummary: 'Check a permission',
  checkPermissionDetail: 'Test whether this account has a permission', checkPermissionLabel: 'Check permission', permissionPlaceholder: 'orders:read',
  check: 'Check', checkingPermission: 'Checking permission',
  sessionCount: (count) => `${count} active ${count === 1 ? 'session' : 'sessions'}`,
  revokeSessionAria: (sessionId) => `Revoke session ${sessionId}`,
  permissionResult: (permission, allowed) => `${permission}: ${allowed ? 'Allowed' : 'Denied'}`,
  profileStatus: formatEnglishProfileStatus,
  errorMessage: () => 'We could not complete that action. Please try again.',
  formatDateTime: (value) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  },
}

type LegacyLabels = Partial<Record<'profile' | 'password' | 'security' | 'sessions' | 'permissions' | 'title' | 'close' | 'menu' | 'back', string>>

export function resolveAccountCenterLocalization(localization?: Partial<AccountCenterLocalization>, labels?: LegacyLabels, base: AccountCenterLocalization = accountCenterEnglish): AccountCenterLocalization {
  const resolved = { ...base }
  if (localization) {
    for (const key of Object.keys(localization) as (keyof AccountCenterLocalization)[]) {
      const value = localization[key]
      if (value !== undefined) Object.assign(resolved, { [key]: value })
    }
  }
  if (labels) {
    const { profile, password, security, sessions, permissions, ...outer } = labels
    for (const [key, value] of Object.entries(outer)) {
      if (value !== undefined) Object.assign(resolved, { [key]: value })
    }
    if (security !== undefined) resolved.securitySection = security
    if (profile !== undefined) resolved.profileSection = profile
    if (password !== undefined) resolved.passwordSection = password
    if (sessions !== undefined) resolved.sessionsSection = sessions
    if (permissions !== undefined) resolved.permissionsSection = permissions
  }
  return resolved
}

export function useAccountCenterAppearance(colorScheme: AccountCenterColorScheme = 'light', appearance?: Appearance, darkAppearance?: Appearance) {
  return useResolvedAppearance(colorScheme, appearance, darkAppearance)
}

export function accountCenterVariables(a: Required<Appearance>): CSSProperties {
  return {
    '--a-primary': a.primaryColor, '--a-text': a.textColor, '--a-muted': a.mutedTextColor,
    '--a-surface': a.surfaceColor, '--a-subtle': a.subtleColor, '--a-border': a.borderColor,
    '--a-input': a.inputBackgroundColor, '--a-success': a.successColor, '--a-warning': a.warningColor,
    '--a-danger': a.dangerColor, '--a-focus': a.focusColor, '--a-radius': a.borderRadius,
    fontFamily: a.fontFamily, color: a.textColor, background: a.surfaceColor,
  } as CSSProperties
}

function formatEnglishProfileStatus(status: string): string {
  const labels: Record<string, string> = {
    ACTIVE: 'Active', PENDING: 'Pending', INACTIVE: 'Inactive', DISABLED: 'Disabled',
    SUSPENDED: 'Suspended', LOCKED: 'Locked', DELETED: 'Deleted', INVITED: 'Invited',
  }
  return labels[status.toUpperCase()] ?? 'Unknown status'
}
