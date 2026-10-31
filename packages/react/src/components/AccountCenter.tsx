import { AccountSecurityPanel } from './AccountSecurityPanel'
import type { AccountSecurityPanelProps } from './AccountSecurityPanel'
import { accountSecurityStore } from '../core/account-security-store'
import { useIamContext } from '../provider/IamProvider'
import { ConnectedAccounts } from './ConnectedAccounts'
import { useIdentityOperations } from '../hooks/useIdentityOperations'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
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
import { AccountIcon } from './AccountIcon'

export type AccountCenterSection = 'profile' | 'methods' | 'password' | 'security' | 'sessions' | 'permissions'
export type AccountCenterLabels = Partial<Record<AccountCenterSection | 'title' | 'close' | 'menu' | 'back', string>>

export interface AccountCenterProps {
  securityProps?: Omit<AccountSecurityPanelProps, 'appearance' | 'colorScheme' | 'darkAppearance'>
  identityRedirectUri?: string
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

const sections: AccountCenterSection[] = ['profile', 'methods', 'password', 'security', 'sessions', 'permissions']
export function AccountCenter(props: AccountCenterProps) {
  const { open, onOpenChange, initialSection = 'profile', organizationId = null, appearance, colorScheme, darkAppearance, localization, className, style, labels, profileProps, passwordProps, sessionsProps, permissionsProps } = props
  const ui = useIamUi()
  const operations = useIdentityOperations()
  const { client } = useIamContext()
  const securityActions = accountSecurityStore(client)
  const securityState = useSyncExternalStore(securityActions.subscribe, securityActions.getSnapshot, securityActions.getSnapshot)
  const [confirmClose, setConfirmClose] = useState(false)
  const requestClose = async () => {
    if (operations.state.pending || operations.state.uncertainCreate) return
    if (securityState.pending || securityState.uncertainCreate) return
    if (securityState.uncertain) { setSection('security'); setMenu(false); return }
    operations.actions.cancelProviderWindow()
    if (securityState.operation && !['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(securityState.operation.state)) {
      setSection('security'); setMenu(false); setConfirmClose(true); return
    }
    if (securityState.operation) securityActions.acknowledge()
    securityActions.clearSensitive()
    onOpenChange(false)
  }
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
    setConfirmClose(false)
    close.current?.focus()
    return () => { trigger.current?.focus(); trigger.current = null }
  }, [initialSection, open])

  useEffect(() => {
    if (!open) return
    // Responsive navigation can hide the focused button without moving browser focus.
    const retainVisibleFocus = () => {
      const active = document.activeElement
      if (!dialog.current?.contains(active) || (active instanceof HTMLElement && active.getClientRects().length === 0)) close.current?.focus()
    }
    retainVisibleFocus()
    window.addEventListener('resize', retainVisibleFocus)
    return () => window.removeEventListener('resize', retainVisibleFocus)
  }, [open, section, menu])

  if (!open) return null
  const changeSection = (next: AccountCenterSection) => { setSection(next); setMenu(false) }
  const embedded = (value?: string) => ['axis-ac-e', value].filter(Boolean).join(' ')
  const shared = { appearance: effectiveAppearance, colorScheme: effectiveColorScheme, darkAppearance: effectiveDarkAppearance, localization: l }
  const panel = section === 'profile' ? <AccountProfilePanel {...profileProps} {...shared} className={embedded(profileProps?.className)} />
    : section === 'methods' ? <ConnectedAccounts embedded appearance={effectiveAppearance} colorScheme={effectiveColorScheme} darkAppearance={effectiveDarkAppearance} redirectUri={props.identityRedirectUri} />
    : section === 'security' ? <AccountSecurityPanel {...props.securityProps} appearance={effectiveAppearance} colorScheme={effectiveColorScheme} darkAppearance={effectiveDarkAppearance} className={embedded(props.securityProps?.className)} />
    : section === 'password' ? <PasswordChangeForm {...passwordProps} {...shared} className={embedded(passwordProps?.className)} />
      : section === 'sessions' ? <AccountSessionsPanel {...sessionsProps} {...shared} className={embedded(sessionsProps?.className)} />
        : <AccountPermissionsPanel {...permissionsProps} {...shared} className={embedded(permissionsProps?.className)} organizationId={organizationId} />
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); void requestClose(); return }
    if (event.key !== 'Tab') return
    const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? []).filter((item) => !item.hasAttribute('disabled') && item.offsetParent !== null)
    const first = items[0]; const last = items[items.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  return <div className="axis-ac-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) void requestClose() }}>
    <div ref={dialog} className={['axis-ac-dialog', menu && 'axis-ac-menu', className].filter(Boolean).join(' ')} style={{
      ...accountCenterVariables(a), colorScheme: resolvedColorScheme, ...style,
    } as CSSProperties} data-color-scheme={resolvedColorScheme} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <style>{css}</style>
      <header className="axis-ac-head"><button className="axis-ac-back" type="button" onClick={() => setMenu(true)}><AccountIcon name="back" size={16} />{l.back}</button><h2 id={titleId}><AccountIcon name="profile" />{l.title}</h2><button ref={close} className="axis-ac-close" type="button" aria-label={l.close} onClick={() => void requestClose()}><AccountIcon name="close" /></button></header>
      <div className="axis-ac-layout"><nav className="axis-ac-nav" aria-label={l.sectionsAria}><span>{l.menu}</span>{sections.map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => changeSection(item)}><AccountIcon name={item} size={18} /><span>{item === 'methods' ? ui.localization.identity.title : l[`${item}Section`]}</span></button>)}</nav><main className="axis-ac-content" aria-live="polite">{confirmClose && <section role="alert" className="axis-ac-cancel-confirm"><p>{ui.localization.security.cancelConfirm}</p><button type="button" disabled={securityState.pending} onClick={() => {
        void securityActions.cancel().then(operation => {
          setConfirmClose(false)
          if (operation?.state === 'CANCELLED' || operation?.state === 'EXPIRED') onOpenChange(false)
        }).catch(() => setConfirmClose(false))
      }}>{ui.localization.security.cancelNow}</button><button type="button" onClick={() => setConfirmClose(false)}>{ui.localization.security.keep}</button></section>}{panel}</main></div>
    </div>
  </div>
}

