import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react'
import { SignIn } from './SignIn'
import type { SignInProps } from './SignIn'
import { SignUp } from './SignUp'
import type { SignUpProps } from './SignUp'
import type { Appearance } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import type { RegistrationGrantInput } from '../core/types'

export type AuthDialogView = 'sign-in' | 'sign-up'

export interface AuthDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialView?: AuthDialogView
  mode?: 'redirect' | 'embedded'
  allowSignUp?: boolean
  appearance?: Appearance
  className?: string
  style?: CSSProperties
  signInProps?: Omit<SignInProps, 'mode' | 'presentation'>
  signUpProps?: Omit<SignUpProps, 'mode' | 'presentation'>
  children?: ReactNode
}

export interface AuthEntryButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  appearance?: Appearance
}

export function SignInButton({ children, appearance, style, ...props }: AuthEntryButtonProps) {
  const { localization } = useIamUi()
  const [a] = useIamAppearance(appearance)
  return <button {...props} type="button" data-axis-auth-view="sign-in" style={{ ...triggerStyle(a), ...style }}>{children ?? localization.auth.signIn}</button>
}

export function SignUpButton({ children, appearance, style, ...props }: AuthEntryButtonProps) {
  const { localization } = useIamUi()
  const [a] = useIamAppearance(appearance)
  return <button {...props} type="button" data-axis-auth-view="sign-up" style={{ ...triggerStyle(a), ...style }}>{children ?? localization.signUp.signUp}</button>
}

