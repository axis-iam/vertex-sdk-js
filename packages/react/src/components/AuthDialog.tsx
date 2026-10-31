import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, ReactElement, ReactNode } from 'react'
import { SignIn } from './SignIn'
import type { SignInProps } from './SignIn'
import { SignUp } from './SignUp'
import type { SignUpProps } from './SignUp'
import type { Appearance } from './styles'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import type { RegistrationGrantInput } from '../core/types'
import { useAuthFlow } from '../hooks/useAuthFlow'
import { BrandedAuthContent, useAuthBranding } from './sign-in/BrandedAuthContent'

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
  return (
    <button {...props} type="button" data-axis-auth-view="sign-in" style={{ ...triggerStyle(a), ...style }}>
      {children ?? localization.auth.signIn}
    </button>
  )
}

export function SignUpButton({ children, appearance, style, ...props }: AuthEntryButtonProps) {
  const { localization } = useIamUi()
  const [a] = useIamAppearance(appearance)
  return (
    <button {...props} type="button" data-axis-auth-view="sign-up" style={{ ...triggerStyle(a), ...style }}>
      {children ?? localization.signUp.signUp}
    </button>
  )
}

/** Controlled framing around the shared Embedded flow, or the existing Hosted launcher. */
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
  const { localization: l } = useIamUi()
  const candidateSignup = authDialogCanShowSignUp(mode, allowSignUp, signUpProps?.registrationGrant)
  const initialIntent = candidateSignup ? initialView : 'sign-in'
  const intent = useRef<AuthDialogView>(initialIntent)
  const flow = useAuthFlow({
    initialIntent,
    registrationGrant: signUpProps?.registrationGrant,
    onSignInSuccess: signInProps?.onSuccess,
    onSignUpSuccess: signUpProps?.onSuccess,
    onError: (error) => (intent.current === 'sign-up' ? signUpProps?.onError : signInProps?.onError)?.(error),
  })
  intent.current = flow.state.intent
  const canSignUp =
    candidateSignup &&
    Boolean(
      flow.state.capabilities?.signupEnabled &&
        flow.state.capabilities.selfRegistrationEnabled &&
        flow.state.policy &&
        flow.state.policy.signupMode !== 'DISABLED',
    )
  const [hostedView, setHostedView] = useState<AuthDialogView>('sign-in')
  const requested = useRef<AuthDialogView | null>(null)
  const wasOpen = useRef(open)
  const initialMount = useRef(true)
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const selectView = (next: AuthDialogView) => {
    const selected =
      next === 'sign-up' && !(canSignUp || (candidateSignup && flow.state.step === 'loading'))
        ? 'sign-in'
        : next
    void flow.actions.setIntent(selected).catch(() => { /* The flow exposes cancellation failure. */ })
    setHostedView(selected)
  }
  useEffect(() => {
    if (open && (!wasOpen.current || initialMount.current)) {
      const active = document.activeElement
      opener.current =
        !initialMount.current &&
        active instanceof HTMLElement &&
        active !== document.body &&
        !dialog.current?.contains(active)
          ? active
          : null
      if (!initialMount.current && (flow.state.step !== 'verification' || flow.state.registration.status !== 'PENDING_VERIFICATION'))
        selectView(requested.current ?? initialView)
      requested.current = null
      close.current?.focus()
    }
    if (!open && wasOpen.current) {
      if (flow.state.step !== 'verification' || flow.state.registration.status !== 'PENDING_VERIFICATION')
        void flow.actions.cancel().catch(() => { /* The flow exposes cancellation failure. */ })
      const active = opener.current
      opener.current = null
      if (active?.isConnected && !active.matches(':disabled')) active.focus()
    }
    wasOpen.current = open
    initialMount.current = false
  }, [open])
  useEffect(() => {
    if (flow.state.step !== 'loading' && !canSignUp && flow.state.intent === 'sign-up') selectView('sign-in')
  }, [canSignUp, flow.state.step])
  const closeDialog = async () => {
    if (flow.state.pending) return
    if (flow.state.step === 'verification' && flow.state.registration.status === 'PENDING_VERIFICATION') {
      try { await flow.actions.cancelRegistration() } catch { return }
    }
    try { await flow.actions.cancel() } catch { return }
    onOpenChange(false)
  }
  const activeView = mode === 'embedded' ? flow.state.intent : hostedView
  const brand = useAuthBranding(activeView, appearance)
  const [frameAppearance, frameScheme] = useIamAppearance(appearance)
  const a = mode === 'embedded' ? brand.appearance : frameAppearance
  const colorScheme = mode === 'embedded' ? brand.scheme : frameScheme
  const trigger =
    children &&
    isValidElement<{ onClick?: (event: React.MouseEvent) => void; 'data-axis-auth-view'?: AuthDialogView }>(
      children,
    )
      ? cloneElement(children as ReactElement<{ onClick?: (event: React.MouseEvent) => void }>, {
          onClick: (event) => {
            children.props.onClick?.(event)
            if (event.defaultPrevented) return
            requested.current = triggerViewFor(children) ?? initialView
            onOpenChange(true)
          },
        })
      : children
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      dialog.current?.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((node) => !node.matches(':disabled') && !node.closest('[hidden]'))
    const first = controls[0],
      last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
  return (
    <>
      {trigger}
      {open && (
        <div
          className="axis-iam-auth-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              closeDialog()
            }
          }}
        >
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby={mode === 'embedded' && brand.branding?.welcomeTitle === '' ? undefined : titleId}
            aria-label={mode === 'embedded' && brand.branding?.welcomeTitle === '' ? l.authDialog.title(activeView) : undefined}
            data-color-scheme={colorScheme}
            className={['axis-iam-auth-dialog', className].filter(Boolean).join(' ')}
            style={{ ...dialogVariables(a), colorScheme, fontFamily: a.fontFamily, ...style }}
            onKeyDown={onKeyDown}
          >
            <style>{css}</style>
            <header className="axis-iam-auth-dialog-header">
              <h2 id={titleId}>{mode === 'embedded' ? brand.branding?.welcomeTitle ?? l.authDialog.title(activeView) : l.authDialog.title(activeView)}</h2>
              <button
                ref={close}
                type="button"
                className="axis-iam-auth-dialog-close"
                aria-label={l.authDialog.close}
                onClick={closeDialog}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </button>
            </header>
            <section className="axis-iam-auth-dialog-content" data-auth-dialog-panels>
              <div data-auth-view={activeView}>
                {mode === 'embedded' ? (
                  <BrandedAuthContent
                    key={activeView}
                    flow={flow}
                    brand={brand}
                    registrationGrant={signUpProps?.registrationGrant}
                    presentation="dialog"
                    renderProviderButton={signInProps?.renderProviderButton}
                    providerNavigation={signInProps?.providerNavigation}
                    onForgotPassword={signInProps?.onForgotPassword}
                    forgotPasswordUrl={signInProps?.forgotPasswordUrl}
                    showIntentSwitch={false}
                  />
                ) : activeView === 'sign-in' ? (
                  <SignIn {...signInProps} mode="redirect" presentation="dialog" />
                ) : (
                  <SignUp {...signUpProps} mode="redirect" presentation="dialog" />
                )}
              </div>
              {canSignUp && (
                <p style={{ margin: '24px 0 0', textAlign: 'center' }}>
                  <button
                    type="button"
                    style={{
                      border: 0,
                      padding: 8,
                      background: 'transparent',
                      color: a.textColor,
                      font: 'inherit',
                      textDecoration: 'underline',
                      textUnderlineOffset: 3,
                      cursor: 'pointer',
                    }}
                    onClick={() => selectView(activeView === 'sign-in' ? 'sign-up' : 'sign-in')}
                  >
                    {activeView === 'sign-in' ? l.authDialog.signUpTab : l.authDialog.signInTab}
                  </button>
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  )
}

