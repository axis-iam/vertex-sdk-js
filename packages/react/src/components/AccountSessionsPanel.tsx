import type { CSSProperties } from 'react'
import type { AccountSession } from '../core/types'
import { useAccountSessions } from '../hooks/useAccountSessions'
import { AccountCenterSurface, AccountEmpty, AccountError, AccountLoading } from './AccountCenterSurface'
import { resolveAccountCenterLocalization, useAccountCenterAppearance } from './accountCenterConfig'
import type { AccountCenterColorScheme, AccountCenterLocalization } from './accountCenterConfig'
import type { Appearance } from './styles'
import { mergeAppearances } from './styles'
import { useIamUi } from '../provider/IamUiProvider'

export interface AccountSessionsPanelProps {
  appearance?: Appearance
  colorScheme?: AccountCenterColorScheme
  darkAppearance?: Appearance
  localization?: Partial<AccountCenterLocalization>
  showLogout?: boolean
  onSessionRevoked?: (session: AccountSession) => void | Promise<void>
  onOtherSessionsRevoked?: () => void | Promise<void>
  onLoggedOut?: () => void | Promise<void>
  className?: string
  style?: CSSProperties
}

export function AccountSessionsPanel({
  appearance,
  colorScheme,
  darkAppearance,
  localization,
  showLogout = true,
  onSessionRevoked,
  onOtherSessionsRevoked,
  onLoggedOut,
  className,
  style,
}: AccountSessionsPanelProps) {
  const ui = useIamUi()
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const l = resolveAccountCenterLocalization(localization, undefined, ui.localization.accountCenter)
  const {
    sessions,
    isLoading,
    isRevoking,
    isRevokingOthers,
    isLoggingOut,
    error,
    refetch,
    revokeSession,
    revokeOtherSessions,
    logoutAccount,
  } = useAccountSessions()
  const orderedSessions = [...sessions].sort((left, right) => Number(right.current) - Number(left.current))
  const hasOtherSessions = sessions.some((session) => !session.current)
  const busy = isRevoking || isRevokingOthers || isLoggingOut

  async function revoke(session: AccountSession) {
    await revokeSession(session.sessionId)
    await onSessionRevoked?.(session)
  }

  async function revokeOthers() {
    await revokeOtherSessions()
    await onOtherSessionsRevoked?.()
  }

  async function logout() {
    await logoutAccount()
    await onLoggedOut?.()
  }

  return (
    <AccountCenterSurface
      appearance={a}
      colorScheme={resolvedColorScheme}
      ariaLabel={l.sessionsAria}
      title={l.sessionsSection}
      description={l.sessionsDescription}
      className={className}
      style={style}
      componentCss={sessionsCss}
      headerMeta={<span className="axis-iam-account-count" aria-label={l.sessionCount(sessions.length)}>{sessions.length}</span>}
    >
      {error && <AccountError message={l.errorMessage(error.message)} localization={l} onRetry={() => { void refetch() }} busy={isLoading} />}

      {isLoading && sessions.length === 0 ? (
        <AccountLoading label={l.sessionsLoading} rows={3} />
      ) : error && sessions.length === 0 ? (
        null
      ) : sessions.length === 0 ? (
        <AccountEmpty title={l.noSessionsTitle} detail={l.noSessionsDetail} localization={l} onRetry={() => { void refetch() }} />
      ) : (
        <ul className="axis-iam-session-list">
          {orderedSessions.map((session) => (
            <li key={session.sessionId} className="axis-iam-session-item" data-current={session.current}>
              <div className="axis-iam-session-main">
                <div className="axis-iam-session-title-row">
                  <strong title={session.userAgent || session.deviceId || l.unknownDevice}>{session.userAgent || session.deviceId || l.unknownDevice}</strong>
                  {session.current && <span className="axis-iam-session-current">{l.currentDevice}</span>}
                </div>
                <dl className="axis-iam-session-metadata">
                  <SessionFact label={l.ipAddress} value={session.ipAddress ?? l.unknownValue} />
                  <SessionFact label={l.lastActive} value={l.formatDateTime(session.lastSeenAt)} />
                  <SessionFact label={l.signedIn} value={l.formatDateTime(session.createdAt)} />
                </dl>
              </div>
              <button
                className="axis-iam-account-danger-button axis-iam-session-revoke"
                type="button"
                aria-label={l.revokeSessionAria(session.sessionId)}
                disabled={busy}
                onClick={() => { void revoke(session).catch(() => undefined) }}
              >
                {session.current ? l.revokeCurrentSession : l.revokeSession}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(sessions.length > 0 || showLogout) && (
        <div className="axis-iam-session-danger-zone">
          <div>
            <strong>{l.sessionControls}</strong>
            <span>{l.sessionControlsDetail}</span>
          </div>
          <div className="axis-iam-session-danger-actions">
            <button
              className="axis-iam-account-danger-button"
              type="button"
              disabled={!hasOtherSessions || busy}
              onClick={() => { void revokeOthers().catch(() => undefined) }}
            >
              {isRevokingOthers ? l.revokingOtherSessions : l.revokeOtherSessions}
            </button>
            {showLogout && (
              <button
                className="axis-iam-account-danger-button"
                data-filled="true"
                type="button"
                disabled={busy}
                onClick={() => { void logout().catch(() => undefined) }}
              >
                {isLoggingOut ? l.loggingOut : l.logOut}
              </button>
            )}
          </div>
        </div>
      )}
    </AccountCenterSurface>
  )
}

function SessionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  )
}

const sessionsCss = `.axis-iam-session-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.axis-iam-session-item{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px;min-width:0;padding:15px 16px;border:1px solid var(--a-border);border-radius:var(--a-radius)}.axis-iam-session-item[data-current=true]{background:var(--a-subtle)}.axis-iam-session-main{display:grid;gap:10px}.axis-iam-session-title-row,.axis-iam-session-metadata,.axis-iam-session-danger-actions{display:flex;flex-wrap:wrap;gap:8px 16px}.axis-iam-session-title-row strong,.axis-iam-session-metadata dd{min-width:0;overflow-wrap:anywhere}.axis-iam-session-current{color:var(--a-success);font-size:12px;font-weight:700}.axis-iam-session-metadata{margin:0}.axis-iam-session-metadata>div{min-width:100px}.axis-iam-session-metadata dt,.axis-iam-session-danger-zone span{display:block;color:var(--a-muted)}.axis-iam-session-metadata dd{margin:3px 0 0;font-size:13px}.axis-iam-session-danger-zone{display:grid;gap:12px;margin-top:22px;padding-top:18px;border-top:1px solid var(--a-border)}.axis-iam-session-danger-zone>div:first-child{display:grid;gap:4px}.axis-iam-session-danger-actions{justify-content:flex-end}@container(max-width:560px){.axis-iam-session-item{grid-template-columns:1fr}.axis-iam-session-revoke{justify-self:start}.axis-iam-session-danger-actions{justify-content:flex-start}.axis-iam-session-danger-actions button{width:auto}}`