/** A controlled, responsive container that composes the existing SignIn and SignUp engines. */
export function AuthDialog({
  open,
  onOpenChange,
  initialView = 'sign-in',
  mode = 'embedded',
  allowSignUp = true,
  appearance,
  className,
  style,
  signInProps,
  signUpProps,
  children,
}: AuthDialogProps) {
  const { localization } = useIamUi()
  const [a, colorScheme] = useIamAppearance(appearance)
  const canSignUp = authDialogCanShowSignUp(mode, allowSignUp, signUpProps?.registrationGrant)
  const normalizedInitialView = normalizeView(initialView, canSignUp)
  const [view, setView] = useState<AuthDialogView>(normalizedInitialView)
  const [mountedViews, setMountedViews] = useState(() => mountedFor(normalizedInitialView, canSignUp))
  const wasOpen = useRef(open)
  const closedInitialView = useRef(normalizedInitialView)
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const focusWasOpen = useRef(open)
  const titleId = useId()

  const opening = open && !wasOpen.current
  const openingView = opening && normalizedInitialView !== closedInitialView.current
    ? normalizedInitialView
    : normalizeView(view, canSignUp)

  useEffect(() => {
    if (!open) {
      closedInitialView.current = normalizedInitialView
      setView(normalizedInitialView)
      setMountedViews(mountedFor(normalizedInitialView, canSignUp))
    } else if (opening) {
      setView(openingView)
      setMountedViews(mountedFor(openingView, canSignUp))
    }
    wasOpen.current = open
  }, [canSignUp, normalizedInitialView, open, opening, openingView])

  useEffect(() => {
    if (open) {
      if (!focusWasOpen.current) {
        const activeElement = document.activeElement
        trigger.current = activeElement instanceof HTMLElement
          && activeElement !== document.body
          && !dialog.current?.contains(activeElement)
          ? activeElement
          : null
        focusWasOpen.current = true
      }
      close.current?.focus()
      return
    }
    if (!focusWasOpen.current) return
    const opener = trigger.current
    trigger.current = null
    focusWasOpen.current = false
    if (opener?.isConnected && !opener.matches(':disabled')) opener.focus()
  }, [open])

  useEffect(() => {
    if (!canSignUp) {
      setView('sign-in')
      setMountedViews({ 'sign-in': true, 'sign-up': false })
    }
  }, [canSignUp])

  const selectView = (nextView: AuthDialogView) => {
    const normalizedView = normalizeView(nextView, canSignUp)
    setView(normalizedView)
    setMountedViews((current) => current[normalizedView] ? current : { ...current, [normalizedView]: true })
  }
  const openFromTrigger = (nextView?: AuthDialogView) => {
    selectView(nextView ?? initialView)
    onOpenChange(true)
  }
  const triggerElement = children && isValidElement<{ onClick?: (event: React.MouseEvent) => void; 'data-axis-auth-view'?: AuthDialogView }>(children)
    ? cloneElement(children as ReactElement<{ onClick?: (event: React.MouseEvent) => void; 'data-axis-auth-view'?: AuthDialogView }>, {
      onClick: (event) => { children.props.onClick?.(event); if (!event.defaultPrevented) openFromTrigger(triggerViewFor(children)) },
    })
    : children

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onOpenChange(false); return }
    if (canSignUp && event.target instanceof HTMLElement && event.target.getAttribute('role') === 'tab') {
      const nextView = event.key === 'ArrowRight' || event.key === 'End' ? 'sign-up'
        : event.key === 'ArrowLeft' || event.key === 'Home' ? 'sign-in'
          : null
      if (nextView) {
        event.preventDefault()
        selectView(nextView)
        const tabs = dialog.current?.querySelectorAll<HTMLElement>('[role="tab"]')
        tabs?.[nextView === 'sign-in' ? 0 : 1]?.focus()
        return
      }
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])
      .filter((item) => !item.hasAttribute('disabled') && item.getAttribute('aria-hidden') !== 'true' && !item.closest('[hidden]'))
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const activeView = opening ? openingView : normalizeView(view, canSignUp)
  return <>
    {triggerElement}
    {open && <div className="axis-iam-auth-dialog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); onOpenChange(false) } }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-color-scheme={colorScheme} className={['axis-iam-auth-dialog', className].filter(Boolean).join(' ')} style={{ ...dialogVariables(a), colorScheme, ...style }} onKeyDown={onKeyDown}>
        <style>{css}</style>
        <header className="axis-iam-auth-dialog-header">
          <h2 id={titleId}>{localization.authDialog.title(activeView)}</h2>
          <button ref={close} type="button" className="axis-iam-auth-dialog-close" aria-label={localization.authDialog.close} onClick={() => onOpenChange(false)}>x</button>
        </header>
        {canSignUp && <div className="axis-iam-auth-dialog-tabs" role="tablist" aria-label={localization.authDialog.title(activeView)}>
          <button type="button" role="tab" aria-selected={activeView === 'sign-in'} tabIndex={activeView === 'sign-in' ? 0 : -1} onClick={() => selectView('sign-in')}>{localization.authDialog.signInTab}</button>
          <button type="button" role="tab" aria-selected={activeView === 'sign-up'} tabIndex={activeView === 'sign-up' ? 0 : -1} onClick={() => selectView('sign-up')}>{localization.authDialog.signUpTab}</button>
        </div>}
        <section className="axis-iam-auth-dialog-content" aria-live="polite" data-auth-dialog-panels>
          {(mountedViews['sign-in'] || activeView === 'sign-in') && <div data-auth-view="sign-in" hidden={activeView !== 'sign-in'}><SignIn {...signInProps} mode={mode} presentation="dialog" /></div>}
          {canSignUp && (mountedViews['sign-up'] || activeView === 'sign-up') && <div data-auth-view="sign-up" hidden={activeView !== 'sign-up'}><SignUp {...signUpProps} mode={mode} presentation="dialog" /></div>}
        </section>
      </div>
    </div>}
  </>
}

function normalizeView(view: AuthDialogView, canSignUp: boolean): AuthDialogView {
  return canSignUp ? view : 'sign-in'
}

function mountedFor(view: AuthDialogView, canSignUp: boolean): Record<AuthDialogView, boolean> {
  const normalizedView = normalizeView(view, canSignUp)
  return { 'sign-in': normalizedView === 'sign-in', 'sign-up': normalizedView === 'sign-up' }
}

