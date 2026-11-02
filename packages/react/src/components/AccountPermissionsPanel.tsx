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
  /** Enables the developer-oriented raw permission checker on standalone panels. */
  showPermissionChecker?: boolean
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
  showPermissionChecker = false,
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
  const safeError = formError ?? error?.message ?? null

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
          message={formError ?? l.errorMessage(safeError)}
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
            {summary.organizationId && <div className="axis-iam-permission-context"><span>{l.organizationContext}</span><strong>{l.organizationContextActive}</strong></div>}
          </div>

          <div className="axis-iam-permission-section">
            <h3>{l.roles}</h3>
            {summary.roles.length === 0 ? (
              <p className="axis-iam-account-muted">{l.noRoles}</p>
            ) : (
              <ul className="axis-iam-role-list">
                {summarizeRoles(summary.roles, ui.locale).map(({ label, count }) => (
                  <li key={label}>{count > 1 ? `${label} (${count})` : label}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="axis-iam-permission-section">
            <h3>{l.grantedPermissions}</h3>
            {summary.permissions.length === 0 ? (
              <p className="axis-iam-account-muted">{l.noPermissions}</p>
            ) : (
              <ul className="axis-iam-permission-list">
                {summarizePermissions(summary.permissions, ui.locale).map(({ label, count }) => (
                  <li key={label}><span>{count > 1 ? `${label} (${count})` : label}</span></li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <AccountEmpty title={l.accessEmptyTitle} detail={l.accessEmptyDetail} localization={l} onRetry={() => { void refetch(organizationId) }} />
      )}

      {showPermissionChecker && <details className="axis-iam-permission-checker">
        <summary>{l.checkPermissionSummary}</summary>
        <p>{l.checkPermissionDetail}</p>
        <form onSubmit={(event) => { void submit(event).catch(() => undefined) }}>
          <div className="axis-iam-account-field">
            <label htmlFor="iam-permission-check">{l.checkPermissionLabel}</label>
            <input className="axis-iam-account-input" id="iam-permission-check" value={permission} disabled={isChecking} placeholder={l.permissionPlaceholder}
              onChange={(event) => { setFormError(null); setPermission(event.target.value) }} />
          </div>
          <button type="submit" disabled={isChecking}>{isChecking ? l.checkingPermission : l.check}</button>
        </form>
        {lastCheck && <div className="axis-iam-permission-result" role="status" data-allowed={lastCheck.allowed}>
          <code title={l.permissionResult(lastCheck.permission, lastCheck.allowed)}>{l.permissionResult(lastCheck.permission, lastCheck.allowed)}</code>
        </div>}
      </details>}
    </AccountCenterSurface>
  )
}

function summarizeRoles(values: string[], locale: string): Array<{ label: string; count: number }> {
  const labels = new Map<string, number>()
  for (const value of values) {
    const label = formatRole(value, locale)
    labels.set(label, (labels.get(label) ?? 0) + 1)
  }
  return [...labels].map(([label, count]) => ({ label, count }))
}

function formatRole(value: string, locale: string): string {
  const role = value.toLowerCase().replace(/[_-]+/g, ' ')
  const roles: Record<string, readonly [string, string]> = {
    admin: ['Administrator', '管理员'],
    administrator: ['Administrator', '管理员'],
    member: ['Member', '成员'],
    owner: ['Owner', '所有者'],
    viewer: ['Viewer', '查看者'],
    operator: ['Operator', '操作员'],
  }
  return roles[role]?.[locale === 'zh-CN' ? 1 : 0] ?? (locale === 'zh-CN' ? '其他角色' : 'Other role')
}

function summarizePermissions(values: string[], locale: string): Array<{ label: string; count: number }> {
  const isChinese = locale === 'zh-CN'
  const actions: Record<string, string> = isChinese
    ? { read: '查看', list: '查看', write: '编辑', update: '编辑', create: '创建', delete: '删除', manage: '管理', '*': '全部操作' }
    : { read: 'View', list: 'View', write: 'Edit', update: 'Edit', create: 'Create', delete: 'Delete', manage: 'Manage', '*': 'All actions' }
  const resources: Record<string, string> = isChinese
    ? { users: '用户', user: '用户', profiles: '个人资料', profile: '个人资料', sessions: '会话', organizations: '组织', organization: '组织', applications: '应用', application: '应用', roles: '角色', permissions: '权限', invoices: '发票', orders: '订单', reports: '报告', files: '文件', projects: '项目' }
    : { users: 'Users', user: 'Users', profiles: 'Profile', profile: 'Profile', sessions: 'Sessions', organizations: 'Organizations', organization: 'Organizations', applications: 'Applications', application: 'Applications', roles: 'Roles', permissions: 'Permissions', invoices: 'Invoices', orders: 'Orders', reports: 'Reports', files: 'Files', projects: 'Projects' }
  const labels = new Map<string, number>()
  let unclassified = 0
  for (const value of values) {
    const [resource, action] = value.toLowerCase().split(':', 2)
    const actionLabel = action ? actions[action] : undefined
    const resourceLabel = resource === '*' ? (isChinese ? '全部资源' : 'All resources') : resources[resource ?? '']
    const label = actionLabel && resourceLabel
      ? `${resourceLabel} · ${actionLabel}`
      : undefined
    if (!label) {
      unclassified += 1
      continue
    }
    labels.set(label, (labels.get(label) ?? 0) + 1)
  }
  if (unclassified) labels.set(isChinese ? '其他访问权限' : 'Other access', unclassified)
  return [...labels].map(([label, count]) => ({ label, count }))
}

const permissionsCss = `.axis-iam-permission-overview{display:flex;flex-wrap:wrap;gap:12px 24px;margin-bottom:30px;padding-bottom:0}.axis-iam-permission-overview>div{display:grid;gap:3px;min-width:0}.axis-iam-permission-overview strong,.axis-iam-permission-list span,.axis-iam-permission-context strong{min-width:0;overflow-wrap:anywhere}.axis-iam-permission-overview span,.axis-iam-permission-context strong{color:var(--a-muted)}.axis-iam-permission-overview strong{font-size:15px;line-height:1.5}.axis-iam-permission-section+.axis-iam-permission-section{margin-top:24px}.axis-iam-permission-section h3{margin:0 0 10px;font-size:15px}.axis-iam-role-list,.axis-iam-permission-list{display:grid;grid-template-columns:1fr;gap:8px;margin:0;padding:0;list-style:none}.axis-iam-role-list li,.axis-iam-permission-list li{min-width:0;padding:9px 0;overflow-wrap:anywhere;border:0;background:transparent}.axis-iam-permission-checker{margin-top:32px;padding-top:0}.axis-iam-permission-checker summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}.axis-iam-permission-checker>p{color:var(--a-muted)}.axis-iam-permission-checker form{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:10px}.axis-iam-permission-result{margin-top:12px;padding:12px;overflow-wrap:anywhere;border:1px solid currentColor;border-radius:var(--a-radius);background:var(--a-subtle);color:var(--a-danger)}.axis-iam-permission-result[data-allowed=true]{color:var(--a-success)}@container(max-width:480px){.axis-iam-permission-checker form{grid-template-columns:1fr}.axis-iam-permission-checker button{justify-self:start}}`
