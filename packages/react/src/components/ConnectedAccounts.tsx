import { operationReference } from '../core/server-session-client'
import { identityErrorMessage } from '../identity-localization'
import { IamApiError } from '../core/types'
import { SessionTransportError } from '@axis-iam/vertex'
import { assertIdentityWebAuthn } from '../core/identity-webauthn'
import { phoneCountries } from './sign-in/phone-identifier'
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AccountIdentifiers, AccountLoginMethods, CreateIdentityOperation, IdentityProofPurpose, LoginIdentifier, TargetProofMethod, IdentifierManagementCapability } from '@axis-iam/vertex'
import type { LinkableIdentityProvider } from '../core/types'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { accountCenterVariables, useAccountCenterAppearance } from './accountCenterConfig'
import { AccountIcon } from './AccountIcon'
import { AccountConfirmation } from './AccountConfirmation'
import { IdentityOperationExitContext, useIdentityOperationExit } from './identityOperationExit'
import { useIdentityOperations } from '../hooks/useIdentityOperations'
import { buttonStyle, containerStyle, errorStyle, inputStyle, labelStyle, mergeAppearances } from './styles'
import type { Appearance, AppearanceColorScheme } from './styles'

type WithoutVersion<T> = T extends unknown ? Omit<T, 'expectedLoginMethodVersion'> : never
type ProofOption = {
  key: string
  method: 'PASSWORD' | 'STEP_UP_PROOF' | 'PROVIDER' | TargetProofMethod
  label: string
  methodId?: string
  identifierId?: string
}

function IdentifierActionsMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const disclosure = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = panel.current
    if (!open || !node) return
    node.showPopover?.()
    const boundaryNode = summary.current?.closest('.axis-ac-content') ?? summary.current?.closest('.axis-identity-methods')
    const place = () => {
      const anchor = summary.current?.getBoundingClientRect()
      if (!anchor) return
      const boundary = boundaryNode?.getBoundingClientRect()
      if (!boundary) return
      const height = node.getBoundingClientRect().height
      const below = boundary.bottom - anchor.bottom - 12
      const above = anchor.top - boundary.top - 12
      node.style.maxWidth = `${Math.max(180, boundary.width - 24)}px`
      node.style.maxHeight = `${Math.max(100, boundary.height - 24)}px`
      node.style.left = `${Math.max(boundary.left + 12, Math.min(boundary.right - node.offsetWidth - 12, anchor.right - node.offsetWidth))}px`
      node.style.top = `${Math.max(boundary.top + 12, below >= height || below >= above ? anchor.bottom + 6 : anchor.top - height - 6)}px`
    }
    place()
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !disclosure.current?.contains(event.target)) setOpen(false) }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); setOpen(false); summary.current?.focus()
    }
    let frame = 0
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    })
    if (boundaryNode) resizeObserver.observe(boundaryNode)
    if (summary.current) resizeObserver.observe(summary.current)
    document.addEventListener('pointerdown', outside)
    disclosure.current?.addEventListener('keydown', escape)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      node.hidePopover?.()
      document.removeEventListener('pointerdown', outside)
      resizeObserver.disconnect()
      cancelAnimationFrame(frame)
      disclosure.current?.removeEventListener('keydown', escape)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  return <details ref={disclosure} className="axis-identity-action-menu" open={open}>
    <summary ref={summary} aria-label={label} aria-expanded={open} onClick={event => { event.preventDefault(); setOpen(value => !value) }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>
    </summary>
    <div ref={panel} popover="manual" className="axis-identity-action-popover" onClick={event => {
      if (event.target instanceof Element && event.target.closest('button:not(:disabled)')) setOpen(false)
    }}>{children}</div>
  </details>
}

