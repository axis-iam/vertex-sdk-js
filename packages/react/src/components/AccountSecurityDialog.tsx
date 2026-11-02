import { useEffect, useRef, useSyncExternalStore } from 'react'
import { AccountSecurityPanel } from './AccountSecurityPanel'
import type { AccountSecurityPanelProps } from './AccountSecurityPanel'
import { accountSecurityStore } from '../core/account-security-store'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { accountCenterVariables, useAccountCenterAppearance } from './accountCenterConfig'
import { mergeAppearances } from './styles'
import { AccountIcon } from './AccountIcon'
import { AccountSecurityExitContext, useAccountSecurityExit } from './accountSecurityExit'

export interface AccountSecurityDialogProps extends AccountSecurityPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}
/** Native modal focus boundary; content and operations are identical to the embedded panel. */
export function AccountSecurityDialog({ open, onOpenChange, ...props }: AccountSecurityDialogProps) {
  const { client } = useIamContext()
  const ui = useIamUi(), l = { ...ui.localization.security, ...props.localization }
  const actions = accountSecurityStore(client)
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot, actions.getSnapshot)
  const [a, scheme] = useAccountCenterAppearance(props.colorScheme ?? ui.colorScheme, mergeAppearances(ui.appearance, props.appearance), mergeAppearances(ui.darkAppearance, props.darkAppearance))
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null)
  const securityExit = useAccountSecurityExit()
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const native = dialog.current
    securityExit.reset()
    native?.showModal()
    close.current?.focus()
    return () => { native?.close(); actions.clearSensitive(); trigger?.focus() }
  }, [open, actions])
  const requestClose = () => securityExit.request(() => onOpenChange(false))
  if (!open) return null
  return <dialog ref={dialog} className="axis-security-dialog" aria-label={l.title} style={{ ...accountCenterVariables(a), colorScheme: scheme, position: 'relative', boxSizing: 'border-box', width: 'min(520px,calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', padding: 24, border: `1px solid ${a.borderColor}`, borderRadius: a.borderRadius, overflow: 'auto' }} onCancel={event => { event.preventDefault(); requestClose() }}>
    <style>{`.axis-security-dialog::backdrop{background:#111820a8}.axis-security-dialog .axis-iam-account-header{padding-right:48px}.axis-security-dialog{scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}.axis-security-dialog>.axis-security-dialog-close{position:absolute;top:16px;right:16px;display:grid;place-items:center;min-width:44px;min-height:44px;padding:8px;background:var(--a-surface);color:var(--a-text);border:1px solid var(--a-border);border-radius:var(--a-radius);font:inherit}.axis-security-dialog>button:focus-visible{outline:2px solid var(--a-focus);outline-offset:3px}`}</style>
    <button ref={close} className="axis-security-dialog-close" type="button" aria-label={l.close} disabled={state.pending || Boolean(state.uncertainCreate)} onClick={requestClose}><AccountIcon name="close" /></button>
    <AccountSecurityExitContext.Provider value={securityExit}><AccountSecurityPanel {...props} style={{ border: 0, padding: 0, ...props.style }} /></AccountSecurityExitContext.Provider>
  </dialog>
}
