import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { AccountUpdateProfileInput } from '../core/types'
import { useAccountProfile } from '../hooks/useAccountProfile'
import { useAccountSecurity } from '../hooks/useAccountSecurity'
import { usePrimaryEmail } from '../hooks/usePrimaryEmail'
import { AccountCenterSurface, AccountEmpty, AccountError, AccountLoading } from './AccountCenterSurface'
import { resolveAccountCenterLocalization, useAccountCenterAppearance } from './accountCenterConfig'
import type { AccountCenterColorScheme, AccountCenterLocalization } from './accountCenterConfig'
import type { Appearance } from './styles'
import { mergeAppearances } from './styles'
import { useIamUi } from '../provider/IamUiProvider'

export interface AccountProfilePanelProps {
  appearance?: Appearance
  colorScheme?: AccountCenterColorScheme
  darkAppearance?: Appearance
  localization?: Partial<AccountCenterLocalization>
  editable?: boolean
  onUpdated?: () => void | Promise<void>
  className?: string
  style?: CSSProperties
}

export function AccountProfilePanel({
  appearance,
  colorScheme,
  darkAppearance,
  localization,
  editable = true,
  onUpdated,
  className,
  style,
}: AccountProfilePanelProps) {
  const ui = useIamUi()
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const l = resolveAccountCenterLocalization(localization, undefined, ui.localization.accountCenter)
  const { profile, isLoading, isUpdating, error, refetch: refetchProfile, updateProfile } = useAccountProfile()
  const { security, isLoading: isSecurityLoading, error: securityError, refetch: refetchSecurity } = useAccountSecurity()
  const [form, setForm] = useState<AccountUpdateProfileInput>({})
  const [saved, setSaved] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [factsRevision, refreshFacts] = useState(0)
  const primaryEmail = usePrimaryEmail(factsRevision)

  useEffect(() => {
    if (!profile) return
    setForm({
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    })
    setAvatarFailed(false)
  }, [profile])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    await updateProfile(form)
    setSaved(true)
    await onUpdated?.()
  }

  function retry() {
    refreshFacts((revision) => revision + 1)
    void Promise.all([refetchProfile(), refetchSecurity()])
  }

  const identity = profile?.displayName || profile?.username || primaryEmail.email?.displayValue || l.accountFallback
  const initials = getInitials(identity)

  return (
    <AccountCenterSurface
      appearance={a}
      colorScheme={resolvedColorScheme}
      ariaLabel={l.profileAria}
      title={l.profileSection}
      description={l.profileDescription}
      className={className}
      style={style}
      componentCss={profileCss}
    >
      {(error || securityError || primaryEmail.error) && (
        <AccountError
          message={l.errorMessage((error ?? securityError ?? primaryEmail.error)!.message)}
          localization={l}
          onRetry={retry}
          busy={isLoading || isSecurityLoading}
        />
      )}

      {isLoading && !profile ? (
        <AccountLoading label={l.profileLoading} rows={4} />
      ) : error && !profile ? (
        null
      ) : profile ? (
        <>
          <div className="axis-iam-profile-identity">
            <div className="axis-iam-profile-avatar" aria-hidden="true">
              {profile.avatarUrl && !avatarFailed ? (
                <img src={profile.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
              ) : initials}
            </div>
            <div className="axis-iam-profile-identity-copy">
              <strong>{identity}</strong>
              {primaryEmail.email && <span>{primaryEmail.email.displayValue}</span>}
              <div className="axis-iam-profile-statuses">
                {primaryEmail.email && <span data-status={primaryEmail.email.verificationState === 'VERIFIED' ? 'success' : primaryEmail.email.verificationState === 'UNVERIFIED' ? 'warning' : undefined}>
                  {primaryEmail.email.verificationState === 'VERIFIED' ? l.emailVerified : primaryEmail.email.verificationState === 'UNVERIFIED' ? l.emailNotVerified : ui.localization.identity.verificationUnknown}
                </span>}
                <span>{l.profileStatus(profile.status)}</span>
              </div>
            </div>
          </div>

          {saved && <div className="axis-iam-account-notice axis-iam-account-notice-success" role="status">{l.profileSaved}</div>}

          <form className="axis-iam-profile-form" onSubmit={(event) => { void submit(event).catch(() => undefined) }}>
            <div className="axis-iam-account-field">
              <label htmlFor="iam-account-display-name">{l.displayName}</label>
              <input
                className="axis-iam-account-input"
                id="iam-account-display-name"
                value={form.displayName ?? ''}
                disabled={!editable || isUpdating}
                onChange={(event) => {
                  setSaved(false)
                  setForm((current) => ({ ...current, displayName: event.target.value || null }))
                }}
              />
            </div>
            <div className="axis-iam-account-field axis-iam-profile-avatar-field">
              <label htmlFor="iam-account-avatar">{l.avatarUrl}</label>
              <input
                className="axis-iam-account-input"
                id="iam-account-avatar"
                type="url"
                value={form.avatarUrl ?? ''}
                disabled={!editable || isUpdating}
                onChange={(event) => {
                  setSaved(false)
                  setForm((current) => ({ ...current, avatarUrl: event.target.value || null }))
                }}
              />
            </div>

            {editable && (
              <div className="axis-iam-profile-actions">
                <button className="axis-iam-account-primary-button" type="submit" disabled={isUpdating}>
                  {isUpdating ? l.savingProfile : l.saveProfile}
                </button>
              </div>
            )}
          </form>

          <div className="axis-iam-profile-security">
            <h3>{l.securityOverview}</h3>
            {isSecurityLoading && !security ? (
              <AccountLoading label={l.securityLoading} rows={2} />
            ) : security ? (
              <dl>
                <SummaryItem label={l.passwordSection} value={security.passwordCredentialPresent ? l.configured : l.notConfigured} tone={security.passwordCredentialPresent ? 'success' : 'warning'} />
                <SummaryItem label={l.multiFactorAuthentication} value={security.mfaEnrolled ? l.enabled : l.notEnabled} tone={security.mfaEnrolled ? 'success' : 'warning'} />
                <SummaryItem label={l.activeSessions} value={String(security.activeSessionCount)} />
              </dl>
            ) : (
              <p className="axis-iam-account-muted">{l.securityUnavailable}</p>
            )}
          </div>
        </>
      ) : (
        <AccountEmpty title={l.profileEmptyTitle} detail={l.profileEmptyDetail} localization={l} onRetry={retry} />
      )}
    </AccountCenterSurface>
  )
}

