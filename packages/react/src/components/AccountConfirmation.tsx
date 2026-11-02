import { useEffect, useId, useRef } from 'react'
import type { Appearance, AppearanceColorScheme } from './styles'
import { buttonStyle } from './styles'
import { accountCenterVariables } from './accountCenterConfig'

/** Internal native modal shared by risk confirmation and protected exits. */
export function AccountConfirmation({ open, appearance: a, colorScheme, title, description, confirmLabel, cancelLabel, busy = false, confirmDisabled = false, onConfirm, onCancel }: {
  open: boolean
  appearance: Required<Appearance>
  colorScheme: AppearanceColorScheme
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const native = dialog.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    native?.showModal()
    cancel.current?.focus()
    return () => {
      native?.close()
      if (trigger?.isConnected && trigger.getClientRects().length > 0 && !trigger.matches(':disabled')) trigger.focus()
    }
  }, [open])
  if (!open) return null
  return <dialog ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} className="axis-account-confirmation" data-color-scheme={colorScheme}
    style={{ ...accountCenterVariables(a), backgroundColor: a.surfaceColor, color: a.textColor, colorScheme, fontFamily: a.fontFamily }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onCancel() }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) onCancel(); return }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
      const first = controls[0], last = controls[controls.length - 1]
      if (!first || !last) { event.preventDefault(); return }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
    <style>{`.axis-account-confirmation.axis-account-confirmation{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:28px;border:0;border-radius:14px;overflow:auto;box-shadow:0 24px 80px -24px #10182080;scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}.axis-account-confirmation::backdrop{background:#111820a8}.axis-account-confirmation h2{margin:0 0 12px;font-size:20px;font-weight:650;line-height:1.4;overflow-wrap:anywhere}.axis-account-confirmation p{margin:0;color:var(--a-muted);font-size:14px;line-height:1.65;overflow-wrap:anywhere}.axis-account-confirmation .axis-confirmation-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:26px}.axis-account-confirmation .axis-confirmation-actions>button{min-height:44px;width:auto;max-width:100%;white-space:normal;overflow-wrap:anywhere}.axis-account-confirmation button:focus-visible{outline:2px solid var(--a-focus);outline-offset:3px}.axis-account-confirmation button:disabled{opacity:.6;cursor:not-allowed}.axis-account-confirmation ::selection{background:var(--a-primary);color:#fff}@media(max-width:480px){.axis-account-confirmation.axis-account-confirmation{padding:24px}.axis-account-confirmation .axis-confirmation-actions{gap:8px}}`}</style>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    <div className="axis-confirmation-actions">
      <button ref={cancel} type="button" disabled={busy} onClick={onCancel} style={{ ...buttonStyle(a, 'ghost'), backgroundColor: a.subtleColor, border: 0, width: 'auto' }}>{cancelLabel}</button>
      <button type="button" disabled={busy || confirmDisabled} onClick={onConfirm} style={{ ...buttonStyle(a), width: 'auto', color: a.dangerColor, backgroundColor: `color-mix(in srgb,${a.dangerColor} 12%,${a.surfaceColor})` }}>{confirmLabel}</button>
    </div>
  </dialog>
}