function authDialogCanShowSignUp(
  mode: 'redirect' | 'embedded',
  allowSignUp: boolean,
  registrationGrant?: RegistrationGrantInput,
): boolean {
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

function triggerViewFor(
  element: ReactElement<{ 'data-axis-auth-view'?: AuthDialogView }>,
): AuthDialogView | undefined {
  if (element.props['data-axis-auth-view']) return element.props['data-axis-auth-view']
  if (element.type === SignInButton) return 'sign-in'
  if (element.type === SignUpButton) return 'sign-up'
  return undefined
}

function triggerStyle(a: ReturnType<typeof useIamAppearance>[0]): CSSProperties {
  return {
    minHeight: 40,
    padding: '9px 14px',
    border: `1px solid ${a.primaryColor}`,
    borderRadius: a.borderRadius,
    background: a.primaryColor,
    color: '#fff',
    font: `700 13px/18px ${a.fontFamily}`,
    textTransform: 'none',
    letterSpacing: 'normal',
    cursor: 'pointer',
  }
}

function dialogVariables(a: ReturnType<typeof useIamAppearance>[0]): CSSProperties {
  return {
    '--axis-auth-surface': a.surfaceColor,
    '--axis-auth-subtle': a.subtleColor,
    '--axis-auth-border': a.borderColor,
    '--axis-auth-text': a.textColor,
    '--axis-auth-focus': a.focusColor,
    '--axis-auth-radius': a.borderRadius,
  } as CSSProperties
}

const css = `.axis-iam-auth-dialog-overlay,.axis-iam-auth-dialog-overlay *{box-sizing:border-box;letter-spacing:0}.axis-iam-auth-dialog-overlay button,.axis-iam-auth-dialog-overlay input{font-family:inherit;text-transform:none}.axis-iam-auth-dialog-overlay{position:fixed;z-index:2147483647;inset:0;display:grid;place-items:center;padding:24px;overflow:auto;background:#111820b8}.axis-iam-auth-dialog{width:min(100%,480px);max-height:calc(100dvh - 48px);overflow:auto;border:1px solid var(--axis-auth-border);border-radius:var(--axis-auth-radius);background:var(--axis-auth-surface);color:var(--axis-auth-text)}.axis-iam-auth-dialog-header{display:grid;grid-template-columns:minmax(0,1fr) 36px;align-items:center;gap:12px;min-height:60px;padding:12px 18px;border-bottom:1px solid var(--axis-auth-border)}.axis-iam-auth-dialog-header h2{min-width:0;margin:0;overflow-wrap:anywhere;font-size:18px;line-height:24px}.axis-iam-auth-dialog-close{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:1px solid var(--axis-auth-border);border-radius:var(--axis-auth-radius);background:var(--axis-auth-surface);color:inherit;font:700 18px/1 sans-serif;cursor:pointer}.axis-iam-auth-dialog-content{min-width:0;padding:18px}.axis-iam-auth-dialog-content>div{max-width:none!important;margin:0!important;padding:0!important}.axis-iam-auth-dialog :focus-visible{outline:2px solid var(--axis-auth-focus);outline-offset:2px}@media(max-width:640px){.axis-iam-auth-dialog-overlay{display:block;padding:0;overflow:hidden}.axis-iam-auth-dialog{width:100%;height:100dvh;max-height:none;border:0;border-radius:0}.axis-iam-auth-dialog-header{min-height:calc(60px + env(safe-area-inset-top));padding:calc(12px + env(safe-area-inset-top)) calc(14px + env(safe-area-inset-right)) 12px calc(14px + env(safe-area-inset-left))}.axis-iam-auth-dialog-content{padding:18px calc(14px + env(safe-area-inset-right)) calc(18px + env(safe-area-inset-bottom)) calc(14px + env(safe-area-inset-left))}}`