export interface ConnectedAccountsProps {
  appearance?: Appearance
  colorScheme?: AppearanceColorScheme
  darkAppearance?: Appearance
  redirectUri?: string
  /** AccountCenter already supplies the protected dialog and its focus boundary. */
  embedded?: boolean
}
interface IdentityViewState {
  facts: { identifiers: AccountIdentifiers; methods: AccountLoginMethods; providers: LinkableIdentityProvider[] } | null
  error: Error | null
  kind: LoginIdentifier['kind']
  value: string
  region: string
  selection: { type: 'REPLACE' | 'REMOVE'; id: string; display: string } | null
  removeOld: boolean
  primary: string
  password: string
  code: string
  stepUp: { challengeId: string; availableMethods: string[] } | null
  providerExpanded: boolean
  providerPending: boolean
  proofChoice: { scope: string; key: string } | null
  stepUpMethod: 'totp' | 'webauthn' | null
  providerReturn: string | null
  recipientProved: string | null
  targetProvider: string | null
  reload: number
  currentChallengeId: string | null
  emailManagement: boolean
  emailPage: number
  operationOpen: boolean
  adding: boolean
}
function emptyView(): IdentityViewState {
  return { facts: null, error: null, kind: 'EMAIL', value: '', region: '', selection: null,
    removeOld: true, primary: '', password: '', code: '',
    stepUp: null, providerExpanded: false, providerPending: false, proofChoice: null, stepUpMethod: null,
    providerReturn: null, recipientProved: null, targetProvider: null,
    reload: 0, operationOpen: false, adding: false, currentChallengeId: null, emailManagement: false, emailPage: 0 }
}
/** Facts first, connected providers second, additions last; all writes use durable operations. */
export function ConnectedAccounts({ appearance, colorScheme, darkAppearance, redirectUri, embedded = false }: ConnectedAccountsProps) {
  const { client, login } = useIamContext()
  const ui = useIamUi()
  const { localization: { identity: l }, locale } = ui
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme,
    mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const { state, actions } = useIdentityOperations()
  const localExit = useIdentityOperationExit()
  const hostExit = useContext(IdentityOperationExitContext)
  const identityExit = hostExit ?? localExit
  const prefix = useId()
  const emailHeading = useRef<HTMLDivElement>(null)
  const activeReference = state.operation ? operationReference(state.operation) : null
  const generation = client.state.generation
  const [owned, setOwned] = useState(() => ({ client, generation, view: emptyView() }))
  // Reset before rendering the new identity; effect-time clearing would expose the old draft.
  const current = owned.client === client && owned.generation === generation
    ? owned : { client, generation, view: emptyView() }
  if (current !== owned) setOwned(current)
  const { facts, error, kind, value, region, selection, removeOld, primary,
    password, code, stepUp, providerExpanded, providerPending, proofChoice, stepUpMethod, providerReturn,
    recipientProved, targetProvider, reload, operationOpen, adding, currentChallengeId, emailManagement, emailPage } = current.view
  const dialog = useRef<HTMLDialogElement>(null)
  const operationBody = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!operationOpen) return
    const native = dialog.current
    const node = embedded ? operationBody.current : native
    if (!embedded && native && !native.open) native.showModal()
    const field = node?.querySelector<HTMLElement>('input:not([disabled])') ?? node?.querySelector<HTMLElement>('button:not([disabled])')
    field?.focus()
    return () => {
      if (!embedded) native?.close()
      const target = trigger.current?.isConnected && !trigger.current.matches(':disabled')
        ? trigger.current : surface.current?.querySelector<HTMLElement>('button:not([disabled])')
      target?.focus()
    }
  }, [operationOpen, embedded, activeReference])
  function update<K extends keyof IdentityViewState>(key: K, value: IdentityViewState[K] | ((previous: IdentityViewState[K]) => IdentityViewState[K])) {
    setOwned(previous => {
      if (previous.client !== client || previous.generation !== generation || client.state.generation !== generation) return previous
      return { ...previous, view: { ...previous.view, [key]: typeof value === 'function' ? value(previous.view[key]) : value } }
    })
  }
  useEffect(() => () => actions.cancelProviderWindow(), [actions, client, generation])
  const run = (work: () => Promise<unknown>) => {
    if (client.state.generation !== generation) return
    update('error', null)
    void work().catch(e => update('error', e instanceof Error ? e : new Error(l.error)))
  }
  useEffect(() => {
    let active = true
    update('facts', null); update('error', null); update('password', ''); update('code', '')
    Promise.all([client.identity.identifiers(), client.identity.loginMethods(), client.listLinkableIdentityProviders()])
      .then(([identifiers, methods, providers]) => {
        client.state.assertCurrent(generation)
        if (active) update('facts', { identifiers, methods, providers })
      }).catch(e => { if (active) update('error', e instanceof Error ? e : new Error(l.error)) })
    return () => { active = false }
  }, [client, generation, state.operation?.state, reload])
  useEffect(() => {
    run(async () => { const saved = await actions.resumeSaved(); if (saved) update('operationOpen', true) })
  }, [actions, generation])
  useEffect(() => {
    if (activeReference) update('operationOpen', true)
  }, [activeReference, generation])
  useEffect(() => {
    const op = state.operation
    if (!op) return
    const deadlines = [op.nextChallengeAt, op.expiresAt].filter((x): x is string => typeof x === 'string').map(Date.parse).filter(x => x > Date.now())
    if (!deadlines.length) return
    const delay = Math.min(Math.min(...deadlines) - Date.now() + 1, 2_147_483_647)
    const timer = setTimeout(() => { update('reload', n => n + 1); run(() => actions.reopen()) }, delay)
    return () => clearTimeout(timer)
  }, [actions, generation, state.operation])
  const op = state.operation
  const actionError = error ?? state.error
  const errorCode = actionError instanceof IamApiError || actionError instanceof SessionTransportError ? actionError.code : undefined
  const recipient = op?.type === 'TRANSFER' && !op.requiredProofs.some(p => p.purpose === 'CURRENT_ACCOUNT')
  const expired = Boolean(op && Date.parse(op.expiresAt) <= Date.now())
  const terminal = !op || expired || ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state)
  const busy = state.pending || providerPending
  const uncertain = state.uncertain || state.cancelUnconfirmed || Boolean(state.error && (
    !(state.error instanceof IamApiError || state.error instanceof SessionTransportError) ||
    state.error.status === 0 || (state.error.status !== undefined && state.error.status >= 500)
  ))
  const canWrite = Boolean(op && !terminal && !busy && !uncertain)
  const finishCreate = (work: () => Promise<unknown>) => run(async () => {
    update('error', null)
    try {
      await work()
      client.state.assertCurrent(generation)
      update('selection', null)
      update('adding', false)
      update('operationOpen', true)
      update('password', ''); update('code', '')
    } catch (error) {
      client.state.assertCurrent(generation)
      if ((error instanceof IamApiError || error instanceof SessionTransportError) && error.code === 'STALE_LOGIN_METHOD_VERSION') {
        update('facts', null)
        update('reload', n => n + 1)
      }
      throw error
    }
  })
  const typed = (): LoginIdentifier => kind === 'PHONE' ? { kind, value, ...(region ? { region } : {}) } : { kind, value }
  const create = (input: WithoutVersion<CreateIdentityOperation>) => {
    if (busy || !terminal || state.uncertainCreate) return
    if (!facts || facts.identifiers.loginMethodVersion !== facts.methods.loginMethodVersion) { update('error', new Error(l.error)); return }
    if (input.type === 'ADD' && !facts.identifiers.management.add[input.payload.identifier.kind].allowed) return
    if (input.type !== 'ADD' && input.type !== 'LINK' && input.type !== 'UNLINK') {
      const identifier = facts.identifiers.items.find(item => item.id === input.payload.identifierId)
      if (!identifier?.capabilities[input.type].allowed) return
    }
    update('targetProvider', input.type === 'LINK' ? input.payload.providerId : null)
    update('recipientProved', null)
    update('proofChoice', null)
    update('providerReturn', null)
    update('stepUp', null); update('stepUpMethod', null); update('currentChallengeId', null)
    finishCreate(() => actions.create({ ...input, expectedLoginMethodVersion: facts.methods.loginMethodVersion }))
  }
  const button = (text: string, action: () => void, disabled = busy, descriptionId?: string, fullWidth = false) => <button type="button" disabled={disabled} aria-describedby={descriptionId} onClick={event => { if (!operationOpen) trigger.current = event.currentTarget.closest('details')?.querySelector('summary') ?? event.currentTarget; action() }} style={{ ...buttonStyle(a, 'ghost'), border: 0, width: fullWidth ? '100%' : 'auto', justifyContent: fullWidth ? 'flex-start' : 'center', ...(fullWidth ? { backgroundColor: 'transparent', textAlign: 'left' as const } : {}) }}>{text}</button>
  const capabilityButton = (text: string, capability: IdentifierManagementCapability, action: () => void, key: string, compact = false) => {
    const description = `${prefix}-capability-${key}`
    return <div>{button(text, action, busy || !terminal || !capability.allowed, capability.unavailableReasons.length ? description : undefined, compact)}
      {capability.unavailableReasons.length > 0 && <p id={description} style={{ color: a.mutedTextColor, fontSize: 13 }}>{capability.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}</div>
  }
  const field = (name: string, text: string, content: string, update: (s: string) => void, type = 'text', required = false) => <div style={{ margin: '12px 0' }}>
    <label htmlFor={`${prefix}-${name}`} style={labelStyle(a)}>{text}</label>
    <input id={`${prefix}-${name}`} type={type} required={required} value={content} onChange={e => update(e.target.value)} style={inputStyle(a)} autoComplete={type === 'password' ? 'current-password' : 'off'} />
  </div>
  const phoneRegionField = <div style={{ margin: '12px 0' }}>
    <label htmlFor={`${prefix}-region`} style={labelStyle(a)}>{l.phoneCountry}</label>
    <select id={`${prefix}-region`} required value={region} onChange={e => update('region', e.target.value)} style={inputStyle(a)} autoComplete="tel-country-code">
      <option value="">{l.choosePhoneCountry}</option>
      {phoneCountries(locale).map(option => <option key={option.code} value={option.code}>{option.name} ({option.callingCode})</option>)}
    </select>
  </div>
  const identifierFields = <>
    {field('value', l.newIdentifier[kind], value, v => update('value', v), kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'tel' : 'text', true)}
    {kind === 'PHONE' && phoneRegionField}
  </>
  async function provider(purpose: IdentityProofPurpose, methodId?: string) {
    if (client.mode !== 'server_session' && !redirectUri) { update('error', new Error(l.unavailable)); return }
    update('providerPending', true)
    try {
      await actions.openProvider(purpose, redirectUri ? new URL(redirectUri, window.location.origin).toString() : undefined, methodId)
      client.state.assertCurrent(generation)
    } finally { if (client.state.generation === generation) update('providerPending', false) }
  }
  const selectedCapability = selection ? facts?.identifiers.items.find(item => item.id === selection.id)?.capabilities[selection.type] : adding ? facts?.identifiers.management.add[kind] : undefined
  const primaryCandidates = facts?.identifiers.items.filter(item => selectedCapability?.replacementPrimaryIds.includes(item.id)) ?? []
  const replacementRequired = selectedCapability?.requirements.includes('REPLACEMENT_PRIMARY') === true
  function submitSelection(event: FormEvent) {
    event.preventDefault()
    if (!selection || !selectedCapability?.allowed || busy || !terminal || state.uncertainCreate) return
    if (replacementRequired && !primaryCandidates.some(item => item.id === primary)) return
    if (selection.type === 'REPLACE') create({ type: 'REPLACE', payload: { identifierId: selection.id, replacement: typed(), removeOld, ...(primary ? { replacementPrimaryId: primary } : {}) } })
    if (selection.type === 'REMOVE') create({ type: 'REMOVE', payload: { identifierId: selection.id, ...(primary ? { replacementPrimaryId: primary } : {}) } })
  }
  function continueLater() {
    if (state.pending || state.uncertainCreate || state.uncertain || state.cancelUnconfirmed || providerPending) return
    actions.cancelProviderWindow()
    if (op && ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state)) {
      const reauthenticate = op.completion?.sessionImpact === 'REAUTHENTICATE'
      actions.acknowledge()
      if (reauthenticate) void login().catch(error => update('error', error instanceof Error ? error : new Error(l.error)))
    }
    update('operationOpen', false); update('adding', false); update('selection', null)
    update('password', ''); update('code', ''); update('value', ''); update('stepUp', null)
    update('providerReturn', null); update('proofChoice', null); update('stepUpMethod', null)
  }
  const requestLeave = () => { if (!busy) identityExit.request(continueLater) }
  const accountPurpose = recipient ? 'TRANSFER_COUNTERPART' : 'CURRENT_ACCOUNT'
  const accountProof = op?.requiredProofs.find(p => p.purpose === accountPurpose && !p.satisfied)
  const accountDone = recipient && recipientProved === activeReference
  const targetProof = op?.state === 'AWAITING_PROOF' && !recipient &&
    op.requiredProofs.every(p => p.purpose !== 'CURRENT_ACCOUNT' || p.satisfied)
    ? op.requiredProofs.find(p => p.purpose === 'TARGET_OWNERSHIP' && !p.satisfied) : undefined
  const proof = !terminal && accountProof && !accountDone &&
    (recipient || op?.state === 'AWAITING_REAUTH') ? accountProof : !terminal ? targetProof : undefined
  const proofScope = `${activeReference}:${proof?.purpose ?? ''}`
  const proofOptions: ProofOption[] = []
  if (proof) {
    if (proof.purpose !== 'TARGET_OWNERSHIP') {
      for (const option of op?.proofOptions ?? []) {
        if (!proof.methods.includes(option.method)) continue
        if (option.method === 'PASSWORD') proofOptions.push({ key: 'password', method: 'PASSWORD', label: l.passwordMethod })
        if (option.method === 'STEP_UP_PROOF') proofOptions.push({ key: 'step-up', method: 'STEP_UP_PROOF', label: l.stepUp })
        if (option.method === 'EMAIL_OTP') proofOptions.push({ key: `email:${option.identifierId}`, method: 'EMAIL_OTP', identifierId: option.identifierId, label: `${l.EMAIL}: ${option.maskedIdentifier}` })
        if (option.method === 'PROVIDER') proofOptions.push({ key: `provider:${option.methodId}`, method: 'PROVIDER', methodId: option.methodId, label: l.providerMethod(option.displayName) })
      }
    } else if (proof.methods.includes('PROVIDER')) {
      const name = facts?.providers.find(p => p.id === targetProvider)?.displayName
      proofOptions.push({ key: 'provider-target', method: 'PROVIDER', label: name ? l.providerMethod(name) : l.providerAuth })
    }
    for (const method of ['EMAIL_OTP', 'PHONE_OTP'] as const) {
      if (proof.purpose === 'TARGET_OWNERSHIP' && proof.methods.includes(method))
        proofOptions.push({ key: method, method, label: method === 'EMAIL_OTP' ? l.EMAIL : l.PHONE })
    }
  }
  // Prefer password, then an enrolled authenticator; multiple providers require an explicit choice.
  const choice = (proofChoice?.scope === proofScope ? proofOptions.find(o => o.key === proofChoice.key) : undefined) ??
    proofOptions.find(o => o.method === 'PASSWORD') ?? proofOptions.find(o => o.method === 'STEP_UP_PROOF') ??
    (proofOptions.length === 1 ? proofOptions[0] : undefined)
  const returningProvider = Boolean(choice && providerReturn === `${proofScope}:${choice.key}`)
  const authenticator = stepUpMethod ?? (stepUp?.availableMethods.includes('totp') ? 'totp' : stepUp?.availableMethods.includes('webauthn') ? 'webauthn' : null)
  useEffect(() => {
    if (!operationOpen || adding || selection) return
    const node = embedded ? operationBody.current : dialog.current
    const target = node?.querySelector<HTMLElement>('input:not([disabled]),button[data-operation-primary]:not([disabled])') ?? node?.querySelector<HTMLElement>('.axis-identity-operation-actions button:not([disabled])')
    target?.focus()
  }, [proofScope, choice?.key, authenticator, operationOpen, adding, selection, embedded])
  function change(work: () => Promise<unknown>) {
    if (!canWrite || actions.getSnapshot().operation !== op) return
    run(work)
  }
  async function accountVerified(work: () => Promise<unknown>) {
    await work()
    client.state.assertCurrent(generation)
    if (recipient) update('recipientProved', activeReference)
  }
  async function externalProof(work: () => Promise<unknown>) {
    update('providerPending', true)
    try { await work(); client.state.assertCurrent(generation) }
    finally { update('providerPending', false) }
  }
  function selectProof(option: ProofOption) {
    if (busy || uncertain) return
    actions.cancelProviderWindow()
    update('proofChoice', { scope: proofScope, key: option.key })
    update('password', ''); update('code', ''); update('stepUp', null)
    update('stepUpMethod', null); update('providerReturn', null); update('error', null); update('currentChallengeId', null)
  }
  const proofFormId = `${prefix}-proof`
  const createFormId = `${prefix}-create`
  let primaryAction: { label: string; form?: string; action?: () => void; disabled: boolean } | null = null
  let proofFields: ReactNode = null
  if (proof && choice) {
    if (choice.method === 'PASSWORD') {
      primaryAction = { label: l.verifyContinue, form: proofFormId, disabled: !canWrite || !password }
      proofFields = <form id={proofFormId} onSubmit={e => {
        e.preventDefault()
        if (!password) return
        change(() => accountVerified(() => actions.reauthenticate({ method: 'PASSWORD', password })))
        update('password', '')
      }}>{field('password', l.password, password, v => update('password', v), 'password', true)}</form>
    } else if (choice.method === 'EMAIL_OTP' && proof.purpose !== 'TARGET_OWNERSHIP') {
      primaryAction = { label: l.verifyContinue, form: proofFormId, disabled: !canWrite || !currentChallengeId || code.length !== 6 }
      proofFields = <form id={proofFormId} onSubmit={e => {
        e.preventDefault()
        if (!currentChallengeId || code.length !== 6) return
        change(() => accountVerified(() => actions.reauthenticate({ method: 'EMAIL_OTP', challengeId: currentChallengeId, code })))
        update('code', '')
      }}>{field('current-code', l.otp, code, v => update('code', v), 'text', true)}
        <div className="axis-identity-secondary">{button(l.sendAccountCode, () => change(async () => {
          if (!choice.identifierId) return
          const challenge = await actions.currentAccountChallenge(choice.identifierId)
          client.state.assertCurrent(generation)
          update('currentChallengeId', challenge)
        }), !canWrite || Boolean(op?.nextChallengeAt && Date.parse(op.nextChallengeAt) > Date.now()))}</div>
      </form>
    } else if (choice.method === 'EMAIL_OTP' || choice.method === 'PHONE_OTP') {
      const method = choice.method
      primaryAction = { label: l.verifyComplete, form: proofFormId, disabled: !canWrite || code.length !== 6 }
      proofFields = <form id={proofFormId} onSubmit={e => {
        e.preventDefault()
        if (code.length !== 6) return
        change(() => actions.complete(method, code))
        update('code', '')
      }}>
        {field('target-code', l.otp, code, v => update('code', v), 'text', true)}
        <div className="axis-identity-secondary">{button(l.send, () => {
          if (op?.nextChallengeAt && Date.parse(op.nextChallengeAt) > Date.now()) return
          change(() => actions.challenge(method))
        }, !canWrite || Boolean(op?.nextChallengeAt && Date.parse(op.nextChallengeAt) > Date.now()))}</div>
      </form>
    } else if (choice.method === 'PROVIDER') {
      primaryAction = {
        label: returningProvider ? l.providerDone : choice.label,
        disabled: !canWrite,
        action: () => {
          if (returningProvider) change(() => accountVerified(async () => {
            await actions.providerCallback(); update('providerReturn', null)
          }))
          else change(async () => {
            await provider(proof.purpose, choice.methodId)
            client.state.assertCurrent(generation)
            update('providerReturn', `${proofScope}:${choice.key}`)
          })
        },
      }
      if (proof.purpose === 'TARGET_OWNERSHIP' && !targetProvider)
        proofFields = <p>{l.providerUnavailable}</p>
    } else if (!stepUp) {
      primaryAction = { label: l.stepUp, disabled: !canWrite, action: () => change(() => externalProof(async () => {
        const challenge = await actions.startOperationStepUp()
        client.state.assertCurrent(generation)
        update('stepUp', { challengeId: challenge.challengeId, availableMethods: challenge.availableMethods.map(method => method === 'TOTP' ? 'totp' : 'webauthn') })
      })) }
    } else if (authenticator === 'totp') {
      primaryAction = { label: l.verifyContinue, form: proofFormId, disabled: !canWrite || code.length !== 6 }
      proofFields = <form id={proofFormId} onSubmit={e => {
        e.preventDefault()
        if (code.length !== 6) return
        change(() => externalProof(() => accountVerified(async () => {
          await actions.verifyOperationStepUp(stepUp.challengeId, code)
        })))
        update('code', '')
      }}>{field('totp', l.otp, code, v => update('code', v), 'text', true)}</form>
    } else if (authenticator === 'webauthn') {
      primaryAction = { label: l.webauthn, disabled: !canWrite, action: () => change(() => externalProof(() => accountVerified(async () => {
        const start = await actions.startOperationWebAuthn(stepUp.challengeId)
        client.state.assertCurrent(generation)
        const credential = await assertIdentityWebAuthn(start.publicKey)
        client.state.assertCurrent(generation)
        await actions.verifyOperationWebAuthn(stepUp.challengeId, start.requestId, credential)
      }))) }
    }
  } else if (!terminal && recipient && accountDone && op?.requiredProofs.some(p => p.purpose === 'TRANSFER_COUNTERPART' && !p.satisfied)) {
    primaryAction = { label: l.accept, disabled: !canWrite, action: () => change(() => actions.confirmTransfer('ACCEPT')) }
  } else if (!terminal && !recipient && op?.state === 'READY' && op.requiredProofs.every(p => p.satisfied)) {
    primaryAction = { label: op.type === 'LINK' ? l.confirmProviderTarget : l.complete, disabled: !canWrite || (op.type === 'LINK' && !op.providerTarget), action: () => change(() => actions.complete()) }
  }
  if (adding || selection) primaryAction = { label: adding ? l.add : l.complete, form: createFormId, disabled: busy || !terminal || !selectedCapability?.allowed || Boolean(state.uncertainCreate) }
  const emails = facts?.identifiers.items.filter(i => i.kind === 'EMAIL') ?? []
  const emailPages = Math.max(1, Math.ceil(emails.length / 5))
  const visibleEmailPage = Math.min(emailPage, emailPages - 1)
  const displayedIdentifiers = facts?.identifiers.items.filter(i => i.kind !== 'EMAIL') ?? []
  const displayedEmails = emails.slice(visibleEmailPage * 5, visibleEmailPage * 5 + 5)
  const primaryEmail = emails.find(i => i.isPrimary)
  useEffect(() => { if (emailManagement) emailHeading.current?.focus() }, [emailManagement, visibleEmailPage])
  const operationTitle = selection
    ? `${selection.type === 'REPLACE' ? l.change : l.remove}: ${selection.display}`
    : adding ? (kind === 'EMAIL' ? l.addEmail : kind === 'PHONE' ? l.addPhone : l.addUsername)
    : op ? expired ? l.EXPIRED : recipient && accountDone && primaryAction?.label === l.accept ? l.accept : l[op.state] : l.add
  const operationContent = <>
    <div className="axis-identity-operation-heading" data-complete={!adding && !selection && op?.state === 'COMMITTED'}>
      <span className="axis-identity-symbol"><AccountIcon name={!adding && !selection && op?.state === 'COMMITTED' ? 'check' : 'methods'} size={24} /></span>
      <h3 id={`${prefix}-operation-title`}>{operationTitle}</h3>
    </div>
    {state.uncertainCreate && <div role="alert"><p>{l.createUnconfirmed}</p>{button(l.recoverCreate, () => finishCreate(() => actions.retryCreate()))}</div>}
    {(error || state.error) && <p role="alert" style={errorStyle(a)}>{identityErrorMessage(errorCode, locale)}</p>}
    {state.cancelUnconfirmed && <p role="alert">{l.cancelUnconfirmed}</p>}
    {uncertain && op && <div className="axis-identity-secondary">{button(l.queryStatus, () => run(() => actions.reopen()))}</div>}
    <fieldset disabled={Boolean(state.uncertainCreate || uncertain || busy)} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    {selection && terminal && <form id={createFormId} onSubmit={submitSelection}>
      {selection.type === 'REPLACE' && <>{identifierFields}{selectedCapability?.requirements.includes('REMOVE_OLD') ? <p>{l.managementRequirement.REMOVE_OLD}</p> : <label><input type="checkbox" checked={removeOld} onChange={e => update('removeOld', e.target.checked)} />{l.removeOld}</label>}</>}
      {replacementRequired && <><label htmlFor={`${prefix}-replacement-primary`} style={labelStyle(a)}>{l.replacementPrimary}</label>
      <select id={`${prefix}-replacement-primary`} style={inputStyle(a)} value={primary} required onChange={e => update('primary', e.target.value)}>
        <option value="">{l.primary}</option>
        {primaryCandidates.map(i => <option key={i.id} value={i.id}>{i.displayValue}</option>)}
      </select></>}
      {(selection.type === 'REMOVE' || removeOld) && <p>{l.lastPathProtection}</p>}
    </form>}
    {adding && <form id={createFormId} onSubmit={e => { e.preventDefault(); create({ type: 'ADD', payload: { identifier: typed() } }) }}>
      {field('value', l[kind], value, v => update('value', v), kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'tel' : 'text', true)}
      {kind === 'PHONE' && phoneRegionField}
    </form>}
    {(adding || selection) && selectedCapability && <section className="axis-identity-requirements" aria-label={l.managementRequirements}>
      <p>{selectedCapability.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>
      <ul>{selectedCapability.requirements.filter(requirement => !['REMOVE_OLD', 'REMAINING_LOGIN_PATH', 'NEW_IDENTIFIER', 'REPLACEMENT_PRIMARY'].includes(requirement)).map(requirement => <li key={requirement}>{l.managementRequirement[requirement]}</li>)}</ul>
      <h4>{l.managementProofs}</h4><ul>{facts?.identifiers.management.proofOptions.map((option, index) => <li key={index}>{option.method === 'PASSWORD' ? l.passwordMethod : option.method === 'EMAIL_OTP' ? `${l.EMAIL}: ${option.maskedIdentifier}` : option.method === 'PROVIDER' ? l.providerMethod(option.displayName) : l.stepUp}</li>)}</ul>
    </section>}
    {op && !adding && !selection && <section aria-label={l.status}>
      {op.completion?.sessionImpact === 'REAUTHENTICATE' && <p role="status">{l.relogin}</p>}
      {op.maskedIdentifier && <p>{op.maskedIdentifier}</p>}
      {op.type === 'LINK' && !expired && !uncertain && !['CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state) && (op.providerTarget ? <section className="axis-identity-provider-target" aria-label={l.providerTargetTitle}>
        <h4>{l.providerTargetTitle}</h4>{op.providerTarget.maskedDisplayName && <p>{op.providerTarget.maskedDisplayName}</p>}{op.providerTarget.maskedEmail && <p>{op.providerTarget.maskedEmail}</p>}
        {!op.providerTarget.maskedDisplayName && !op.providerTarget.maskedEmail && <p>{l.providerTargetPrivate}</p>}
      </section> : <p role="status">{l.providerTargetPending}</p>)}
      {proof && <div><h4>{l[proof.purpose]}</h4>{proofFields}
        {!choice && proofOptions.length === 0 && <p>{l.unavailable}</p>}
        {proofOptions.length > 1 && <details className="axis-identity-proof-options" key={choice?.key}>
          <summary>{l.otherProofs}</summary>
          <div className="axis-identity-secondary">{proofOptions.filter(option => option.key !== choice?.key).map(option =>
            <span key={option.key}>{button(option.label, () => selectProof(option), busy || uncertain)}</span>)}</div>
        </details>}
        {choice?.method === 'STEP_UP_PROOF' && stepUp && stepUp.availableMethods.length > 1 &&
          <div className="axis-identity-secondary">{button(authenticator === 'totp' ? l.webauthn : l.otp, () => {
            if (busy || uncertain) return
            update('stepUpMethod', authenticator === 'totp' ? 'webauthn' : 'totp'); update('code', '')
          }, busy || uncertain)}</div>}
      </div>}
      {!terminal && !proof && !primaryAction && <p>{op.type === 'TRANSFER' ? l.awaitingCounterpart : l.unavailable}</p>}
      {op.type === 'TRANSFER' && !terminal && <p>{l.transferWarning}</p>}
    </section>}
    </fieldset>
    <div className="axis-identity-operation-actions">
      {primaryAction && <button data-operation-primary type={primaryAction.form ? 'submit' : 'button'} form={primaryAction.form}
        onClick={primaryAction.action} disabled={primaryAction.disabled}
        style={{ ...buttonStyle(a), width: 'auto', ...(primaryAction.disabled ? { backgroundColor: a.subtleColor, color: a.mutedTextColor, cursor: 'not-allowed' } : {}) }}>{primaryAction.label}</button>}
      {button(op?.completion?.sessionImpact === 'REAUTHENTICATE' && !adding && !selection ? l.signIn : op && terminal && !adding && !selection ? l.done : l.later, requestLeave, busy || uncertain || Boolean(state.uncertainCreate))}
    </div>
    {op && !terminal && !adding && !selection && <div className="axis-identity-operation-cancel">
      <button type="button" className="axis-identity-text-action" disabled={!canWrite}
        onClick={() => identityExit.request()}
        style={{ color: a.mutedTextColor }}>{recipient ? l.reject : l.cancelChange}</button>
    </div>}
    {op && !adding && !selection && <div className="axis-identity-operation-meta" style={{ color: a.mutedTextColor }}>
      {!terminal && <p>{l.remaining(Math.max(0, Math.ceil((Date.parse(op.expiresAt) - Date.now()) / 60000)))}</p>}
      <details><summary>{l.details}</summary><p>{l.operationId}: {operationReference(op)}</p><p>{l.expires}: {new Date(op.expiresAt).toLocaleString(locale)}</p><p>{op.type} / {op.state}</p></details>
    </div>}
  </>
  return <section ref={surface} className="axis-identity-methods" aria-label={l.title} data-color-scheme={resolvedColorScheme} style={{ ...accountCenterVariables(a), ...containerStyle(a), ...(embedded ? { backgroundColor: 'transparent', borderRadius: 0 } : {}), width: '100%', padding: embedded ? 0 : 24, colorScheme: resolvedColorScheme, maxWidth: 'none', minWidth: 0 }}>
    <style>{`
.axis-identity-methods{container-type:inline-size;font-size:14px;line-height:1.55}
.axis-identity-methods *{box-sizing:border-box}.axis-identity-methods svg{flex:none}
.axis-identity-methods p{overflow-wrap:anywhere;max-width:65ch;margin:8px 0;line-height:1.65}
.axis-identity-methods h2{margin:0;font-size:25px;line-height:1.35;font-weight:650}
.axis-identity-methods h3{font-size:15px;line-height:1.5;font-weight:600;margin:0 0 12px}
.axis-identity-methods h4{font-size:14px;font-weight:600}
.axis-identity-header{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:30px}
.axis-identity-header p{margin-top:9px;color:var(--a-muted);font-size:13px}
.axis-identity-header>div{min-width:0}.axis-identity-email-toolbar button{background:var(--a-primary)!important;color:#fff!important}
.axis-identity-back{margin:0 0 12px}.axis-identity-back button{padding:3px 0!important;min-height:30px!important;background:transparent!important;color:var(--a-muted)!important;font-size:12px!important}
.axis-identity-methods summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-size:13px;color:var(--a-muted)}
.axis-identity-methods :where(input,select,button,summary,[tabindex]):focus-visible{outline:2px solid var(--a-focus);outline-offset:3px}
.axis-identity-methods button{min-height:40px;white-space:normal;overflow-wrap:anywhere}
.axis-identity-methods button:disabled{opacity:.6;cursor:not-allowed}
.axis-identity-methods button:not(:disabled):hover{filter:brightness(.95)}
.axis-identity-methods details{margin:8px 0}
.axis-identity-methods dialog{width:min(500px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:0;box-shadow:0 24px 64px -20px #10182055;border-radius:var(--a-radius);padding:27px;background:var(--a-surface);color:var(--a-text);font-family:inherit}
.axis-identity-methods dialog::backdrop{background:#111820a8}
.axis-identity-group+.axis-identity-group{margin-top:32px}
.axis-identity-overview-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:14px;padding:18px 0}
.axis-identity-overview-row>div{min-width:0}.axis-identity-overview-row p{margin:4px 0;font-size:13px;color:var(--a-muted)}
.axis-identity-row-icon{display:grid;place-items:center;width:38px;height:38px;flex:none;border:0;border-radius:var(--a-radius);background:var(--a-subtle);color:var(--a-muted)}
.axis-identity-record>span{font-size:12px;color:var(--a-muted)}.axis-identity-record>p{font-size:13px;color:var(--a-muted)}
.axis-identity-additions{display:grid;gap:4px}.axis-identity-addition-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,auto);align-items:center;gap:12px 20px;padding:9px 0;min-width:0}.axis-identity-addition-row>div{min-width:0}.axis-identity-addition-row strong{font-size:13px;font-weight:500;overflow-wrap:anywhere}.axis-identity-addition-row p{margin:4px 0 0;color:var(--a-muted);font-size:12px}.axis-identity-addition-row>button{justify-self:end;max-width:200px;font-size:13px}.axis-identity-methods .axis-identity-provider-additions{margin-top:18px}.axis-identity-provider-additions>div>p{font-size:13px;color:var(--a-muted);margin:14px 0}.axis-identity-methods .axis-identity-provider-toggle{display:inline-flex;align-items:center;gap:9px;max-width:100%;min-height:44px;padding:10px 14px;border:0;border-radius:var(--a-radius);background:var(--a-subtle);color:var(--a-text);font:inherit;font-size:13px;font-weight:550;text-align:left;cursor:pointer}.axis-identity-provider-toggle>span{min-width:0;overflow-wrap:anywhere}.axis-identity-provider-toggle>svg:last-child{transition:transform .15s ease-out}.axis-identity-provider-toggle[aria-expanded=true]>svg:last-child{transform:rotate(180deg)}.axis-identity-record .axis-identity-record-value{color:var(--a-text);overflow-wrap:anywhere}.axis-identity-record>.axis-identity-row-actions{justify-content:flex-end}.axis-identity-record>.axis-identity-row-actions>button{background:var(--a-subtle)!important}
.axis-identity-overview-row>button,.axis-identity-additions button{background:var(--a-subtle)!important}
.axis-identity-row-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.axis-identity-email-list{display:grid;gap:3px;border:0;outline-offset:4px}
.axis-identity-email-row{display:flex;align-items:center;gap:15px;min-height:79px;padding:14px 12px;border:0;border-radius:var(--a-radius)}
.axis-identity-email-row[data-primary=true]{background:var(--a-subtle);margin-bottom:4px}
.axis-identity-email-info{flex:1;min-width:0}.axis-identity-email-info p{margin:5px 0 0;font-size:12px;color:var(--a-muted)}
.axis-identity-email-value{display:block;overflow-wrap:anywhere;font-size:13px;font-weight:600;line-height:1.55}
.axis-identity-email-status{display:flex;align-items:center;flex-wrap:wrap;gap:11px;margin-top:5px}
.axis-identity-email-badge{display:inline-flex;align-items:center;gap:4px;border:0;color:var(--a-muted);font-size:11px;line-height:1.6}
.axis-identity-email-badge.is-verified{color:var(--a-success)}.axis-identity-email-badge.is-unverified{color:var(--a-warning)}
.axis-identity-email-badge.is-unverified:before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.axis-identity-email-actions{display:flex;align-items:center;gap:5px;flex:none}
.axis-identity-methods .axis-identity-email-actions button{min-height:38px;padding:6px 5px;background:transparent!important;color:var(--a-text)!important;font-size:12px}
.axis-identity-methods .axis-identity-action-menu{margin:0;flex:none}
.axis-identity-methods .axis-identity-action-menu>summary{display:flex;justify-content:center;width:36px;min-height:40px;list-style:none;padding:7px;border:0;border-radius:var(--a-radius);color:var(--a-muted)}
.axis-identity-action-menu>summary::-webkit-details-marker{display:none}
.axis-identity-action-menu>summary:hover{background:var(--a-subtle)}
.axis-identity-methods .axis-identity-action-popover{position:fixed;inset:auto;margin:0;z-index:5;width:min(240px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;padding:6px;border:0;border-radius:var(--a-radius);background:var(--a-surface);color:var(--a-text);font-family:inherit;box-shadow:0 12px 38px -9px #10182055;scrollbar-width:thin;scrollbar-color:var(--a-border) transparent}
.axis-identity-methods .axis-identity-action-popover button{width:100%;min-height:38px;padding:9px 10px;font-size:12px;font-weight:400;justify-content:flex-start;text-align:left;border:0;background:transparent}
.axis-identity-action-popover button:not(:disabled):hover{background:var(--a-subtle)!important}
.axis-identity-action-popover p{margin:0 10px 7px!important;font-size:11px!important;line-height:1.55}
.axis-identity-action-popover>[data-destructive=true] button{color:var(--a-danger)!important}
.axis-identity-email-pagination{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:18px;color:var(--a-muted);font-size:11px;font-variant-numeric:tabular-nums}
.axis-identity-email-pagination>div{display:flex;gap:6px}.axis-identity-email-pagination button{min-height:36px;padding:6px 9px;font-size:12px}
.axis-identity-operation{width:min(100%,475px);min-width:0;margin:0 auto}
.axis-identity-operation-heading{display:grid;justify-items:center;text-align:center;gap:14px;margin:6px 0 24px}.axis-identity-operation-heading h3{margin:0;font-size:20px;overflow-wrap:anywhere}
.axis-identity-symbol{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--a-subtle);color:var(--a-primary);line-height:0}
.axis-identity-operation-heading[data-complete=true] .axis-identity-symbol{background:color-mix(in srgb,var(--a-success) 10%,var(--a-surface));color:var(--a-success)}
.axis-identity-operation-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:24px;align-items:center}
.axis-identity-secondary{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.axis-identity-operation-cancel{text-align:right;margin-top:8px}
.axis-identity-methods .axis-identity-text-action{background:transparent;border:0;padding:8px 0;font:inherit;font-size:13px;cursor:pointer}
.axis-identity-operation-meta{font-size:12px;margin-top:24px;color:var(--a-muted)}.axis-identity-operation-meta p{margin:6px 0}
.axis-identity-provider-target{min-width:0;padding:18px;text-align:center;border:0;border-radius:var(--a-radius);background:var(--a-subtle)}
.axis-identity-provider-target h4{margin:0 0 12px;font-size:13px;color:var(--a-muted)}.axis-identity-provider-target p{font-size:15px}
.axis-identity-requirements{margin-top:24px;font-size:13px;color:var(--a-muted)}.axis-identity-requirements p:empty{display:none}.axis-identity-requirements ul{padding-left:20px}.axis-identity-requirements li{margin:5px 0}
.axis-identity-methods ::selection{background:var(--a-primary);color:#fff}.axis-identity-methods input{caret-color:var(--a-primary)}
@container(max-width:520px){.axis-identity-overview-row{grid-template-columns:38px minmax(0,1fr)}.axis-identity-overview-row>button{grid-column:2;justify-self:start}.axis-identity-overview-row>.axis-identity-row-actions{grid-column:2;justify-self:start;justify-content:flex-start}.axis-identity-email-row{padding:14px 10px;gap:8px}.axis-identity-email-actions{gap:1px}.axis-identity-email-value{font-size:12px}.axis-identity-header{gap:12px}.axis-identity-methods h2{font-size:23px}.axis-identity-operation-actions{gap:8px}}
@media(prefers-reduced-motion:reduce){.axis-identity-provider-toggle>svg:last-child{transition:none}.axis-identity-methods input,.axis-identity-methods button{transition:none!important}}
`}</style>
    {operationOpen && (embedded ? <div className="axis-identity-operation" ref={operationBody}>{operationContent}</div> : <dialog className="axis-identity-operation" ref={dialog} aria-labelledby={`${prefix}-operation-title`} onCancel={e => { e.preventDefault(); e.stopPropagation(); requestLeave() }}>{operationContent}</dialog>)}
    <AccountConfirmation open={identityExit.confirming} appearance={a} colorScheme={resolvedColorScheme} title={l.exitTitle} description={l.exitDescription} cancelLabel={l.keepChange} confirmLabel={l.confirmCancelChange} busy={busy} confirmDisabled={!canWrite} onCancel={identityExit.keep} onConfirm={() => run(identityExit.confirm)} />
    <div hidden={operationOpen}>
    {emailManagement && <div className="axis-identity-back">{button(l.emailOverview, () => update('emailManagement', false))}</div>}
    <header className="axis-identity-header"><div><h2>{emailManagement ? l.manageEmails : l.title}</h2><p>{emailManagement ? l.emailCount(emails.length) : l.description}</p></div>
      {emailManagement && facts && <div className="axis-identity-email-toolbar">{capabilityButton(l.addEmail, facts.identifiers.management.add.EMAIL, () => { update('kind', 'EMAIL'); update('value', ''); update('adding', true); update('operationOpen', true) }, 'email-toolbar-add')}</div>}
    </header>
    {!operationOpen && (error || state.error) && <p role="alert" style={errorStyle(a)}>{identityErrorMessage(errorCode, locale)}</p>}
    {!operationOpen && state.cancelUnconfirmed && <p role="alert" style={errorStyle(a)}>{l.cancelUnconfirmed}</p>}
    {!operationOpen && state.uncertainCreate && <div role="alert">
      <p>{l.createUnconfirmed}</p>
      {button(l.recoverCreate, () => finishCreate(() => actions.retryCreate()), busy)}
    </div>}
    {op && !terminal && button(l.continueOperation, () => { update('operationOpen', true); run(() => actions.reopen()) })}
    <fieldset disabled={Boolean(state.uncertainCreate)} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    {!facts && <p role="status">{l.status}</p>}
    {error && button(l.retry, () => update('reload', n => n + 1))}
    <section className="axis-identity-group" aria-label={l.identifiers}>
      {!emailManagement && <><h3>{l.identifiers}</h3>
      <div className="axis-identity-overview-row"><span className="axis-identity-row-icon"><AccountIcon name="methods" /></span><div><strong>{l.EMAIL}</strong><p>{primaryEmail?.displayValue ?? l.noPrimaryEmail}</p><p>{l.emailCount(emails.length)}</p></div>{button(l.manageEmails, () => update('emailManagement', true), busy || !facts)}</div></>}
      {emailManagement && <>
        <div ref={emailHeading} className="axis-identity-email-list" tabIndex={-1} aria-label={l.manageEmails}>
          {displayedEmails.map(i => {
            const quickVerify = i.verificationState === 'UNVERIFIED' && i.capabilities.VERIFY.allowed && i.capabilities.VERIFY.unavailableReasons.length === 0
            const select = (type: 'REPLACE' | 'REMOVE') => {
              update('selection', { type, id: i.id, display: i.displayValue })
              update('kind', i.kind); update('value', ''); update('primary', ''); update('removeOld', true)
              update('operationOpen', true)
            }
            const actions = [
              ...(i.verificationState === 'UNVERIFIED' && !quickVerify ? [{ key: 'VERIFY', label: l.verify, capability: i.capabilities.VERIFY, run: () => create({ type: 'VERIFY', payload: { identifierId: i.id } }) }] : []),
              ...(!i.isPrimary ? [{ key: 'SET_PRIMARY', label: l.setPrimary, capability: i.capabilities.SET_PRIMARY, run: () => create({ type: 'SET_PRIMARY', payload: { identifierId: i.id } }) }] : []),
              { key: 'REPLACE', label: l.replace, capability: i.capabilities.REPLACE, run: () => select('REPLACE') },
              { key: 'REMOVE', label: l.remove, capability: i.capabilities.REMOVE, run: () => select('REMOVE') },
            ]
            return <article className="axis-identity-email-row" data-primary={i.isPrimary} key={i.id}>
              <div className="axis-identity-email-info">
                <strong className="axis-identity-email-value">{i.displayValue}</strong>
                <div className="axis-identity-email-status" aria-label={l.status}>
                  {i.isPrimary && <span className="axis-identity-email-badge axis-identity-email-primary">{l.primary}</span>}
                  <span className={`axis-identity-email-badge ${i.verificationState === 'VERIFIED' ? 'is-verified' : i.verificationState === 'UNVERIFIED' ? 'is-unverified' : ''}`}>
                    {i.verificationState === 'VERIFIED' && <AccountIcon name="check" size={12} />}
                    {i.verificationState === 'VERIFIED' ? l.verified : i.verificationState === 'UNVERIFIED' ? l.unverified : l.verificationUnknown}
                  </span>
                </div>
                {i.managedBy && <p>{l.managed}</p>}
              </div>
              <div className="axis-identity-email-actions">
                {quickVerify && capabilityButton(l.verify, i.capabilities.VERIFY, () => create({ type: 'VERIFY', payload: { identifierId: i.id } }), `${i.id}-VERIFY`)}
                <IdentifierActionsMenu label={`${l.moreActions}: ${i.displayValue}`}>
                    {actions.map(action => <div key={action.key} data-destructive={action.key === 'REMOVE'} data-action={action.key}>{capabilityButton(action.label, action.capability, action.run, `${i.id}-${action.key}`, true)}</div>)}
                </IdentifierActionsMenu>
              </div>
            </article>
          })}
          {displayedEmails.length === 0 && <p>{l.noPrimaryEmail}</p>}
        </div>
        {emailPages > 1 && <nav aria-label={l.emailPages} className="axis-identity-email-pagination">
          <span role="status">{l.page(visibleEmailPage + 1, emailPages)}</span>
          <div>{button(l.previous, () => update('emailPage', visibleEmailPage - 1), visibleEmailPage === 0)}
            {button(l.next, () => update('emailPage', visibleEmailPage + 1), visibleEmailPage + 1 === emailPages)}</div>
        </nav>}
      </>}
      {!emailManagement && displayedIdentifiers.map(i => {
        const changeDescription = `${prefix}-${i.id}-change-reason`
        return <article className="axis-identity-record axis-identity-overview-row" key={i.id}>
          <span className="axis-identity-row-icon"><AccountIcon name={i.kind === 'USERNAME' ? 'profile' : 'authenticator'} /></span>
          <div><strong>{l[i.kind]}</strong><p className="axis-identity-record-value">{i.displayValue}</p>
            <p>{i.isPrimary && <>{l.primary} · </>}{i.verificationState === 'VERIFIED' ? l.verified : i.verificationState === 'UNVERIFIED' ? l.unverified : l.verificationUnknown}</p>
            {i.verificationSource && <p>{l.source}: {i.verificationSource}</p>}
            {i.managedBy && <p>{l.managed}</p>}
            {i.kind === 'USERNAME' && i.capabilities.REPLACE.unavailableReasons.length > 0 && <p id={changeDescription}>{i.capabilities.REPLACE.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
          </div>
          <div className="axis-identity-row-actions">
            {i.kind === 'USERNAME' && button(l.change, () => { update('selection', { type: 'REPLACE', id: i.id, display: i.displayValue }); update('kind', i.kind); update('value', ''); update('primary', ''); update('removeOld', true); update('operationOpen', true) }, busy || !terminal || !i.capabilities.REPLACE.allowed, i.capabilities.REPLACE.unavailableReasons.length ? changeDescription : undefined)}
            {i.verificationState === 'UNVERIFIED' && capabilityButton(l.verify, i.capabilities.VERIFY, () => create({ type: 'VERIFY', payload: { identifierId: i.id } }), `${i.id}-VERIFY`)}
            <IdentifierActionsMenu label={`${l.moreActions}: ${i.displayValue}`}>
              {!i.isPrimary && <div>{capabilityButton(l.setPrimary, i.capabilities.SET_PRIMARY, () => create({ type: 'SET_PRIMARY', payload: { identifierId: i.id } }), `${i.id}-SET_PRIMARY`, true)}</div>}
              {(['REPLACE', 'REMOVE'] as const).filter(type => i.kind !== 'USERNAME' || type !== 'REPLACE').map(type => <div key={type}>{capabilityButton(type === 'REPLACE' ? l.replace : l.remove, i.capabilities[type],
                () => { update('selection', { type, id: i.id, display: i.displayValue }); update('kind', i.kind); update('value', ''); update('primary', ''); update('removeOld', true); update('operationOpen', true) }, `${i.id}-${type}`, true)}</div>)}
            </IdentifierActionsMenu>
          </div>
        </article>
      })}
    </section>
    {!emailManagement && <>{facts?.methods.methods.some(m => m.kind === 'PROVIDER') && <section className="axis-identity-group" aria-label={l.providers}><h3>{l.providers}</h3>
      {facts.methods.methods.filter(m => m.kind === 'PROVIDER').map(m => <div key={m.methodId} style={{ padding: '12px 0' }}>
        <strong>{facts.providers.find(p => p.id === m.providerId)?.displayName || l.providerUnavailable}</strong>
        <p>{m.roles.map(role => l[role]).join(', ')} · {l[m.status]}</p>
        {m.unavailableReasons.length > 0 && <p>{m.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
        <div className="axis-identity-row-actions">{button(l.unlink, () => create({ type: 'UNLINK', payload: { methodId: m.methodId } }), busy || !terminal || m.capabilities.unlink !== true)}</div>
      </div>)}
    </section>}
    <section className="axis-identity-group" aria-label={l.add}><h3>{l.add}</h3>
      <div className="axis-identity-additions">{facts && (['EMAIL', 'PHONE', 'USERNAME'] as const).filter(k => k !== 'USERNAME' || !facts.identifiers.items.some(i => i.kind === 'USERNAME')).map(k => {
        const capability = facts.identifiers.management.add[k]
        const description = `${prefix}-add-${k}-reason`
        return <div className="axis-identity-addition-row" key={k}>
          <div><strong>{l[k]}</strong>{capability.unavailableReasons.length > 0 && <p id={description}>{capability.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}</div>
          {button(k === 'EMAIL' ? l.addEmail : k === 'PHONE' ? l.addPhone : l.addUsername, () => { update('kind', k); update('value', ''); update('region', ''); update('adding', true); update('operationOpen', true) }, busy || !terminal || !capability.allowed, capability.unavailableReasons.length ? description : undefined)}
        </div>
      })}</div>
      <div className="axis-identity-provider-additions"><button className="axis-identity-provider-toggle" type="button" aria-expanded={providerExpanded} aria-controls={`${prefix}-provider-options`} onClick={() => update('providerExpanded', !providerExpanded)}><AccountIcon name="methods" size={17} /><span>{l.connectProvider}</span><AccountIcon name="chevronDown" size={16} /></button>
      <div id={`${prefix}-provider-options`} hidden={!providerExpanded}><p>{l.providerSelection}</p>{facts?.providers.map(p => {
        const description = `${prefix}-provider-${p.id}-reason`
        return <div className="axis-identity-addition-row" key={p.id}>
          <div><strong>{p.displayName}</strong>{p.unavailableReasons.length > 0 && <p id={description}>{p.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}</div>
          {button(l.link, () => create({ type: 'LINK', payload: { providerId: p.id } }), busy || !terminal || !p.canLink, p.unavailableReasons.length ? description : undefined)}
        </div>
      })}</div></div>
    </section></>}
    </fieldset>
    </div>
  </section>
}
