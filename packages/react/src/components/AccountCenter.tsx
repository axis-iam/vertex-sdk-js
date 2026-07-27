import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { AccountPermissionsPanel } from './AccountPermissionsPanel'
import type { AccountPermissionsPanelProps } from './AccountPermissionsPanel'
import { AccountProfilePanel } from './AccountProfilePanel'
import type { AccountProfilePanelProps } from './AccountProfilePanel'
import { AccountSessionsPanel } from './AccountSessionsPanel'
import type { AccountSessionsPanelProps } from './AccountSessionsPanel'
import { PasswordChangeForm } from './PasswordChangeForm'
import type { PasswordChangeFormProps } from './PasswordChangeForm'
import { accountCenterVariables, resolveAccountCenterLocalization, useAccountCenterAppearance } from './accountCenterConfig'
import type { AccountCenterColorScheme, AccountCenterLocalization } from './accountCenterConfig'
import type { Appearance } from './styles'
import { mergeAppearances } from './styles'
import { useIamUi } from '../provider/IamUiProvider'

export type AccountCenterSection = 'profile' | 'password' | 'sessions' | 'permissions'
export type AccountCenterLabels = Partial<Record<AccountCenterSection | 'title' | 'close' | 'menu' | 'back', string>>

export interface AccountCenterProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialSection?: AccountCenterSection
  organizationId?: string | null
  appearance?: Appearance
  colorScheme?: AccountCenterColorScheme
  darkAppearance?: Appearance
  localization?: Partial<AccountCenterLocalization>
  className?: string
  style?: CSSProperties
  labels?: AccountCenterLabels
  profileProps?: Omit<AccountProfilePanelProps, 'appearance' | 'colorScheme' | 'darkAppearance' | 'localization'>
  passwordProps?: Omit<PasswordChangeFormProps, 'appearance' | 'colorScheme' | 'darkAppearance' | 'localization'>
  sessionsProps?: Omit<AccountSessionsPanelProps, 'appearance' | 'colorScheme' | 'darkAppearance' | 'localization'>
  permissionsProps?: Omit<AccountPermissionsPanelProps, 'appearance' | 'colorScheme' | 'darkAppearance' | 'localization' | 'organizationId'>
}

const sections: AccountCenterSection[] = ['profile', 'password', 'sessions', 'permissions']
export function AccountCenter(props: AccountCenterProps) {
  const { open, onOpenChange, initialSection = 'profile', organizationId = null, appearance, colorScheme, darkAppearance, localization, className, style, labels, profileProps, passwordProps, sessionsProps, permissionsProps } = props
  const ui = useIamUi()
  const effectiveAppearance = mergeAppearances(ui.appearance, appearance)
  const effectiveColorScheme = colorScheme ?? ui.colorScheme
  const effectiveDarkAppearance = mergeAppearances(ui.darkAppearance, darkAppearance)
  const [a, resolvedColorScheme] = useAccountCenterAppearance(effectiveColorScheme, effectiveAppearance, effectiveDarkAppearance)
  const l = resolveAccountCenterLocalization(localization, labels, ui.localization.accountCenter)
  const titleId = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const [section, setSection] = useState(initialSection)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!open) return
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSection(initialSection)
    setMenu(false)
    close.current?.focus()
    return () => { trigger.current?.focus(); trigger.current = null }
  }, [initialSection, open])

  if (!open) return null
  const changeSection = (next: AccountCenterSection) => { setSection(next); setMenu(false) }
  const embedded = (value?: string) => ['axis-ac-e', value].filter(Boolean).join(' ')
  const shared = { appearance: effectiveAppearance, colorScheme: effectiveColorScheme, darkAppearance: effectiveDarkAppearance, localization: l }
  const panel = section === 'profile' ? <AccountProfilePanel {...profileProps} {...shared} className={embedded(profileProps?.className)} />
    : section === 'password' ? <PasswordChangeForm {...passwordProps} {...shared} className={embedded(passwordProps?.className)} />
      : section === 'sessions' ? <AccountSessionsPanel {...sessionsProps} {...shared} className={embedded(sessionsProps?.className)} />
        : <AccountPermissionsPanel {...permissionsProps} {...shared} className={embedded(permissionsProps?.className)} organizationId={organizationId} />
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false); return }
    if (event.key !== 'Tab') return
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter((item) => !item.hasAttribute('disabled') && item.offsetParent !== null)
    const first = items[0]; const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className="axis-ac-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false) }}>
    <div ref={dialog} className={['axis-ac-dialog', menu && 'axis-ac-menu', className].filter(Boolean).join(' ')} style={{
      ...accountCenterVariables(a), colorScheme: resolvedColorScheme, ...style,
    } as CSSProperties} data-color-scheme={resolvedColorScheme} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <style>{css}</style>
      <header className="axis-ac-head"><button className="axis-ac-back" type="button" onClick={() => setMenu(true)}>{l.back}</button><h2 id={titleId}>{l.title}</h2><button ref={close} className="axis-ac-close" type="button" aria-label={l.close} onClick={() => onOpenChange(false)}>x</button></header>
      <div className="axis-ac-layout"><nav className="axis-ac-nav" aria-label={l.sectionsAria}><span>{l.menu}</span>{sections.map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => changeSection(item)}>{l[`${item}Section`]}</button>)}</nav><main className="axis-ac-content" aria-live="polite">{panel}</main></div>
    </div>
  </div>
}