function SummaryItem({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd data-tone={tone}>{value}</dd>
    </div>
  )
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'A'
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''}`.toUpperCase()
}

const profileCss = `.axis-iam-profile-identity{display:flex;align-items:center;gap:14px;min-width:0;margin-bottom:22px;padding:16px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}.axis-iam-profile-avatar{display:grid;place-items:center;flex:none;width:56px;height:56px;overflow:hidden;border:1px solid var(--a-border);border-radius:50%;color:var(--a-primary);font-weight:800}.axis-iam-profile-identity-copy{display:grid;gap:2px;min-width:0}.axis-iam-profile-identity-copy strong,.axis-iam-profile-identity-copy>span{min-width:0;overflow-wrap:anywhere}.axis-iam-profile-statuses{display:flex;flex-wrap:wrap;gap:5px 12px;margin-top:3px;font-size:11px}.axis-iam-profile-statuses span[data-status=success],.axis-iam-profile-security dd[data-tone=success]{color:var(--a-success)}.axis-iam-profile-statuses span[data-status=warning],.axis-iam-profile-security dd[data-tone=warning]{color:var(--a-warning)}.axis-iam-profile-form{display:grid;gap:14px}.axis-iam-profile-actions{display:flex;justify-content:flex-end;margin-top:2px}.axis-iam-profile-security{margin-top:24px;padding-top:20px;border-top:1px solid var(--a-border)}.axis-iam-profile-security h3{margin:0 0 12px;font-size:15px}.axis-iam-profile-security dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0}.axis-iam-profile-security dl>div{min-width:0;padding-left:10px;border-left:2px solid var(--a-border)}.axis-iam-profile-security dt{overflow-wrap:anywhere;font-size:12px}.axis-iam-profile-security dd{margin:3px 0 0;overflow-wrap:anywhere;font-weight:700}`
