import type { CSSProperties, ReactNode } from 'react'
import type { Appearance } from './styles'
import type { AccountCenterLocalization } from './accountCenterConfig'
import { accountCenterVariables } from './accountCenterConfig'

interface AccountCenterSurfaceProps {
  appearance: Required<Appearance>
  colorScheme: 'light' | 'dark'
  ariaLabel: string
  title: string
  description: string
  className?: string
  style?: CSSProperties
  headerMeta?: ReactNode
  componentCss?: string
  children: ReactNode
}

export function AccountCenterSurface({
  appearance,
  colorScheme,
  ariaLabel,
  title,
  description,
  className,
  style,
  headerMeta,
  componentCss,
  children,
}: AccountCenterSurfaceProps) {
  const variables: CSSProperties = {
    ...accountCenterVariables(appearance),
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    colorScheme,
    border: `1px solid ${appearance.borderColor}`,
    borderRadius: appearance.borderRadius,
    padding: 24,
    ...style,
  }

  return (
    <section
      className={['axis-iam-account-surface', className].filter(Boolean).join(' ')}
      style={variables}
      aria-label={ariaLabel}
      data-color-scheme={colorScheme}
    >
      <style>{componentCss ? `${accountCenterCss}\n${componentCss}` : accountCenterCss}</style>
      <header className="axis-iam-account-header">
        <div>
          <h2 className="axis-iam-account-title">{title}</h2>
          <p className="axis-iam-account-description">{description}</p>
        </div>
        {headerMeta}
      </header>
      {children}
    </section>
  )
}

export function AccountError({ message, localization, onRetry, busy = false }: { message: string; localization: AccountCenterLocalization; onRetry?: () => void; busy?: boolean }) {
  return (
    <div className="axis-iam-account-notice axis-iam-account-notice-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="axis-iam-account-text-button" type="button" onClick={onRetry} disabled={busy}>
          {busy ? localization.retrying : localization.retry}
        </button>
      )}
    </div>
  )
}

export function AccountEmpty({ title, detail, localization, onRetry }: { title: string; detail: string; localization: AccountCenterLocalization; onRetry?: () => void }) {
  return (
    <div className="axis-iam-account-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
      {onRetry && <button className="axis-iam-account-secondary-button" type="button" onClick={onRetry}>{localization.retry}</button>}
    </div>
  )
}

export function AccountLoading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="axis-iam-account-loading" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => <span key={index} />)}
    </div>
  )
}

const accountCenterCss = `.axis-iam-account-surface{container-type:inline-size;letter-spacing:0}.axis-iam-account-surface *{box-sizing:border-box;letter-spacing:0}.axis-iam-account-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;min-width:0;margin:0 0 24px;padding-bottom:18px;border-bottom:1px solid var(--a-border)}.axis-iam-account-title{margin:0;overflow-wrap:anywhere;font-size:20px;line-height:28px}.axis-iam-account-description,.axis-iam-account-muted{margin:4px 0;color:var(--a-muted);overflow-wrap:anywhere;font-size:13px;line-height:20px}.axis-iam-account-count{flex:none;padding:4px 8px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}.axis-iam-account-field{display:grid;align-content:start;gap:6px;min-width:0}.axis-iam-account-field label{min-width:0;overflow-wrap:anywhere;font-size:13px;font-weight:650;line-height:18px}.axis-iam-account-input{display:block;width:100%;min-width:0;height:42px;padding:9px 11px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-input);color:var(--a-text);font:inherit}.axis-iam-account-input:focus-visible{outline:2px solid var(--a-focus);outline-offset:2px}.axis-iam-account-surface :where(button){display:inline-flex;align-items:center;justify-content:center;max-width:100%;min-width:0;min-height:40px;padding:9px 14px;overflow-wrap:anywhere;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-surface);color:var(--a-text);font:700 13px/18px inherit;text-align:center;white-space:normal;cursor:pointer}.axis-iam-account-primary-button{border-color:var(--a-primary);background:var(--a-primary);color:#fff}.axis-iam-account-danger-button{border-color:var(--a-danger);color:var(--a-danger)}.axis-iam-account-danger-button[data-filled=true]{background:var(--a-danger);color:#fff}.axis-iam-account-text-button{min-height:0;padding:2px 0;border:0;text-decoration:underline}.axis-iam-account-surface :where(button):focus-visible{outline:2px solid var(--a-focus);outline-offset:2px}.axis-iam-account-surface :where(button):disabled{opacity:.55;cursor:not-allowed}.axis-iam-account-notice{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;margin-bottom:18px;padding:11px 12px;border:1px solid currentColor;border-radius:var(--a-radius);overflow-wrap:anywhere}.axis-iam-account-notice-error{color:var(--a-danger)}.axis-iam-account-notice-success{color:var(--a-success)}.axis-iam-account-empty{display:grid;justify-items:start;gap:7px;min-width:0;padding:22px 0;color:var(--a-muted)}.axis-iam-account-empty strong{color:var(--a-text)}.axis-iam-account-loading{display:grid;gap:10px}.axis-iam-account-loading span{display:block;width:100%;height:42px;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}`
