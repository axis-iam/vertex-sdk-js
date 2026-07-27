import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useAccountPermissions } from '../hooks/useAccountPermissions'
import { AccountCenterSurface, AccountEmpty, AccountError, AccountLoading } from './AccountCenterSurface'
import { resolveAccountCenterLocalization, useAccountCenterAppearance } from './accountCenterConfig'
import type { AccountCenterColorScheme, AccountCenterLocalization } from './accountCenterConfig'
import type { Appearance } from './styles'
import { mergeAppearances } from './styles'
import { useIamUi } from '../provider/IamUiProvider'

export interface AccountPermissionsPanelProps {
  appearance?: Appearance
  colorScheme?: AccountCenterColorScheme
  darkAppearance?: Appearance
  localization?: Partial<AccountCenterLocalization>
  organizationId?: string | null
  onChecked?: (permission: string, allowed: boolean) => void | Promise<void>
  className?: string
  style?: CSSProperties
}

export function AccountPermissionsPanel({
  appearance,
  colorScheme,
  darkAppearance,
  localization,
  organizationId = null,
  onChecked,
  className,
  style,
}: AccountPermissionsPanelProps) {
  const ui = useIamUi()
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const l = resolveAccountCenterLocalization(localization, undefined, ui.localization.accountCenter)
  const { summary, lastCheck, isLoading, isChecking, error, refetch, checkPermission } = useAccountPermissions({ organizationId })
  const [permission, setPermission] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const requested = permission.trim()
    if (!requested) {
      setFormError(l.permissionRequiredError)
      return
    }

    setFormError(null)
    const response = await checkPermission({ permission: requested, organizationId })
    await onChecked?.(requested, response.allowed)
  }

  const safeError = formError ?? error?.message ?? null

  return (
    <AccountCenterSurface
      appearance={a}
      colorScheme={resolvedColorScheme}
      ariaLabel={l.permissionsAria}
      title={l.permissionsTitle}
      description={l.permissionsDescription}
      className={className}
      style={style}
      componentCss={permissionsCss}
    >
      {safeError && (
        <AccountError
          message={error?.message ? l.errorMessage(safeError) : safeError}
          localization={l}
          onRetry={formError ? undefined : () => { void refetch(organizationId) }}
          busy={isLoading}
        />
      )}

      {isLoading && !summary ? (
        <AccountLoading label={l.permissionsLoading} rows={4} />
      ) : error && !summary ? (
        null
      ) : summary ? (
        <>
          <div className="axis-iam-permission-overview">
            <div><strong>{summary.roles.length}</strong><span>{summary.roles.length === 1 ? l.role : l.roles}</span></div>
            <div><strong>{summary.permissions.length}</strong><span>{l.permissions}</span></div>
            {summary.organizationId && <div className="axis-iam-permission-context"><span>{l.organization}</span><strong title={summary.organizationId}>{summary.organizationId}</strong></div>}
          </div>

          <div className="axis-iam-permission-section">
            <h3>{l.roles}</h3>
            {summary.roles.length === 0 ? (
              <p className="axis-iam-account-muted">{l.noRoles}</p>
            ) : (
              <ul className="axis-iam-role-list">
                {summary.roles.map((role) => <li key={role} title={role}>{role}</li>)}
              </ul>
            )}
          </div>

          <div className="axis-iam-permission-section">
            <h3>{l.grantedPermissions}</h3>
            {summary.permissions.length === 0 ? (
              <p className="axis-iam-account-muted">{l.noPermissions}</p>
            ) : (
              <ul className="axis-iam-permission-list">
                {summary.permissions.map((value) => <li key={value}><code title={value}>{value}</code></li>)}
              </ul>
            )}
          </div>
        </>
      ) : (
        <AccountEmpty title={l.accessEmptyTitle} detail={l.accessEmptyDetail} localization={l} onRetry={() => { void refetch(organizationId) }} />
      )}

      <details className="axis-iam-permission-checker">
        <summary>{l.checkPermissionSummary}</summary>
        <p>{l.checkPermissionDetail}</p>
        <form onSubmit={(event) => { void submit(event).catch(() => undefined) }}>
          <div className="axis-iam-account-field">
            <label htmlFor="iam-permission-check">{l.checkPermissionLabel}</label>
            <input
              className="axis-iam-account-input"
              id="iam-permission-check"
              value={permission}
              disabled={isChecking}
              placeholder={l.permissionPlaceholder}
              onChange={(event) => {
                setFormError(null)
                setPermission(event.target.value)
              }}
            />
          </div>
          <button className="axis-iam-account-secondary-button" type="submit" disabled={isChecking}>
            {isChecking ? l.checkingPermission : l.check}
          </button>
        </form>

        {lastCheck && (
          <div className="axis-iam-permission-result" role="status" data-allowed={lastCheck.allowed}>
            <code title={l.permissionResult(lastCheck.permission, lastCheck.allowed)}>{l.permissionResult(lastCheck.permission, lastCheck.allowed)}</code>
          </div>
        )}
      </details>
    </AccountCenterSurface>
  )
}

const permissionsCss = `.axis-iam-permission-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) minmax(0,2fr);gap:8px;margin-bottom:22px}.axis-iam-permission-overview>div{display:grid;align-content:center;min-width:0;padding:12px 14px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}.axis-iam-permission-overview strong,.axis-iam-permission-list code,.axis-iam-permission-context strong{min-width:0;overflow-wrap:anywhere}.axis-iam-permission-overview span,.axis-iam-permission-checker>p{color:var(--a-muted)}.axis-iam-permission-section+.axis-iam-permission-section{margin-top:20px}.axis-iam-permission-section h3{margin:0 0 9px;font-size:15px}.axis-iam-role-list,.axis-iam-permission-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:7px;margin:0;padding:0;list-style:none}.axis-iam-role-list li,.axis-iam-permission-list li{min-width:0;padding:8px 10px;overflow-wrap:anywhere;border-left:2px solid var(--a-primary);background:var(--a-subtle)}.axis-iam-permission-checker{margin-top:22px;padding-top:17px;border-top:1px solid var(--a-border)}.axis-iam-permission-checker summary{overflow-wrap:anywhere;font-weight:700;cursor:pointer}.axis-iam-permission-checker form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}.axis-iam-permission-result{margin-top:10px;padding:10px;overflow-wrap:anywhere;border:1px solid currentColor;border-radius:var(--a-radius);background:var(--a-subtle);color:var(--a-danger)}.axis-iam-permission-result[data-allowed=true]{color:var(--a-success)}@container(max-width:520px){.axis-iam-permission-overview{grid-template-columns:repeat(2,minmax(0,1fr))}.axis-iam-permission-context{grid-column:1/-1}.axis-iam-permission-checker form{grid-template-columns:1fr}.axis-iam-permission-checker button{width:100%}}`