const css = `.axis-ac-overlay,.axis-ac-overlay *{box-sizing:border-box;letter-spacing:0}
.axis-ac-overlay{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;background:#111820a8}
.axis-ac-dialog{width:min(100%,940px);max-height:min(760px,calc(100dvh - 48px));min-height:min(520px,calc(100dvh - 48px));display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-surface);color:var(--a-text);font-size:14px;line-height:1.5}
.axis-ac-head{display:flex;align-items:center;gap:12px;min-width:0;padding:12px 20px;border-bottom:1px solid var(--a-border)}
.axis-ac-head h2{display:flex;align-items:center;gap:10px;min-width:0;margin:0 auto 0 0;overflow-wrap:anywhere;font-size:15px;font-weight:650;line-height:22px}
.axis-ac-dialog svg{flex:none}.axis-ac-close,.axis-ac-back{align-items:center;justify-content:center;gap:4px;max-width:100%;min-width:44px;min-height:44px;padding:8px;overflow-wrap:anywhere;border:1px solid transparent;border-radius:var(--a-radius);background:transparent;color:var(--a-muted);font:inherit;white-space:normal;cursor:pointer}
.axis-ac-close{display:inline-flex}.axis-ac-back{display:none}.axis-ac-close:hover,.axis-ac-back:hover{background:var(--a-subtle);color:var(--a-text)}
.axis-ac-dialog :where(button,summary):focus-visible{outline:2px solid var(--a-focus);outline-offset:2px}
.axis-ac-layout{display:grid;min-height:0;grid-template-columns:202px minmax(0,1fr)}
.axis-ac-nav{display:grid;align-content:start;grid-auto-rows:min-content;gap:4px;min-width:0;min-height:0;padding:20px 12px;overflow:auto;border-right:1px solid var(--a-border);background:var(--a-subtle)}
.axis-ac-nav>span{padding:0 12px 12px;color:var(--a-muted);overflow-wrap:anywhere;font-size:12px}
.axis-ac-nav button{display:flex;align-items:center;gap:10px;width:100%;height:auto;min-width:0;min-height:44px;padding:10px 12px;overflow-wrap:anywhere;border:1px solid transparent;border-radius:var(--a-radius);background:transparent;color:var(--a-text);font:inherit;font-size:13px;font-weight:550;text-align:left;white-space:normal;cursor:pointer}
.axis-ac-nav button:hover{background:var(--a-surface)}.axis-ac-nav button[aria-current=page]{border-color:var(--a-border);background:var(--a-surface);color:var(--a-primary);font-weight:650}
.axis-ac-content{min-width:0;min-height:0;overflow:auto;padding:28px 30px;scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}
.axis-ac-e{margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
.axis-ac-cancel-confirm{padding:12px 0 24px}.axis-ac-cancel-confirm button{min-height:44px;padding:8px 12px;margin:0 12px 8px 0;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-surface);color:var(--a-text);font:inherit}
@keyframes axis-ac-enter{from{opacity:.6;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.axis-ac-dialog{animation:axis-ac-enter .16s cubic-bezier(.16,1,.3,1)}@media(prefers-reduced-motion:reduce){.axis-ac-dialog{animation:none}}
@media(max-width:640px){.axis-ac-overlay{display:block;padding:0;overflow:hidden}.axis-ac-dialog{width:100%;height:100dvh;min-height:0;max-height:none;border:0;border-radius:0}.axis-ac-head{min-height:calc(64px + env(safe-area-inset-top));padding:calc(10px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) 10px calc(12px + env(safe-area-inset-left))}.axis-ac-head h2>svg{display:none}.axis-ac-head h2{font-size:14px}.axis-ac-back{display:inline-flex;font-size:12px;padding:8px 4px}.axis-ac-layout{display:block;min-height:0;overflow:auto;padding-bottom:env(safe-area-inset-bottom)}.axis-ac-nav{display:none;min-height:100%;padding:18px 14px;border:0;background:var(--a-surface)}.axis-ac-menu .axis-ac-nav{display:grid}.axis-ac-menu .axis-ac-content{display:none}.axis-ac-content{min-height:100%;overflow:visible;padding:22px calc(18px + env(safe-area-inset-right)) 22px calc(18px + env(safe-area-inset-left))}}`