const css = `.axis-ac-overlay,.axis-ac-overlay *{box-sizing:border-box;letter-spacing:0}.axis-ac-overlay{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;background:#111820b8}.axis-ac-dialog{width:min(100%,980px);height:min(720px,calc(100dvh - 48px));display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-surface);color:var(--a-text)}.axis-ac-head{display:grid;grid-template-columns:36px minmax(0,1fr) 36px;align-items:center;gap:12px;min-width:0;min-height:64px;padding:12px 18px;border-bottom:1px solid var(--a-border)}.axis-ac-head h2{grid-column:2;min-width:0;margin:0;overflow-wrap:anywhere;font-size:16px;line-height:22px;text-align:center}.axis-ac-close,.axis-ac-back{align-items:center;justify-content:center;max-width:100%;min-width:36px;min-height:36px;padding:6px 9px;overflow-wrap:anywhere;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-surface);color:inherit;font:700 13px/18px inherit;white-space:normal;cursor:pointer}.axis-ac-close{display:inline-flex;grid-column:3;font-size:18px}.axis-ac-back{display:none}.axis-ac-close:focus-visible,.axis-ac-back:focus-visible,.axis-ac-nav button:focus-visible{outline:2px solid var(--a-focus);outline-offset:2px}.axis-ac-layout{display:grid;min-height:0;grid-template-columns:224px minmax(0,1fr)}.axis-ac-nav{display:grid;align-content:start;grid-auto-rows:min-content;gap:5px;min-width:0;min-height:0;padding:20px 14px;overflow:auto;border-right:1px solid var(--a-border);background:var(--a-subtle)}.axis-ac-nav span{padding:0 10px 9px;color:var(--a-muted);overflow-wrap:anywhere;font-size:11px;font-weight:800;text-transform:uppercase}.axis-ac-nav button{display:flex;align-items:center;width:100%;height:auto;min-width:0;min-height:42px;padding:10px 11px;overflow-wrap:anywhere;border:1px solid transparent;border-radius:var(--a-radius);background:transparent;color:inherit;font:650 13px/18px inherit;text-align:left;white-space:normal;cursor:pointer}.axis-ac-nav button[aria-current=page]{border-color:var(--a-border);background:var(--a-surface);color:var(--a-primary)}.axis-ac-content{min-width:0;min-height:0;overflow:auto;padding:24px}.axis-ac-e{margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}@media(max-width:640px){.axis-ac-overlay{display:block;padding:0;overflow:hidden}.axis-ac-dialog{width:100%;height:100dvh;max-height:none;border:0;border-radius:0;box-shadow:none}.axis-ac-head{grid-template-columns:minmax(64px,112px) minmax(0,1fr) 36px;min-height:calc(56px + env(safe-area-inset-top));padding:calc(10px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 10px calc(14px + env(safe-area-inset-left))}.axis-ac-back{display:inline-flex}.axis-ac-layout{display:block;min-height:0;overflow:auto;padding-bottom:env(safe-area-inset-bottom)}.axis-ac-nav{display:none;min-height:100%;padding:18px calc(14px + env(safe-area-inset-right)) 18px calc(14px + env(safe-area-inset-left));border:0;background:var(--a-surface)}.axis-ac-menu .axis-ac-nav{display:grid}.axis-ac-menu .axis-ac-content{display:none}.axis-ac-content{min-height:100%;overflow:visible;padding:18px calc(14px + env(safe-area-inset-right)) 18px calc(14px + env(safe-area-inset-left))}}`
