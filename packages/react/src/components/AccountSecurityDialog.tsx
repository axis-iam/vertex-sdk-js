import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AccountSecurityPanel } from './AccountSecurityPanel'
import type { AccountSecurityPanelProps } from './AccountSecurityPanel'
import { accountSecurityStore } from '../core/account-security-store'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { accountCenterVariables, useAccountCenterAppearance } from './accountCenterConfig'
import { mergeAppearances } from './styles'
import { AccountIcon } from './AccountIcon'

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
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const native = dialog.current
    setConfirm(false)
    native?.showModal()
    close.current?.focus()
    return () => { native?.close(); actions.clearSensitive(); trigger?.focus() }
  }, [open, actions])
  const requestClose = () => {
    if (state.pending || state.uncertainCreate) return
    if (state.uncertain && state.operation && ['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(state.operation.state)) return
    if (state.operation && !['COMMITTED', 'CANCELLED', 'EXPIRED'].includes(state.operation.state)) { setConfirm(true); return }
    if (state.operation) actions.acknowledge()
    onOpenChange(false)
  }
  if (!open) return null
  return <dialog ref={dialog} className="axis-security-dialog" aria-label={l.title} style={{ ...accountCenterVariables(a), colorScheme: scheme, position: 'relative', boxSizing: 'border-box', width: 'min(520px,calc(100vw - 24px))', maxHeight: 'calc(100dvh - 24px)', padding: 24, border: `1px solid ${a.borderColor}`, borderRadius: a.borderRadius, overflow: 'auto' }} onCancel={event => { event.preventDefault(); requestClose() }}>
    <style>{`.axis-security-dialog::backdrop{background:#111820a8}.axis-security-dialog .axis-iam-account-header{padding-right:48px}.axis-security-dialog{scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}.axis-security-dialog>.axis-security-dialog-close{position:absolute;top:16px;right:16px;display:grid;place-items:center;min-width:44px;min-height:44px;padding:8px;background:var(--a-surface);color:var(--a-text);border:1px solid var(--a-border);border-radius:var(--a-radius);font:inherit}.axis-security-dialog>button:focus-visible{outline:2px solid var(--a-focus);outline-offset:3px}.axis-security-dialog-confirm{padding:16px 0}.axis-security-dialog-confirm button{min-height:44px;padding:8px 12px;margin:0 12px 8px 0;color:var(--a-text);background:var(--a-surface);border:1px solid var(--a-border);font:inherit}`}</style>
    <button ref={close} className="axis-security-dialog-close" type="button" aria-label={l.close} disabled={state.pending || Boolean(state.uncertainCreate)} onClick={requestClose}><AccountIcon name="close" /></button>
    {confirm && <div className="axis-security-dialog-confirm" role="alert"><p>{l.cancelConfirm}</p><button type="button" disabled={state.pending} onClick={() => {
      void actions.cancel().then(operation => {
        if (operation?.state === 'CANCELLED' || operation?.state === 'EXPIRED') onOpenChange(false)
        setConfirm(false)
      }).catch(() => { setConfirm(false) }) // The panel renders the store's unconfirmed cancellation and status recovery.
    }}>{l.cancelNow}</button><button type="button" onClick={() => setConfirm(false)}>{l.keep}</button></div>}
    <AccountSecurityPanel {...props} style={{ border: 0, padding: 0, ...props.style }} />
  </dialog>
}
