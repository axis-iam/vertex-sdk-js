import { operationReference } from '../core/server-session-client'
import { identityErrorMessage } from '../identity-localization'
import { IamApiError } from '../core/types'
import { SessionTransportError } from '@axis-iam/vertex'
import { assertIdentityWebAuthn } from '../core/identity-webauthn'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AccountIdentifiers, AccountLoginMethods, CreateIdentityOperation, IdentityProofPurpose, LoginIdentifier, TargetProofMethod } from '@axis-iam/vertex'
import type { LinkableIdentityProvider } from '../core/types'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { useAccountCenterAppearance } from './accountCenterConfig'
import { useIdentityOperations } from '../hooks/useIdentityOperations'
import { buttonStyle, containerStyle, errorStyle, inputStyle, labelStyle, mergeAppearances } from './styles'
import type { Appearance, AppearanceColorScheme } from './styles'

type WithoutVersion<T> = T extends unknown ? Omit<T, 'expectedLoginMethodVersion'> : never
type ProofOption = {
  key: string
  method: 'PASSWORD' | 'STEP_UP_PROOF' | 'PROVIDER' | TargetProofMethod
  label: string
  methodId?: string
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
  selection: { type: 'REPLACE' | 'REMOVE' | 'TRANSFER'; id: string; display: string } | null
  removeOld: boolean
  primary: string
  targetUser: string
  password: string
  code: string
  stepUp: { challengeId: string; availableMethods: string[] } | null
  providerPending: boolean
  proofChoice: { scope: string; key: string } | null
  stepUpMethod: 'totp' | 'webauthn' | null
  providerReturn: string | null
  recipientProved: string | null
  targetProvider: string | null
  reload: number
  operationOpen: boolean
  adding: boolean
}
function emptyView(): IdentityViewState {
  return { facts: null, error: null, kind: 'EMAIL', value: '', region: '', selection: null,
    removeOld: true, primary: '', targetUser: '', password: '', code: '',
    stepUp: null, providerPending: false, proofChoice: null, stepUpMethod: null,
    providerReturn: null, recipientProved: null, targetProvider: null,
    reload: 0, operationOpen: false, adding: false }
}
/** Facts first, connected providers second, additions last; all writes use durable operations. */
export function ConnectedAccounts({ appearance, colorScheme, darkAppearance, redirectUri, embedded = false }: ConnectedAccountsProps) {
  const { client } = useIamContext()
  const ui = useIamUi()
  const { localization: { identity: l }, locale } = ui
  const [a, resolvedColorScheme] = useAccountCenterAppearance(colorScheme ?? ui.colorScheme,
    mergeAppearances(ui.appearance, appearance), mergeAppearances(ui.darkAppearance, darkAppearance))
  const { state, actions } = useIdentityOperations()
  const prefix = useId()
  const activeReference = state.operation ? operationReference(state.operation) : null
  const generation = client.state.generation
  const [owned, setOwned] = useState(() => ({ client, generation, view: emptyView() }))
  // Reset before rendering the new identity; effect-time clearing would expose the old draft.
  const current = owned.client === client && owned.generation === generation
    ? owned : { client, generation, view: emptyView() }
  if (current !== owned) setOwned(current)
  const { facts, error, kind, value, region, selection, removeOld, primary, targetUser,
    password, code, stepUp, providerPending, proofChoice, stepUpMethod, providerReturn,
    recipientProved, targetProvider, reload, operationOpen, adding } = current.view
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
  const uncertain = state.cancelUnconfirmed || Boolean(state.error && (
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
    update('targetProvider', input.type === 'LINK' ? input.payload.providerId : null)
    update('recipientProved', null)
    update('proofChoice', null)
    update('providerReturn', null)
    update('stepUp', null); update('stepUpMethod', null)
    finishCreate(() => actions.create({ ...input, expectedLoginMethodVersion: facts.methods.loginMethodVersion }))
  }
  const button = (text: string, action: () => void, disabled = busy) => <button type="button" disabled={disabled} onClick={event => { if (!operationOpen) trigger.current = event.currentTarget; action() }} style={{ ...buttonStyle(a, 'ghost'), width: 'auto' }}>{text}</button>
  const field = (name: string, text: string, content: string, update: (s: string) => void, type = 'text', required = false) => <div style={{ margin: '12px 0' }}>
    <label htmlFor={`${prefix}-${name}`} style={labelStyle(a)}>{text}</label>
    <input id={`${prefix}-${name}`} type={type} required={required} value={content} onChange={e => update(e.target.value)} style={inputStyle(a)} autoComplete={type === 'password' ? 'current-password' : 'off'} />
  </div>
  const identifierFields = <>
    <label htmlFor={`${prefix}-kind`} style={labelStyle(a)}>{l.kind}</label>
    <select id={`${prefix}-kind`} style={inputStyle(a)} value={kind} onChange={e => { if (e.target.value === 'EMAIL' || e.target.value === 'PHONE' || e.target.value === 'USERNAME') update('kind', e.target.value) }}>
      {(['EMAIL', 'PHONE', 'USERNAME'] as const).map(k => <option key={k} value={k}>{l[k]}</option>)}
    </select>
    {field('value', l.value, value, v => update('value', v), kind === 'EMAIL' ? 'email' : 'text', true)}
    {kind === 'PHONE' && field('region', l.region, region, v => update('region', v))}
  </>
  async function provider(purpose: IdentityProofPurpose, methodId?: string) {
    if (!redirectUri) { update('error', new Error(l.unavailable)); return }
    update('providerPending', true)
    try {
      await actions.openProvider(purpose, new URL(redirectUri, window.location.origin).toString(), methodId)
      client.state.assertCurrent(generation)
    } finally { if (client.state.generation === generation) update('providerPending', false) }
  }
  function submitSelection(event: FormEvent) {
    event.preventDefault()
    if (!selection || busy || !terminal || state.uncertainCreate) return
    if (selection.type === 'REPLACE') create({ type: 'REPLACE', payload: { identifierId: selection.id, replacement: typed(), removeOld, ...(primary ? { replacementPrimaryId: primary } : {}) } })
    if (selection.type === 'REMOVE') create({ type: 'REMOVE', payload: { identifierId: selection.id, ...(primary ? { replacementPrimaryId: primary } : {}) } })
    if (selection.type === 'TRANSFER') create({ type: 'TRANSFER', payload: { identifierId: selection.id, targetUserId: targetUser, ...(primary ? { sourceReplacementPrimaryId: primary } : {}) } })
  }
  function continueLater() {
    if (state.pending || state.uncertainCreate || providerPending) return
    actions.cancelProviderWindow()
    update('operationOpen', false); update('adding', false); update('selection', null)
    update('password', ''); update('code', ''); update('value', ''); update('targetUser', ''); update('stepUp', null)
    update('providerReturn', null); update('proofChoice', null); update('stepUpMethod', null)
  }
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
      if (proof.methods.includes('PASSWORD')) proofOptions.push({ key: 'password', method: 'PASSWORD', label: l.passwordMethod })
      if (proof.methods.includes('STEP_UP_PROOF')) proofOptions.push({ key: 'step-up', method: 'STEP_UP_PROOF', label: l.stepUp })
    }
    if (proof.methods.includes('PROVIDER')) {
      if (proof.purpose === 'TARGET_OWNERSHIP') {
        const name = facts?.providers.find(p => p.id === targetProvider)?.displayName
        proofOptions.push({ key: 'provider-target', method: 'PROVIDER', label: name ? l.providerMethod(name) : l.providerAuth })
      } else {
        for (const method of facts?.methods.methods ?? []) {
          const entry = facts?.providers.find(p => p.id === method.providerId)
          if (method.kind === 'PROVIDER' && method.status === 'AVAILABLE' && entry?.canReauthenticate && entry.displayName)
            proofOptions.push({ key: `provider:${method.methodId}`, method: 'PROVIDER', methodId: method.methodId, label: l.providerMethod(entry.displayName) })
        }
      }
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
    update('stepUpMethod', null); update('providerReturn', null); update('error', null)
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
        const challenge = await client.identity.startStepUp()
        client.state.assertCurrent(generation)
        update('stepUp', challenge)
      })) }
    } else if (authenticator === 'totp') {
      primaryAction = { label: l.verifyContinue, form: proofFormId, disabled: !canWrite || code.length !== 6 }
      proofFields = <form id={proofFormId} onSubmit={e => {
        e.preventDefault()
        if (code.length !== 6) return
        change(() => externalProof(() => accountVerified(async () => {
          await client.identity.verifyStepUp(stepUp.challengeId, code)
          client.state.assertCurrent(generation)
          await actions.reauthenticate({ method: 'STEP_UP_PROOF' })
        })))
        update('code', '')
      }}>{field('totp', l.otp, code, v => update('code', v), 'text', true)}</form>
    } else if (authenticator === 'webauthn') {
      primaryAction = { label: l.webauthn, disabled: !canWrite, action: () => change(() => externalProof(() => accountVerified(async () => {
        const start = await client.identity.startStepUpWebAuthn(stepUp.challengeId)
        client.state.assertCurrent(generation)
        const credential = await assertIdentityWebAuthn(start.publicKey)
        client.state.assertCurrent(generation)
        await client.identity.verifyStepUpWebAuthn(stepUp.challengeId, start.requestId, credential)
        client.state.assertCurrent(generation)
        await actions.reauthenticate({ method: 'STEP_UP_PROOF' })
      }))) }
    }
  } else if (!terminal && recipient && accountDone && op?.requiredProofs.some(p => p.purpose === 'TRANSFER_COUNTERPART' && !p.satisfied)) {
    primaryAction = { label: l.accept, disabled: !canWrite, action: () => change(() => actions.confirmTransfer('ACCEPT')) }
  } else if (!terminal && !recipient && op?.state === 'READY' && op.requiredProofs.every(p => p.satisfied)) {
    primaryAction = { label: l.complete, disabled: !canWrite, action: () => change(() => actions.complete()) }
  }
  if (adding || selection) primaryAction = { label: adding ? l.add : l.complete, form: createFormId, disabled: busy || !terminal || !facts || Boolean(state.uncertainCreate) }
  const operationTitle = selection
    ? `${selection.type === 'REPLACE' ? l.replace : selection.type === 'REMOVE' ? l.remove : l.transfer}: ${selection.display}`
    : adding ? (kind === 'EMAIL' ? l.addEmail : kind === 'PHONE' ? l.addPhone : l.addUsername)
    : op ? expired ? l.EXPIRED : recipient && accountDone && primaryAction?.label === l.accept ? l.accept : l[op.state] : l.add
  const operationContent = <>
    <h3 id={`${prefix}-operation-title`} style={{ marginTop: 0 }}>{operationTitle}</h3>
    {state.uncertainCreate && <div role="alert"><p>{l.createUnconfirmed}</p>{button(l.recoverCreate, () => finishCreate(() => actions.retryCreate()))}</div>}
    {(error || state.error) && <p role="alert" style={errorStyle(a)}>{identityErrorMessage(errorCode, locale)}</p>}
    {state.cancelUnconfirmed && <p role="alert">{l.cancelUnconfirmed}</p>}
    {uncertain && op && <div className="axis-identity-secondary">{button(l.queryStatus, () => run(() => actions.reopen()))}</div>}
    <fieldset disabled={Boolean(state.uncertainCreate || uncertain || busy)} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    {selection && terminal && <form id={createFormId} onSubmit={submitSelection}>
      {selection.type === 'REPLACE' && <>{identifierFields}<label><input type="checkbox" checked={removeOld} onChange={e => update('removeOld', e.target.checked)} />{l.removeOld}</label></>}
      {selection.type === 'TRANSFER' && <><p>{l.transferWarning}</p>{field('target-user', l.targetUser, targetUser, v => update('targetUser', v), 'text', true)}</>}
      <label htmlFor={`${prefix}-replacement-primary`} style={labelStyle(a)}>{l.replacementPrimary}</label>
      <select id={`${prefix}-replacement-primary`} style={inputStyle(a)} value={primary} onChange={e => update('primary', e.target.value)}>
        <option value="">{l.primary}</option>
        {facts?.identifiers.items.filter(i => i.id !== selection.id && i.kind === kind && i.verificationState === 'VERIFIED').map(i => <option key={i.id} value={i.id}>{i.displayValue}</option>)}
      </select>
    </form>}
    {adding && <form id={createFormId} onSubmit={e => { e.preventDefault(); create({ type: 'ADD', payload: { identifier: typed() } }) }}>
      {field('value', l[kind], value, v => update('value', v), kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'tel' : 'text', true)}
      {kind === 'PHONE' && field('region', l.region, region, v => update('region', v))}
    </form>}
    {op && !adding && !selection && <section aria-label={l.status}>
      {op.maskedIdentifier && <p>{op.maskedIdentifier}</p>}
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
        style={{ ...buttonStyle(a), ...(primaryAction.disabled ? { backgroundColor: a.subtleColor, color: a.mutedTextColor, cursor: 'not-allowed' } : {}) }}>{primaryAction.label}</button>}
      {button(op && terminal && !adding && !selection ? l.done : l.later, continueLater, busy || Boolean(state.uncertainCreate))}
    </div>
    {op && !terminal && !adding && !selection && <div className="axis-identity-operation-cancel">
      <button type="button" className="axis-identity-text-action" disabled={!canWrite}
        onClick={() => change(() => recipient ? actions.confirmTransfer('REJECT') : actions.cancel())}
        style={{ color: a.mutedTextColor }}>{recipient ? l.reject : l.cancelChange}</button>
    </div>}
    {op && !adding && !selection && <div className="axis-identity-operation-meta" style={{ color: a.mutedTextColor }}>
      {!terminal && <p>{l.remaining(Math.max(0, Math.ceil((Date.parse(op.expiresAt) - Date.now()) / 60000)))}</p>}
      <details><summary>{l.details}</summary><p>{l.operationId}: {operationReference(op)}</p><p>{l.expires}: {new Date(op.expiresAt).toLocaleString(locale)}</p><p>{op.type} / {op.state}</p></details>
    </div>}
  </>
  return <section ref={surface} className="axis-identity-methods" aria-label={l.title} data-color-scheme={resolvedColorScheme} style={{ ...containerStyle(a), padding: embedded ? 0 : 32, colorScheme: resolvedColorScheme, maxWidth: 'none', minWidth: 0 }}>
    <style>{`.axis-identity-methods *{box-sizing:border-box}.axis-identity-methods summary{min-height:44px;display:flex;align-items:center;cursor:pointer}.axis-identity-methods input:focus-visible,.axis-identity-methods select:focus-visible,.axis-identity-methods button:focus-visible,.axis-identity-methods summary:focus-visible{outline:2px solid ${a.focusColor};outline-offset:3px}.axis-identity-methods button{min-height:44px;white-space:normal;overflow-wrap:anywhere}.axis-identity-methods details{margin:8px 0}.axis-identity-methods dialog{width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid ${a.borderColor};border-radius:${a.borderRadius};padding:24px;background:${a.backgroundColor};color:${a.textColor};font-family:inherit}.axis-identity-methods dialog::backdrop{background:#111820b8}.axis-identity-methods p{overflow-wrap:anywhere}.axis-identity-methods .axis-identity-row-actions{display:flex;flex-wrap:wrap;align-items:start;gap:8px}.axis-identity-methods .axis-identity-operation-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;margin-top:24px;align-items:stretch}.axis-identity-methods .axis-identity-secondary{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.axis-identity-methods .axis-identity-operation-cancel{text-align:center;margin-top:8px}.axis-identity-methods .axis-identity-text-action{background:transparent;border:0;padding:8px 12px;font:inherit;cursor:pointer;text-decoration:none}.axis-identity-methods .axis-identity-text-action:not(:disabled):hover{text-decoration:underline;text-underline-offset:3px}.axis-identity-methods .axis-identity-text-action:disabled{cursor:not-allowed}.axis-identity-methods .axis-identity-operation-meta{font-size:13px;margin-top:20px}.axis-identity-methods .axis-identity-operation-meta p{margin:8px 0}@media(max-width:480px){.axis-identity-methods .axis-identity-operation-actions{grid-template-columns:minmax(0,1fr)}.axis-identity-methods dialog{padding:18px}.axis-identity-methods .axis-identity-row-actions{flex-direction:column;align-items:stretch}}`}</style>
    {operationOpen && (embedded ? <div ref={operationBody}>{operationContent}</div> : <dialog ref={dialog} aria-labelledby={`${prefix}-operation-title`} onCancel={e => { e.preventDefault(); continueLater() }}>{operationContent}</dialog>)}
    <div hidden={operationOpen}>
    <h2>{l.title}</h2>
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
    <section aria-label={l.identifiers}>
      <h3>{l.identifiers}</h3>
      {facts?.identifiers.items.map(i => <div key={i.id} style={{ padding: '12px 0', borderBottom: `1px solid ${a.borderColor}`, overflowWrap: 'anywhere' }}>
        <strong>{i.displayValue}</strong> <span>{l[i.kind]} {i.isPrimary && l.primary} · {i.verificationState === 'VERIFIED' ? l.verified : i.verificationState === 'UNVERIFIED' ? l.unverified : l.verificationUnknown}</span>
        {i.verificationSource && <p>{l.source}: {i.verificationSource}</p>}
        {i.managedBy ? <p>{l.managed} · {i.managedBy}</p> : <div className="axis-identity-row-actions">
          {i.verificationState === 'UNVERIFIED' && button(l.verify, () => create({ type: 'VERIFY', payload: { identifierId: i.id } }), busy || !terminal)}
          {i.kind === 'USERNAME' ? button(l.change, () => { update('selection', { type: 'REPLACE', id: i.id, display: i.displayValue }); update('kind', i.kind); update('value', ''); update('primary', ''); update('operationOpen', true) }, busy || !terminal) : <details>
          <summary aria-label={`${l.moreActions}: ${i.displayValue}`}>{l.moreActions}</summary>
          {!i.isPrimary && button(l.setPrimary, () => create({ type: 'SET_PRIMARY', payload: { identifierId: i.id } }), busy || !terminal)}
          {(['REPLACE', 'REMOVE', 'TRANSFER'] as const).map(type => <span key={type}>{button(type === 'REPLACE' ? l.replace : type === 'REMOVE' ? l.remove : l.transfer,
            () => { update('selection', { type, id: i.id, display: i.displayValue }); update('kind', i.kind); update('value', ''); update('primary', ''); update('operationOpen', true) }, busy || !terminal)}</span>)}
          </details>}
        </div>}
      </div>)}
    </section>
    <section aria-label={l.providers}><h3>{l.providers}</h3>
      {facts?.methods.methods.filter(m => m.kind === 'PROVIDER').map(m => <div key={m.methodId} style={{ padding: '12px 0' }}>
        <strong>{facts.providers.find(p => p.id === m.providerId)?.displayName || l.providerUnavailable}</strong>
        <p>{m.roles.map(role => l[role]).join(', ')} · {l[m.status]}</p>
        {m.unavailableReasons.length > 0 && <p>{m.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
        <details><summary>{l.moreActions}</summary>{button(l.unlink, () => create({ type: 'UNLINK', payload: { methodId: m.methodId } }), busy || !terminal || m.capabilities.unlink !== true)}</details>
      </div>)}
    </section>
    <section aria-label={l.add}><h3>{l.add}</h3>
      {(['EMAIL', 'PHONE', 'USERNAME'] as const).map(k => <span key={k}>{button(k === 'EMAIL' ? l.addEmail : k === 'PHONE' ? l.addPhone : l.addUsername, () => { update('kind', k); update('value', ''); update('region', ''); update('adding', true); update('operationOpen', true) }, busy || !terminal || !facts)}</span>)}
      {facts?.providers.map(p => <div key={p.id} style={{ marginTop: 12 }}>
        {p.displayName} {button(l.link, () => create({ type: 'LINK', payload: { providerId: p.id } }), busy || !terminal || !p.canLink)}
        {p.unavailableReasons.length > 0 && <p>{p.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
      </div>)}
    </section>
    </fieldset>
    </div>
  </section>
}
