import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useChangePassword } from '../hooks/useChangePassword'
import { AccountCenterSurface, AccountError } from './AccountCenterSurface'
import { resolveAccountCenterLocalization, useAccountCenterAppearance } from './accountCenterConfig'
import type { AccountCenterColorScheme, AccountCenterLocalization } from './accountCenterConfig'
import type { Appearance } from './styles'
import { mergeAppearances } from './styles'
import { useIamUi } from '../provider/IamUiProvider'

export interface PasswordChangeFormProps {
  appearance?: Appearance
  colorScheme?: AccountCenterColorScheme
  darkAppearance?: Appearance
  localization?: Partial<AccountCenterLocalization>
  onChanged?: () => void | Promise<void>
  className?: string
  style?: CSSProperties
}

export function PasswordChangeForm({ appearance, colorScheme, darkAppearance, localization, onChanged, className, style }: PasswordChangeFormProps) {
  const ui = useIamUi()
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const l = resolveAccountCenterLocalization(localization, undefined, ui.localization.accountCenter)
  const { changePassword, isChanging, error } = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [changed, setChanged] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setChanged(false)
    setFormError(null)

    if (!currentPassword || !newPassword) {
      setFormError(l.passwordRequiredError)
      return
    }
    if (newPassword !== confirmPassword) {
      setFormError(l.passwordMismatchError)
      return
    }

    await changePassword({ currentPassword, newPassword })
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setChanged(true)
    await onChanged?.()
  }

  function edit(setter: (value: string) => void, value: string) {
    setChanged(false)
    setFormError(null)
    setter(value)
  }

  const safeError = formError ?? error?.message ?? null

  return (
    <AccountCenterSurface
      appearance={a}
      colorScheme={resolvedColorScheme}
      ariaLabel={l.passwordAria}
      title={l.passwordSection}
      description={l.passwordDescription}
      className={className}
      style={style}
      componentCss={passwordCss}
    >
      {safeError && <AccountError message={error?.message ? l.errorMessage(safeError) : safeError} localization={l} />}
      {changed && <div className="axis-iam-account-notice axis-iam-account-notice-success" role="status">{l.passwordChanged}</div>}

      <form className="axis-iam-password-form" onSubmit={(event) => { void submit(event).catch(() => undefined) }}>
        <div className="axis-iam-account-field">
          <label htmlFor="iam-current-password">{l.currentPassword}</label>
          <input
            className="axis-iam-account-input"
            id="iam-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            disabled={isChanging}
            onChange={(event) => edit(setCurrentPassword, event.target.value)}
          />
        </div>
        <div className="axis-iam-password-new-fields">
          <div className="axis-iam-account-field">
            <label htmlFor="iam-new-password">{l.newPassword}</label>
            <input
              className="axis-iam-account-input"
              id="iam-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              disabled={isChanging}
              onChange={(event) => edit(setNewPassword, event.target.value)}
            />
          </div>
          <div className="axis-iam-account-field">
            <label htmlFor="iam-confirm-password">{l.confirmPassword}</label>
            <input
              className="axis-iam-account-input"
              id="iam-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={isChanging}
              onChange={(event) => edit(setConfirmPassword, event.target.value)}
            />
          </div>
        </div>

        <div className="axis-iam-password-actions">
          <p>{l.passwordHelp}</p>
          <button className="axis-iam-account-primary-button" type="submit" disabled={isChanging}>
            {isChanging ? l.changingPassword : l.changePassword}
          </button>
        </div>
      </form>
    </AccountCenterSurface>
  )
}

const passwordCss = `.axis-iam-password-form,.axis-iam-password-new-fields{display:grid;gap:16px;min-width:0}.axis-iam-password-new-fields{margin-top:16px}.axis-iam-password-actions{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;min-width:0;margin-top:22px;padding-top:18px;border-top:1px solid var(--a-border)}.axis-iam-password-actions p{max-width:440px;margin:0;color:var(--a-muted);overflow-wrap:anywhere;font-size:12px;line-height:18px}@container(max-width:480px){.axis-iam-password-actions{display:grid}}`
