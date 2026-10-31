import { operationReference } from '../core/server-session-client'
import { identityErrorMessage } from '../identity-localization'
import { IamApiError } from '../core/types'
import { SessionTransportError } from '@axis-iam/vertex'
import { assertIdentityWebAuthn } from '../core/identity-webauthn'
import { phoneCountries } from './sign-in/phone-identifier'
import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AccountIdentifiers, AccountLoginMethods, CreateIdentityOperation, IdentityProofPurpose, LoginIdentifier, TargetProofMethod, IdentifierManagementCapability } from '@axis-iam/vertex'
import type { LinkableIdentityProvider } from '../core/types'
import { useIamContext } from '../provider/IamProvider'
import { useIamUi } from '../provider/IamUiProvider'
import { accountCenterVariables, useAccountCenterAppearance } from './accountCenterConfig'
import { AccountIcon } from './AccountIcon'
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
  currentChallengeId: string | null
  emailManagement: boolean
  emailPage: number
  operationOpen: boolean
  adding: boolean
}
function emptyView(): IdentityViewState {
  return { facts: null, error: null, kind: 'EMAIL', value: '', region: '', selection: null,
    removeOld: true, primary: '', targetUser: '', password: '', code: '',
    stepUp: null, providerPending: false, proofChoice: null, stepUpMethod: null,
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
  const prefix = useId()
  const emailHeading = useRef<HTMLHeadingElement>(null)
  const activeReference = state.operation ? operationReference(state.operation) : null
  const generation = client.state.generation
  const [owned, setOwned] = useState(() => ({ client, generation, view: emptyView() }))
  // Reset before rendering the new identity; effect-time clearing would expose the old draft.
  const current = owned.client === client && owned.generation === generation
    ? owned : { client, generation, view: emptyView() }
  if (current !== owned) setOwned(current)
  const { facts, error, kind, value, region, selection, removeOld, primary, targetUser,
    password, code, stepUp, providerPending, proofChoice, stepUpMethod, providerReturn,
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
  const button = (text: string, action: () => void, disabled = busy, descriptionId?: string) => <button type="button" disabled={disabled} aria-describedby={descriptionId} onClick={event => { if (!operationOpen) trigger.current = event.currentTarget; action() }} style={{ ...buttonStyle(a, 'ghost'), width: 'auto' }}>{text}</button>
  const capabilityButton = (text: string, capability: IdentifierManagementCapability, action: () => void, key: string) => {
    const description = `${prefix}-capability-${key}`
    return <div>{button(text, action, busy || !terminal || !capability.allowed, capability.unavailableReasons.length ? description : undefined)}
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
    <label htmlFor={`${prefix}-kind`} style={labelStyle(a)}>{l.kind}</label>
    <select id={`${prefix}-kind`} style={inputStyle(a)} value={kind} disabled={selection?.type === 'REPLACE'} onChange={e => { if (e.target.value === 'EMAIL' || e.target.value === 'PHONE' || e.target.value === 'USERNAME') update('kind', e.target.value) }}>
      {(['EMAIL', 'PHONE', 'USERNAME'] as const).map(k => <option key={k} value={k}>{l[k]}</option>)}
    </select>
    {field('value', l.value, value, v => update('value', v), kind === 'EMAIL' ? 'email' : 'text', true)}
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
    if (selection.type === 'TRANSFER') create({ type: 'TRANSFER', payload: { identifierId: selection.id, targetUserId: targetUser, ...(primary ? { sourceReplacementPrimaryId: primary } : {}) } })
  }
  function continueLater() {
    if (state.pending || state.uncertainCreate || providerPending) return
    actions.cancelProviderWindow()
    if (op && ['COMMITTED', 'CANCELLED', 'EXPIRED', 'REJECTED'].includes(op.state)) {
      const reauthenticate = op.completion?.sessionImpact === 'REAUTHENTICATE'
      actions.acknowledge()
      if (reauthenticate) void login().catch(error => update('error', error instanceof Error ? error : new Error(l.error)))
    }
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
  if (emailManagement) displayedIdentifiers.push(...emails.slice(visibleEmailPage * 5, visibleEmailPage * 5 + 5))
  const primaryEmail = emails.find(i => i.isPrimary)
  useEffect(() => { if (emailManagement) emailHeading.current?.focus() }, [emailManagement, visibleEmailPage])
  const operationTitle = selection
    ? `${selection.type === 'REPLACE' ? l.replace : selection.type === 'REMOVE' ? l.remove : l.transfer}: ${selection.display}`
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
      {selection.type === 'REPLACE' && <>{identifierFields}<label><input type="checkbox" checked={removeOld} disabled={selectedCapability?.requirements.includes('REMOVE_OLD')} onChange={e => update('removeOld', e.target.checked)} />{l.removeOld}</label></>}
      {selection.type === 'TRANSFER' && <><p>{l.transferWarning}</p>{field('target-user', l.targetUser, targetUser, v => update('targetUser', v), 'text', true)}</>}
      {replacementRequired && <><label htmlFor={`${prefix}-replacement-primary`} style={labelStyle(a)}>{l.replacementPrimary}</label>
      <select id={`${prefix}-replacement-primary`} style={inputStyle(a)} value={primary} required onChange={e => update('primary', e.target.value)}>
        <option value="">{l.primary}</option>
        {primaryCandidates.map(i => <option key={i.id} value={i.id}>{i.displayValue}</option>)}
      </select></>}
      {(selection.type === 'REMOVE' || selection.type === 'TRANSFER' || removeOld) && <p>{l.lastPathProtection}</p>}
    </form>}
    {adding && <form id={createFormId} onSubmit={e => { e.preventDefault(); create({ type: 'ADD', payload: { identifier: typed() } }) }}>
      {field('value', l[kind], value, v => update('value', v), kind === 'EMAIL' ? 'email' : kind === 'PHONE' ? 'tel' : 'text', true)}
      {kind === 'PHONE' && phoneRegionField}
    </form>}
    {(adding || selection) && selectedCapability && <section className="axis-identity-requirements" aria-label={l.managementRequirements}>
      <p>{selectedCapability.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>
      <ul>{selectedCapability.requirements.map(requirement => <li key={requirement}>{l.managementRequirement[requirement]}</li>)}</ul>
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
      {button(op?.completion?.sessionImpact === 'REAUTHENTICATE' && !adding && !selection ? l.signIn : op && terminal && !adding && !selection ? l.done : l.later, continueLater, busy || Boolean(state.uncertainCreate))}
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
  return <section ref={surface} className="axis-identity-methods" aria-label={l.title} data-color-scheme={resolvedColorScheme} style={{ ...accountCenterVariables(a), ...containerStyle(a), padding: embedded ? 0 : 24, colorScheme: resolvedColorScheme, maxWidth: 'none', minWidth: 0 }}>
    <style>{`
.axis-identity-methods{font-size:14px;line-height:1.55}.axis-identity-methods *{box-sizing:border-box}.axis-identity-methods svg{flex:none}.axis-identity-methods p{overflow-wrap:anywhere;max-width:65ch;margin:8px 0;line-height:1.65}.axis-identity-methods h2{margin:0;font-size:22px;line-height:1.35;font-weight:650}.axis-identity-methods h3{font-size:15px;line-height:1.5;font-weight:600;margin:0 0 12px}.axis-identity-methods h4{font-size:14px;font-weight:600}.axis-identity-header{margin-bottom:24px}.axis-identity-header p{margin-top:6px;color:var(--a-muted);font-size:13px}.axis-identity-methods summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-size:13px;color:var(--a-muted)}.axis-identity-methods :where(input,select,button,summary):focus-visible{outline:2px solid var(--a-focus);outline-offset:3px}.axis-identity-methods button{min-height:44px;white-space:normal;overflow-wrap:anywhere}.axis-identity-methods button:disabled{opacity:.6;cursor:not-allowed}.axis-identity-methods details{margin:8px 0}.axis-identity-methods dialog{width:min(500px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid var(--a-border);border-radius:var(--a-radius);padding:24px;background:var(--a-surface);color:var(--a-text);font-family:inherit}.axis-identity-methods dialog::backdrop{background:#111820a8}
.axis-identity-group+.axis-identity-group{margin-top:24px;padding-top:20px;border-top:1px solid var(--a-border)}.axis-identity-overview-row{display:flex;align-items:center;gap:14px;padding:14px 0 20px;border-bottom:1px solid var(--a-border)}.axis-identity-overview-row>div{flex:1;min-width:0}.axis-identity-overview-row p{margin:3px 0;font-size:13px;color:var(--a-muted)}.axis-identity-row-icon{display:grid;place-items:center;width:38px;height:42px;flex:none;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle);color:var(--a-muted)}.axis-identity-record>span{font-size:12px;color:var(--a-muted)}.axis-identity-record>p{font-size:13px;color:var(--a-muted)}.axis-identity-additions{display:flex;flex-wrap:wrap;gap:10px}.axis-identity-additions>div{flex:1 1 140px;min-width:0}.axis-identity-methods .axis-identity-row-actions{display:flex;flex-wrap:wrap;align-items:start;gap:8px}.axis-identity-row-actions>details{flex-basis:100%}.axis-identity-row-actions details[open]{display:flex;flex-wrap:wrap;gap:10px}.axis-identity-row-actions details[open]>summary{flex-basis:100%}.axis-identity-row-actions details p{max-width:30ch}
.axis-identity-operation{max-width:500px;margin:0 auto}.axis-identity-operation-heading{display:grid;justify-items:center;text-align:center;gap:14px;margin:6px 0 24px}.axis-identity-operation-heading h3{margin:0;font-size:18px;overflow-wrap:anywhere}.axis-identity-symbol{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--a-subtle);color:var(--a-primary)}.axis-identity-operation-heading[data-complete=true] .axis-identity-symbol{background:color-mix(in srgb,var(--a-success) 10%,var(--a-surface));color:var(--a-success)}.axis-identity-methods .axis-identity-operation-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:24px;align-items:center}.axis-identity-methods .axis-identity-secondary{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.axis-identity-methods .axis-identity-operation-cancel{text-align:right;margin-top:8px}.axis-identity-methods .axis-identity-text-action{background:transparent;border:0;padding:8px 0;font:inherit;font-size:13px;cursor:pointer;text-decoration:none}.axis-identity-methods .axis-identity-text-action:not(:disabled):hover{text-decoration:underline;text-underline-offset:3px}.axis-identity-methods .axis-identity-text-action:disabled{cursor:not-allowed}.axis-identity-methods .axis-identity-operation-meta{font-size:12px;margin-top:20px;padding-top:12px;border-top:1px solid var(--a-border)}.axis-identity-methods .axis-identity-operation-meta p{margin:6px 0}.axis-identity-provider-target{padding:18px;text-align:center;border:1px solid var(--a-border);border-radius:var(--a-radius);background:var(--a-subtle)}.axis-identity-provider-target h4{margin:0 0 12px;font-size:13px;color:var(--a-muted)}.axis-identity-provider-target p{font-size:15px}.axis-identity-requirements{margin-top:20px;padding-top:16px;border-top:1px solid var(--a-border);font-size:13px;color:var(--a-muted)}.axis-identity-requirements p:empty{display:none}.axis-identity-requirements ul{padding-left:20px}.axis-identity-requirements li{margin:5px 0}
.axis-identity-methods ::selection{background:var(--a-primary);color:#fff}.axis-identity-methods input{caret-color:var(--a-primary)}
@media(max-width:480px){.axis-identity-methods dialog{padding:20px}.axis-identity-overview-row{align-items:flex-start;flex-wrap:wrap}.axis-identity-overview-row>div{flex-basis:calc(100% - 52px)}.axis-identity-overview-row>button{margin-left:52px}.axis-identity-methods .axis-identity-operation-actions{gap:8px}.axis-identity-methods .axis-identity-row-actions{align-items:flex-start}}
@media(prefers-reduced-motion:reduce){.axis-identity-methods input,.axis-identity-methods button{transition:none!important}}
`}</style>
    {operationOpen && (embedded ? <div className="axis-identity-operation" ref={operationBody}>{operationContent}</div> : <dialog className="axis-identity-operation" ref={dialog} aria-labelledby={`${prefix}-operation-title`} onCancel={e => { e.preventDefault(); continueLater() }}>{operationContent}</dialog>)}
    <div hidden={operationOpen}>
    <header className="axis-identity-header"><h2>{l.title}</h2><p>{l.description}</p></header>
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
      <h3>{l.identifiers}</h3>
      <div className="axis-identity-overview-row"><span className="axis-identity-row-icon"><AccountIcon name="methods" /></span><div><strong>{l.EMAIL}</strong><p>{primaryEmail?.displayValue ?? l.noPrimaryEmail}</p><p>{l.emailCount(emails.length)}</p></div>{button(emailManagement ? l.emailOverview : l.manageEmails, () => update('emailManagement', !emailManagement), busy || !facts)}</div>
      {emailManagement && <div><h4 ref={emailHeading} tabIndex={-1}>{l.manageEmails}</h4><nav aria-label={l.emailPages} className="axis-identity-row-actions">{button(l.previous, () => update('emailPage', visibleEmailPage - 1), visibleEmailPage === 0)}<span>{l.page(visibleEmailPage + 1, emailPages)}</span>{button(l.next, () => update('emailPage', visibleEmailPage + 1), visibleEmailPage + 1 === emailPages)}</nav></div>}
      {displayedIdentifiers.map(i => <div className="axis-identity-record" key={i.id} style={{ padding: '12px 0', borderBottom: `1px solid ${a.borderColor}`, overflowWrap: 'anywhere' }}>
        <strong>{i.displayValue}</strong> <span>{l[i.kind]} {i.isPrimary && l.primary} · {i.verificationState === 'VERIFIED' ? l.verified : i.verificationState === 'UNVERIFIED' ? l.unverified : l.verificationUnknown}</span>
        {i.verificationSource && <p>{l.source}: {i.verificationSource}</p>}
        {i.managedBy && <p>{l.managed}</p>}<div className="axis-identity-row-actions">
          {i.verificationState === 'UNVERIFIED' && capabilityButton(l.verify, i.capabilities.VERIFY, () => create({ type: 'VERIFY', payload: { identifierId: i.id } }), `${i.id}-VERIFY`)}
          <details>
          <summary aria-label={`${l.moreActions}: ${i.displayValue}`}>{l.moreActions}</summary>
          {capabilityButton(l.setPrimary, i.capabilities.SET_PRIMARY, () => create({ type: 'SET_PRIMARY', payload: { identifierId: i.id } }), `${i.id}-SET_PRIMARY`)}
          {(['REPLACE', 'REMOVE', 'TRANSFER'] as const).map(type => <span key={type}>{capabilityButton(type === 'REPLACE' ? i.kind === 'USERNAME' ? l.change : l.replace : type === 'REMOVE' ? l.remove : l.transfer, i.capabilities[type],
            () => { update('selection', { type, id: i.id, display: i.displayValue }); update('kind', i.kind); update('value', ''); update('primary', ''); update('removeOld', true); update('operationOpen', true) }, `${i.id}-${type}`)}</span>)}
          </details>
        </div>
      </div>)}
    </section>
    <section className="axis-identity-group" aria-label={l.providers}><h3>{l.providers}</h3>
      {facts?.methods.methods.filter(m => m.kind === 'PROVIDER').map(m => <div key={m.methodId} style={{ padding: '12px 0' }}>
        <strong>{facts.providers.find(p => p.id === m.providerId)?.displayName || l.providerUnavailable}</strong>
        <p>{m.roles.map(role => l[role]).join(', ')} · {l[m.status]}</p>
        {m.unavailableReasons.length > 0 && <p>{m.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
        <details><summary>{l.moreActions}</summary>{button(l.unlink, () => create({ type: 'UNLINK', payload: { methodId: m.methodId } }), busy || !terminal || m.capabilities.unlink !== true)}</details>
      </div>)}
    </section>
    <section className="axis-identity-group" aria-label={l.add}><h3>{l.add}</h3>
      <div className="axis-identity-additions">{facts && (['EMAIL', 'PHONE', 'USERNAME'] as const).map(k => <div key={k}>{capabilityButton(k === 'EMAIL' ? l.addEmail : k === 'PHONE' ? l.addPhone : l.addUsername, facts.identifiers.management.add[k], () => { update('kind', k); update('value', ''); update('region', ''); update('adding', true); update('operationOpen', true) }, `add-${k}`)}</div>)}</div>
      <details><summary>{l.connectProvider}</summary><p>{l.providerSelection}</p>{facts?.providers.map(p => <div key={p.id} style={{ marginTop: 12 }}>
        {p.displayName} {button(l.link, () => create({ type: 'LINK', payload: { providerId: p.id } }), busy || !terminal || !p.canLink)}
        {p.unavailableReasons.length > 0 && <p>{p.unavailableReasons.map(reason => identityErrorMessage(reason, locale)).join(' ')}</p>}
      </div>)}</details>
    </section>
    </fieldset>
    </div>
  </section>
}