function authDialogCanShowSignUp(mode: 'redirect' | 'embedded', allowSignUp: boolean, registrationGrant?: RegistrationGrantInput): boolean {
  if (!allowSignUp) return false
  if (mode === 'embedded') return true
  if (!registrationGrant) return false
  switch (registrationGrant.type) {
    case 'EMAIL_LINK':
      return registrationGrant.registrationGrantToken.trim().length > 0
    case 'ACCESS_CODE':
      return registrationGrant.registrationAccessCode.trim().length > 0
    case 'ORG_INVITATION':
      // Hosted SignUp explicitly rejects organization invitation proofs.
      return false
  }
}

function triggerViewFor(element: ReactElement<{ 'data-axis-auth-view'?: AuthDialogView }>): AuthDialogView | undefined {
  if (element.props['data-axis-auth-view']) return element.props['data-axis-auth-view']
  if (element.type === SignInButton) return 'sign-in'
  if (element.type === SignUpButton) return 'sign-up'
  return undefined
}

function triggerStyle(a: ReturnType<typeof useIamAppearance>[0]): CSSProperties {
  return { minHeight: 40, padding: '9px 14px', border: `1px solid ${a.primaryColor}`, borderRadius: a.borderRadius, background: a.primaryColor, color: '#fff', font: `700 13px/18px ${a.fontFamily}`, cursor: 'pointer' }
}

function dialogVariables(a: ReturnType<typeof useIamAppearance>[0]): CSSProperties {
  return { '--axis-auth-surface': a.surfaceColor, '--axis-auth-subtle': a.subtleColor, '--axis-auth-border': a.borderColor, '--axis-auth-text': a.textColor, '--axis-auth-focus': a.focusColor, '--axis-auth-radius': a.borderRadius } as CSSProperties
}

const css = `.axis-iam-auth-dialog-overlay,.axis-iam-auth-dialog-overlay *{box-sizing:border-box;letter-spacing:0}.axis-iam-auth-dialog-overlay{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;background:#111820b8}.axis-iam-auth-dialog{width:min(100%,480px);max-height:calc(100dvh - 48px);overflow:auto;border:1px solid var(--axis-auth-border);border-radius:var(--axis-auth-radius);background:var(--axis-auth-surface);color:var(--axis-auth-text)}.axis-iam-auth-dialog-header{display:grid;grid-template-columns:minmax(0,1fr) 36px;align-items:center;gap:12px;min-height:60px;padding:12px 18px;border-bottom:1px solid var(--axis-auth-border)}.axis-iam-auth-dialog-header h2{min-width:0;margin:0;overflow-wrap:anywhere;font-size:18px;line-height:24px}.axis-iam-auth-dialog-close{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid var(--axis-auth-border);border-radius:var(--axis-auth-radius);background:var(--axis-auth-surface);color:inherit;font:700 18px/1 sans-serif;cursor:pointer}.axis-iam-auth-dialog-tabs{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:12px 18px 0}.axis-iam-auth-dialog-tabs button{min-height:38px;padding:8px;overflow-wrap:anywhere;border:1px solid var(--axis-auth-border);border-radius:var(--axis-auth-radius);background:var(--axis-auth-surface);color:inherit;font:700 13px/18px inherit;cursor:pointer}.axis-iam-auth-dialog-tabs button[aria-selected=true]{border-color:var(--axis-auth-focus);background:var(--axis-auth-subtle)}.axis-iam-auth-dialog-content{min-width:0;padding:18px}.axis-iam-auth-dialog-content>div{max-width:none!important;margin:0!important;padding:0!important}.axis-iam-auth-dialog :focus-visible{outline:2px solid var(--axis-auth-focus);outline-offset:2px}@media(max-width:640px){.axis-iam-auth-dialog-overlay{display:block;padding:0;overflow:hidden}.axis-iam-auth-dialog{width:100%;height:100dvh;max-height:none;border:0;border-radius:0}.axis-iam-auth-dialog-header{min-height:calc(60px + env(safe-area-inset-top));padding:calc(12px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 12px calc(14px + env(safe-area-inset-left))}.axis-iam-auth-dialog-tabs{padding:12px calc(14px + env(safe-area-inset-right)) 0 calc(14px + env(safe-area-inset-left))}.axis-iam-auth-dialog-content{padding:18px calc(14px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left))}}`
