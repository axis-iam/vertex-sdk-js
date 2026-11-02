import { AccountSecurityPanel } from './AccountSecurityPanel'
import type { AccountSecurityPanelProps } from './AccountSecurityPanel'
import { AccountSecurityExitContext, useAccountSecurityExit } from './accountSecurityExit'
import { IdentityOperationExitContext, useIdentityOperationExit } from './identityOperationExit'
import { accountSecurityStore } from '../core/account-security-store'
import { useIamContext } from '../provider/IamProvider'
import { ConnectedAccounts } from './ConnectedAccounts'
import { useIdentityOperations } from '../hooks/useIdentityOperations'
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
  permissionsProps?: Omit<AccountPermissionsPanelProps, 'appearance' | 'colorScheme' | 'darkAppearance' | 'localization' | 'organizationId' | 'showPermissionChecker'>
}

const sections: AccountCenterSection[] = ['profile', 'methods', 'password', 'security', 'sessions', 'permissions']
export function AccountCenter(props: AccountCenterProps) {
  const { open, onOpenChange, initialSection = 'profile', organizationId = null, appearance, colorScheme, darkAppearance, localization, className, style, labels, profileProps, passwordProps, sessionsProps, permissionsProps } = props
  const ui = useIamUi()
  const operations = useIdentityOperations()
  const { client } = useIamContext()
  const securityActions = accountSecurityStore(client)
  const securityExit = useAccountSecurityExit()
  const identityExit = useIdentityOperationExit()
  const requestLeave = (leave: () => void) => {
    if (operations.state.pending || operations.state.uncertainCreate) return
    const identity = operations.state
    if ((identity.operation && !['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(identity.operation.state)) || identity.uncertain || identity.cancelUnconfirmed) {
      setSection('methods'); setMenu(false)
      identityExit.request(() => { operations.actions.cancelProviderWindow(); leave() })
      return
    }
    securityExit.request(() => { operations.actions.cancelProviderWindow(); leave() })
    const security = securityActions.getSnapshot()
    if ((security.operation && !['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(security.operation.state)) || security.uncertain || security.uncertainCreate) {
      setSection('security'); setMenu(false)
    }
  }
  const requestClose = () => requestLeave(() => onOpenChange(false))
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
    securityExit.reset()
    identityExit.reset()
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
  const changeSection = (next: AccountCenterSection) => {
    if (next === section) { setMenu(false); return }
    requestLeave(() => { setSection(next); setMenu(false) })
  }
  const embedded = (value?: string) => ['axis-ac-e', value].filter(Boolean).join(' ')
  const shared = { appearance: effectiveAppearance, colorScheme: effectiveColorScheme, darkAppearance: effectiveDarkAppearance, localization: l }
  const panel = section === 'profile' ? <AccountProfilePanel {...profileProps} {...shared} className={embedded(profileProps?.className)} />
    : section === 'methods' ? <ConnectedAccounts embedded appearance={effectiveAppearance} colorScheme={effectiveColorScheme} darkAppearance={effectiveDarkAppearance} redirectUri={props.identityRedirectUri} />
    : section === 'security' ? <AccountSecurityPanel {...props.securityProps} appearance={effectiveAppearance} colorScheme={effectiveColorScheme} darkAppearance={effectiveDarkAppearance} className={embedded(props.securityProps?.className)} />
    : section === 'password' ? <PasswordChangeForm {...passwordProps} {...shared} className={embedded(passwordProps?.className)} />
      : section === 'sessions' ? <AccountSessionsPanel {...sessionsProps} {...shared} className={embedded(sessionsProps?.className)} />
        : <AccountPermissionsPanel {...permissionsProps} {...shared} className={embedded(permissionsProps?.className)} organizationId={organizationId} showPermissionChecker={false} />
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
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
      <header className="axis-ac-head"><button className="axis-ac-back" type="button" onClick={() => requestLeave(() => setMenu(true))}><AccountIcon name="back" size={16} />{l.back}</button><h2 id={titleId}><AccountIcon name="profile" />{l.title}</h2><button ref={close} className="axis-ac-close" type="button" aria-label={l.close} onClick={() => void requestClose()}><AccountIcon name="close" /></button></header>
      <div className="axis-ac-layout"><nav className="axis-ac-nav" aria-label={l.sectionsAria}><span>{l.menu}</span>{sections.map((item) => <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => changeSection(item)}><AccountIcon name={item} size={18} /><span>{item === 'methods' ? ui.localization.identity.title : l[`${item}Section`]}</span></button>)}</nav><main className="axis-ac-content" aria-live="polite"><AccountSecurityExitContext.Provider value={securityExit}><IdentityOperationExitContext.Provider value={identityExit}>{panel}</IdentityOperationExitContext.Provider></AccountSecurityExitContext.Provider></main></div>
    </div>
  </div>
}

const css = `.axis-ac-overlay,.axis-ac-overlay *{box-sizing:border-box;letter-spacing:0}
.axis-ac-overlay{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;background:#111820a8}
.axis-ac-dialog{position:relative;width:min(100%,1020px);height:min(770px,calc(100dvh - 48px));min-height:min(520px,calc(100dvh - 48px));display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:0;border-radius:16px;background:var(--a-surface);color:var(--a-text);box-shadow:0 24px 80px -24px #10182055;font-size:14px;line-height:1.5}
.axis-ac-head{display:flex;align-items:center;gap:12px;min-width:0;padding:16px 22px;background:var(--a-surface)}
.axis-ac-head h2{display:flex;align-items:center;gap:10px;min-width:0;margin:0 auto 0 0;overflow-wrap:anywhere;font-size:15px;font-weight:650;line-height:22px}
.axis-ac-dialog svg{flex:none}.axis-ac-close,.axis-ac-back{align-items:center;justify-content:center;gap:4px;max-width:100%;min-width:44px;min-height:44px;padding:8px;overflow-wrap:anywhere;border:1px solid transparent;border-radius:var(--a-radius);background:transparent;color:var(--a-muted);font:inherit;white-space:normal;cursor:pointer}
.axis-ac-close{display:inline-flex}.axis-ac-back{display:none}.axis-ac-close:hover,.axis-ac-back:hover{background:var(--a-subtle);color:var(--a-text)}
.axis-ac-dialog :where(button,summary):focus-visible{outline:2px solid var(--a-focus);outline-offset:2px}
.axis-ac-layout{display:grid;min-height:0;grid-template-columns:220px minmax(0,1fr)}
.axis-ac-nav{display:grid;align-content:start;grid-auto-rows:min-content;gap:5px;min-width:0;min-height:0;padding:12px 17px 24px;overflow:auto;border:0;background:var(--a-subtle)}
.axis-ac-nav>span{display:none}
.axis-ac-nav button{display:flex;align-items:center;gap:10px;width:100%;height:auto;min-width:0;min-height:44px;padding:10px 13px;overflow-wrap:anywhere;border:0;border-radius:var(--a-radius);background:transparent;color:var(--a-muted);font:inherit;font-size:13px;font-weight:500;text-align:left;white-space:normal;cursor:pointer}
.axis-ac-nav button:hover{background:var(--a-surface);color:var(--a-text)}.axis-ac-nav button[aria-current=page]{background:var(--a-surface);color:var(--a-primary);font-weight:650}
.axis-ac-dialog[data-color-scheme=dark] .axis-ac-nav button[aria-current=page]{color:color-mix(in srgb,var(--a-primary) 40%,var(--a-text))}
.axis-ac-content{min-width:0;min-height:0;overflow:auto;padding:18px 40px 32px;scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}
.axis-ac-e{margin:0!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
@keyframes axis-ac-enter{from{opacity:.6;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.axis-ac-dialog{animation:axis-ac-enter .16s cubic-bezier(.16,1,.3,1)}@media(prefers-reduced-motion:reduce){.axis-ac-dialog{animation:none}}
@media(max-width:640px){.axis-ac-overlay{display:block;padding:0;overflow:hidden}.axis-ac-dialog{width:100%;height:100dvh;min-height:0;max-height:none;border:0;border-radius:0}.axis-ac-head{min-height:calc(64px + env(safe-area-inset-top));padding:calc(10px + env(safe-area-inset-top)) calc(12px + env(safe-area-inset-right)) 10px calc(12px + env(safe-area-inset-left))}.axis-ac-head h2>svg{display:none}.axis-ac-head h2{font-size:14px}.axis-ac-back{display:inline-flex;font-size:12px;padding:8px 4px}.axis-ac-layout{display:block;min-height:0;overflow:auto;padding-bottom:env(safe-area-inset-bottom)}.axis-ac-nav{display:none;min-height:100%;padding:18px 14px;border:0;background:var(--a-surface)}.axis-ac-menu .axis-ac-nav{display:grid}.axis-ac-menu .axis-ac-content{display:none}.axis-ac-content{min-height:100%;overflow:visible;padding:22px calc(18px + env(safe-area-inset-right)) 22px calc(18px + env(safe-area-inset-left))}}`
