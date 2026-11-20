import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AuthenticationTransactionError,
  SessionTransportError,
  SessionInvalidatedError,
} from '@axis-iam/vertex'
import type {
  AuthenticationFlow,
  LoginView,
  MfaProofMethod,
  RegistrationOperation,
} from '@axis-iam/vertex'
import { useIamContext } from '../provider/IamProvider'
import { IamApiError } from '../core/types'
import type { RegistrationGrantInput } from '../core/types'
import { AuthFlowStateError } from '../core/auth-flow-types'
import { AuthProviderWindow } from '../core/auth-provider-window'
import type {
  AuthFlowState,
  AuthFlowIntent,
  AuthFlowPending,
  UseAuthFlowOptions,
  UseAuthFlowResult,
  AuthFlowActions,
} from '../core/auth-flow-types'
import {
  assertSignupPassword,
  authFlowRequest,
  registrationGrantBody,
  validateFlowMetadata,
  hasLocalRegistration,
} from '../core/auth-flow-client'
import {
  isLikelyEmail,
  getAvailableCredentialMethods,
  getAvailableProviderOptions,
} from '../components/sign-in/sign-in-flow'

export type {
  AuthFlowState,
  AuthFlowIntent,
  AuthCredentialMethod,
  AuthFlowActions,
  UseAuthFlowOptions,
  UseAuthFlowResult,
} from '../core/auth-flow-types'
export { AuthFlowStateError } from '../core/auth-flow-types'

const initial = (intent: AuthFlowIntent): AuthFlowState => ({
  intent,
  step: 'loading',
  capabilities: null,
  policy: null,
  providers: [],
  pending: null,
  error: null,
  retryAfterSeconds: 0,
  verificationResendDeadline: null,
  verificationEmail: null,
  registrationCancelUnconfirmed: false,
  cancellationUnconfirmed: false,
  transactionExpiresAt: null,
  challengeExpiresAt: null,
})

/** Public transaction flow shared by prebuilt forms and host-owned presentation. */
export function useAuthFlow(
  options: UseAuthFlowOptions = {},
): UseAuthFlowResult {
  const { client } = useIamContext()
  const latest = useRef(options)
  latest.current = options
  const [state, setState] = useState<AuthFlowState>(() =>
    initial(options.initialIntent ?? 'sign-in'),
  )
  const [metadataRevision, reloadMetadata] = useState(0)
  const snapshot = useRef(state)
  const epoch = useRef(0)
  const observedGeneration = useRef(client.state.generation)
  const sessionGeneration = client.state.generation
  const mounted = useRef(true)
  const registrationAttempt = useRef<{ body: string; key: string } | null>(null)
  const transaction = useRef<AuthenticationFlow | null>(null)
  const providerWindow = useRef<AuthProviderWindow | null>(null)
  const automaticCallback = useRef<string | null>(null)
  const selectionCancellation = useRef<Promise<void> | null>(null)
  const cooldown = useRef(0)
  const operation = useRef<{
    name: AuthFlowPending
    key: string
    promise: Promise<unknown>
  } | null>(null)
  const update = (next: AuthFlowState) => {
    snapshot.current = next
    setState(next)
  }
  const invalidate = () => {
    epoch.current++
    providerWindow.current?.close()
    providerWindow.current = null
    operation.current = null
    selectionCancellation.current = null
    cooldown.current = 0
  }
  const idle = (intent: AuthFlowIntent): AuthFlowState => {
    const previous = snapshot.current
    const base = {
      ...initial(intent),
      capabilities: previous.capabilities,
      policy: previous.policy,
    }
    if (!base.capabilities || !base.policy)
      return {
        ...base,
        step: previous.step === 'unavailable' ? 'unavailable' : 'loading',
      }
    const signup =
      base.capabilities.signupEnabled &&
      base.capabilities.selfRegistrationEnabled &&
      base.policy.signupMode !== 'DISABLED'
    const providers = getAvailableProviderOptions(
      base.capabilities,
      intent,
    ).filter((x) => intent === 'sign-in' || (signup && x.availableForSignup))
    const hasMethod = intent === 'sign-in' ? base.capabilities.identifierMethods.length > 0 : signup && hasLocalRegistration(base.capabilities)
    return {
      ...base,
      providers,
      step:
        hasMethod || providers.length
          ? intent === 'sign-in'
            ? 'identifier'
            : 'sign-up'
          : 'unavailable',
    }
  }

  useEffect(() => {
    mounted.current = true
    selectionCancellation.current = null
    ++epoch.current
    let cancelled = false
    update(initial(latest.current.initialIntent ?? 'sign-in'))
    Promise.all([client.getPublicAuthMethods(), client.getPublicAuthPolicy()])
      .then(([capabilities, policy]) => {
        validateFlowMetadata(capabilities, policy)
        if (cancelled || !mounted.current) return
        snapshot.current = { ...snapshot.current, capabilities, policy }
        update(idle(snapshot.current.intent))
        if (client.mode === 'server_session') {
          void client.restoreSession().then(async () => {
            if (cancelled || !mounted.current) return
            const v = client.session.getSnapshot()
            if (v?.state === 'MFA_REQUIRED') {
              transaction.current = await client.beginAuthentication()
              if (cancelled || !mounted.current) { transaction.current.invalidate(); transaction.current = null; return }
              update({ ...snapshot.current, step: 'mfa', identifier: '', methods: ['TOTP', 'RECOVERY_CODE'], transactionExpiresAt: v.expiresAt })
            }
          }).catch(error => {
            if (!cancelled && mounted.current) update({ ...snapshot.current, error: error instanceof Error ? error : new AuthFlowStateError('Session restore failed') })
          })
        }
      })
      .catch((error: unknown) => {
        if (cancelled || !mounted.current) return
        update({
          ...snapshot.current,
          step: 'unavailable',
          error:
            error instanceof Error
              ? error
              : new Error('Authentication options are unavailable'),
        })
      })
    return () => {
      cancelled = true
      mounted.current = false
      transaction.current?.invalidate(true)
      transaction.current = null
      invalidate()
    }
  }, [client, metadataRevision])

  useEffect(() => {
    if (!state.retryAfterSeconds) return
    const timer = setInterval(() => {
      if (!mounted.current) return
      const remaining = Math.max(
        0,
        Math.ceil((cooldown.current - Date.now()) / 1000),
      )
      if (snapshot.current.retryAfterSeconds !== remaining)
        update({ ...snapshot.current, retryAfterSeconds: remaining })
    }, 250)
    return () => clearInterval(timer)
  }, [state.retryAfterSeconds])

  useEffect(() => {
    if (!state.transactionExpiresAt) return
    const deadline = Date.parse(state.transactionExpiresAt)
    const timer = setTimeout(
      () => {
        transaction.current?.invalidate()
        transaction.current = null
        invalidate()
        const error = new AuthenticationTransactionError(
          'AUTH_TRANSACTION_EXPIRED',
        )
        update({ ...idle(snapshot.current.intent), error })
        latest.current.onError?.(error)
      },
      Math.max(0, Math.min(deadline - Date.now(), 2147483647)),
    )
    return () => clearTimeout(timer)
  }, [state.transactionExpiresAt])

  const actions = useMemo<AuthFlowActions>(() => {
    function assertAvailable() {
      const current = snapshot.current
      if (
        !current.capabilities ||
        !current.policy ||
        current.step === 'loading' ||
        current.step === 'unavailable'
      )
        throw new AuthFlowStateError('Authentication options are unavailable')
      return current
    }
    function method(expected?: 'password' | 'code' | 'magic_link') {
      const current = assertAvailable()
      if (
        current.intent !== 'sign-in' ||
        current.step !== 'method' ||
        !current.method ||
        (expected === 'password' && current.method !== 'password') ||
        (expected === 'magic_link' && current.method !== 'magic_link') ||
        (expected === 'code' &&
          current.method !== 'sms' &&
          current.method !== 'email_otp')
      )
        throw new AuthFlowStateError(
          'This action is not available in the current authentication step',
        )
      return current
    }
    function assertSignup(grant?: RegistrationGrantInput) {
      const current = assertAvailable()
      const { policy, capabilities } = current
      if (
        !policy ||
        !capabilities ||
        current.intent !== 'sign-up' ||
        !capabilities.signupEnabled ||
        !capabilities.selfRegistrationEnabled ||
        policy.signupMode === 'DISABLED'
      )
        throw new AuthFlowStateError('Registration is unavailable')
      registrationGrantBody(grant)
      if (grant && !policy.allowedRegistrationGrantTypes.includes(grant.type))
        throw new IamApiError('This registration proof is not accepted.', {
          status: 400,
          code: 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED',
        })
      if (!grant && policy.signupMode === 'INVITE_REQUIRED')
        throw new IamApiError('Registration requires an invitation.', {
          status: 400,
          code: 'REGISTRATION_GRANT_REQUIRED',
        })
      return { current, policy, capabilities }
    }
    function run<T>(
      name: AuthFlowPending,
      key: string,
      work: (check: () => void, committed: () => void) => Promise<T>,
    ): Promise<T> {
      const pending = operation.current
      if (pending) {
        if (pending.name === name && pending.key === key)
          return pending.promise as Promise<T>
        return Promise.reject(
          new AuthFlowStateError('Another authentication operation is pending'),
        )
      }
      const attempt = epoch.current
      let generation = client.state.generation
      const prelogin = client.mode === 'server_session' && !client.isAuthenticated()
      let tokenCommitted = false
      const check = () => {
        if (!mounted.current || epoch.current !== attempt)
          throw new SessionInvalidatedError()
        client.state.assertCurrent(generation)
      }
      const committed = () => {
        tokenCommitted = true
        generation = client.state.generation
        observedGeneration.current = generation
      }
      const promise = Promise.resolve()
        .then(() => {
          check()
          return work(check, committed)
        })
        .then((result) => {
          check()
          return result
        })
        .catch((error: unknown) => {
          // The failing proof cleared its own prelogin generation. Keep that
          // invalidation, but own the resulting error before retiring the flow.
          // A logout/replacement or a late old response must still fail check().
          const rejectedProof = prelogin && !tokenCommitted &&
            ['password', 'verify-code', 'complete-magic-link', 'mfa'].includes(name) &&
            error instanceof SessionTransportError && error.status === 401 &&
            client.state.generation === generation + 1 &&
            client.state.invalidationReason === 'unauthorized' && !client.isAuthenticated()
          if (rejectedProof) {
            generation = client.state.generation
            observedGeneration.current = generation
          }
          // A 401 view read clears the token and advances generation after commit.
          if (tokenCommitted && error instanceof IamApiError && error.status === 401 &&
              client.mode === 'oauth_tokens' &&
              client.state.generation === generation + 1 && !client.getAccessToken()) committed()
          check()
          const next =
            error instanceof Error ? error : new Error('Authentication failed')
          const retry =
            next instanceof IamApiError ||
            next instanceof AuthenticationTransactionError || next instanceof SessionTransportError
              ? next.retryAfterSeconds
              : undefined
          const restart = rejectedProof || name === 'provider' || name === 'provider-callback' ||
            (next instanceof SessionTransportError && ['password', 'verify-code', 'mfa'].includes(name) &&
              (next.status === 0 || next.status >= 500)) ||
            (next instanceof AuthenticationTransactionError &&
              ['AUTH_TRANSACTION_UNCERTAIN', 'AUTH_TRANSACTION_RETRY_REQUIRED',
                'AUTH_TRANSACTION_INVALIDATED', 'TOKEN_EXCHANGE_UNCERTAIN',
                'TOKEN_EXCHANGE_REJECTED', 'AUTH_TRANSACTION_INVALID_RESPONSE'].includes(next.code))
          if (restart || tokenCommitted) {
            if (tokenCommitted && client.mode === 'oauth_tokens' && client.getAccessToken()) {
              // logout discards this attempt's tokens synchronously, before remote revocation.
              // Revocation is best effort: a failed/hung endpoint must not trap the login form.
              // Preserve the original typed login error; do not claim remote logout succeeded.
              void client.logout({ redirect: false }).catch(() => {
                // Local state is already discarded; the login error remains authoritative.
              })
              observedGeneration.current = client.state.generation
            }
            transaction.current?.invalidate()
            transaction.current = null
            invalidate()
          }
          if (retry !== undefined) cooldown.current = Date.now() + retry * 1000
          update({
            ...(restart || tokenCommitted ? idle(snapshot.current.intent) : snapshot.current),
            error: next,
            ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
            ...((next instanceof IamApiError ||
              next instanceof AuthenticationTransactionError) &&
            next.code === 'EMAIL_VERIFICATION_REQUIRED' &&
            snapshot.current.step === 'method' &&
            snapshot.current.identifierKind === 'email'
              ? { verificationEmail: snapshot.current.identifier }
              : {}),
          })
          latest.current.onError?.(next)
          throw next
        })
        .finally(() => {
          if (operation.current?.promise === promise) {
            operation.current = null
            if (mounted.current && epoch.current === attempt) {
              if (client.state.generation === generation)
                update({ ...snapshot.current, pending: null })
              else {
                observedGeneration.current = client.state.generation
                invalidate()
                update(idle(snapshot.current.intent))
              }
            }
          }
        })
      operation.current = { name, key, promise }
      update({ ...snapshot.current, pending: name, error: null })
      return promise
    }
    async function getTransaction(check: () => void) {
      if (selectionCancellation.current) {
        await selectionCancellation.current
        check()
      }
      if (transaction.current) return transaction.current
      const next = await client.beginAuthentication()
      try {
        check()
      } catch (error) {
        next.invalidate()
        throw error
      }
      transaction.current = next
      update({
        ...snapshot.current,
        transactionExpiresAt: next.getSnapshot().expiresAt,
      })
      return next
    }
    async function advance(
      view: LoginView,
      check: () => void,
      committed: () => void,
    ) {
      check()
      if (view.state === 'MFA_REQUIRED') {
        const current = snapshot.current
        update({
          ...current,
          step: 'mfa',
          identifier: 'identifier' in current ? current.identifier : '',
          methods: ['TOTP', 'RECOVERY_CODE'],
        })
        return
      }
      if (
        !['AUTHENTICATED', 'COMPLETED'].includes(view.state) ||
        !transaction.current
      )
        throw new AuthFlowStateError('Authentication is not ready to complete')
      const active = transaction.current
      await client.completeAuthentication(active, () => {
          committed()
          transaction.current = null
          update({
            ...snapshot.current,
            transactionExpiresAt: null,
            challengeExpiresAt: null,
          })
      })
      check()
      finishSignIn()
    }
    function finishSignIn() {
      const user = client.state.getUser()
      if (!user)
        throw new AuthFlowStateError('Required session views are unavailable')
      transaction.current = null
      update({
        ...snapshot.current,
        transactionExpiresAt: null,
        challengeExpiresAt: null,
        step: 'success',
        user,
        error: null,
      })
      latest.current.onSignInSuccess?.(user)
    }
    function reset(intent = snapshot.current.intent): Promise<void> {
      const current = snapshot.current
      if (client.mode === 'oauth_tokens' && client.getAccessToken())
        return Promise.reject(new AuthFlowStateError('Sign out before starting another login'))
      if (current.step === 'verification' && current.registration.status === 'PENDING_VERIFICATION' &&
        Date.parse(current.registration.expiresAt) > Date.now())
        return Promise.reject(new AuthFlowStateError('Complete or explicitly cancel the pending registration before leaving'))
      const previous = transaction.current
      transaction.current = null
      invalidate()
      const currentEpoch = epoch.current
      const generation = client.state.generation
      registrationAttempt.current = null
      update(idle(intent))
      if (!previous) return Promise.resolve()
      return previous
        .cancel()
        .then(() => undefined)
        .catch((error: unknown) => {
          if (
            mounted.current &&
            epoch.current === currentEpoch &&
            client.state.generation === generation
          ) {
            const failure =
              error instanceof Error
                ? error
                : new AuthFlowStateError('Cancellation was not confirmed')
            update({
              ...snapshot.current,
              cancellationUnconfirmed: true,
              error: failure,
            })
            latest.current.onError?.(failure)
          }
          throw error
        })
    }
    function changeSelection() {
      const previous = transaction.current
      transaction.current = null
      invalidate()
      if (!previous) return
      const currentEpoch = epoch.current
      const generation = client.state.generation
      const cancellation: Promise<void> = previous.cancel().then(() => undefined).catch((error: unknown) => {
        if (
          !mounted.current ||
          epoch.current !== currentEpoch ||
          client.state.generation !== generation
        )
          return
        const failure =
          error instanceof Error
            ? error
            : new AuthFlowStateError('Cancellation was not confirmed')
        update({
          ...snapshot.current,
          ...(client.mode === 'server_session' ? { step: 'unavailable' as const } : {}),
          cancellationUnconfirmed: true,
          error: failure,
        })
        latest.current.onError?.(failure)
        throw failure
      }).finally(() => {
        if (selectionCancellation.current === cancellation) selectionCancellation.current = null
      })
      selectionCancellation.current = cancellation
      // Record uncertainty in public state even if no subsequent credential action awaits it.
      void cancellation.catch(() => undefined)
    }
    function requireCooldown() {
      if (Date.now() < cooldown.current)
        throw new AuthFlowStateError('Wait before requesting another code')
    }
    function setCooldown(seconds: number) {
      cooldown.current = Date.now() + seconds * 1000
      update({ ...snapshot.current, retryAfterSeconds: seconds })
    }
    function registrationCooldown(registration: RegistrationOperation) {
      const deadline = registration.nextChallengeAt ? Date.parse(registration.nextChallengeAt) : 0
      if (!Number.isFinite(deadline)) throw new AuthFlowStateError('Invalid registration resend deadline')
      cooldown.current = registration.status === 'PENDING_VERIFICATION' ? deadline : 0
      update({ ...snapshot.current, verificationResendDeadline: cooldown.current || null,
        retryAfterSeconds: Math.max(0, Math.ceil((cooldown.current - Date.now()) / 1000)) })
    }
    function signupGrant(input?: RegistrationGrantInput) {
      if (input && latest.current.registrationGrant)
        throw new IamApiError('Provide only one registration proof.', {
          status: 400,
          code: 'REGISTRATION_GRANT_INVALID',
        })
      return input ?? latest.current.registrationGrant
    }
    async function authorizeProvider(providerId: string, suppliedGrant: RegistrationGrantInput | undefined, check: () => void) {
      const current = assertAvailable()
      const provider = current.providers.find((x) => x.id === providerId)
      if (!provider) throw new AuthFlowStateError('This provider is unavailable')
      const grant = signupGrant(suppliedGrant)
      if (current.intent === 'sign-up') assertSignup(grant)
      if (grant?.type === 'ORG_INVITATION')
        throw new IamApiError('Organization invitation proof is unsupported for provider authorization.',
          { status: 400, code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED' })
      const tx = await getTransaction(check)
      const result = await tx.authorizeProvider(provider.id, registrationGrantBody(current.intent === 'sign-up' ? grant : undefined))
      check()
      return result.authorizationUrl
    }
    async function consumeProvider(url: string, check: () => void, committed: () => void) {
      const result = await client.resumeProviderCallback(url, () => {
        committed()
        transaction.current = null
        update({ ...snapshot.current, transactionExpiresAt: null, challengeExpiresAt: null })
      }, check)
      check()
      if (result.kind === 'continuation') {
        transaction.current = result.transaction
        update({ ...snapshot.current, transactionExpiresAt: result.view.expiresAt })
        await advance(result.view, check, committed)
      } else finishSignIn()
    }
    return {
      retryOptions() {
        if (snapshot.current.step !== 'unavailable')
          return Promise.reject(new AuthFlowStateError('Authentication options are already available'))
        invalidate()
        reloadMetadata((revision) => revision + 1)
        return Promise.resolve()
      },
      setIntent: reset,
      reset: () => reset(latest.current.initialIntent ?? 'sign-in'),
      cancel: () => reset(),
      back: () => reset(),
      continueWithIdentifier(identifier) {
        const current = assertAvailable()
        if (current.intent !== 'sign-in' || !['identifier', 'method'].includes(current.step) || current.pending !== null)
          throw new AuthFlowStateError(
            'An identifier cannot be selected in this step',
          )
        if (
          !identifier.value.trim() ||
          !['EMAIL', 'PHONE', 'USERNAME'].includes(identifier.kind)
        )
          throw new AuthFlowStateError(
            'Select an identifier kind and enter a value',
          )
        if (identifier.kind === 'EMAIL' && !isLikelyEmail(identifier.value))
          throw new AuthFlowStateError('Enter a valid email address')
        const identifierKind =
          identifier.kind === 'EMAIL'
            ? 'email'
            : identifier.kind === 'PHONE'
              ? 'phone'
              : 'username'
        const supported = current.capabilities!.identifierMethods.find(
          (entry) => entry.kind === identifier.kind,
        )
        if (!supported) throw new AuthFlowStateError('This identifier kind is unavailable')
        const methods = getAvailableCredentialMethods(current.capabilities!, identifierKind).map((method) => method.id)
        changeSelection()
        update({
          ...current,
          step: 'method',
          phase: 'credentials',
          identifier: identifier.value.trim(),
          loginIdentifier: identifier,
          identifierKind,
          methods,
          method: methods[0] ?? null,
          codeSent: false,
          magicLinkSent: false,
          error: null,
          pending: null,
          retryAfterSeconds: 0,
          transactionExpiresAt: null, challengeExpiresAt: null, verificationResendDeadline: null,
        })
      },
      selectMethod(next) {
        const current = method()
        if (!current.methods.includes(next))
          throw new AuthFlowStateError(
            'This authentication method is unavailable',
          )
        if (current.method === next) return
        changeSelection()
        update({
          ...current,
          method: next,
          phase: 'credentials',
          codeSent: false,
          magicLinkSent: false,
          error: null,
          pending: null,
          retryAfterSeconds: 0,
          verificationEmail: null,
          transactionExpiresAt: null,
          challengeExpiresAt: null,
          verificationResendDeadline: null,
        })
      },
      submitPassword(password) {
        return run('password', password, async (check, committed) => {
          const current = method('password')
          const tx = await getTransaction(check)
          await advance(
            await tx.authenticate({
              method: 'PASSWORD',
              identifier: current.loginIdentifier,
              password,
            }),
            check,
            committed,
          )
        })
      },
      sendCode() {
        return run('send-code', '', async (check) => {
          const current = method('code')
          requireCooldown()
          const tx = await getTransaction(check)
          const challenge = await tx.challenge(
            current.method === 'sms' ? 'SMS_OTP' : 'EMAIL_OTP',
            current.loginIdentifier,
          )
          check()
          if (snapshot.current.step !== 'method')
            throw new SessionInvalidatedError()
          update({
            ...snapshot.current,
            codeSent: true,
            phase: 'code',
            challengeExpiresAt: challenge.challengeExpiresAt,
          })
          setCooldown(challenge.cooldownSeconds)
        })
      },
      verifyCode(code) {
        return run('verify-code', code, async (check, committed) => {
          const current = method('code')
          if (current.challengeExpiresAt && Date.parse(current.challengeExpiresAt) <= Date.now()) throw new AuthenticationTransactionError('AUTH_CHALLENGE_EXPIRED')
          if (!current.codeSent || !transaction.current)
            throw new AuthFlowStateError('Request a code first')
          await advance(
            await transaction.current.authenticate({
              method: current.method === 'sms' ? 'SMS_OTP' : 'EMAIL_OTP',
              identifier: current.loginIdentifier,
              proof: code,
            }),
            check,
            committed,
          )
        })
      },
      sendMagicLink() {
        return run('magic-link', '', async (check) => {
          const current = method('magic_link')
          requireCooldown()
          const tx = await getTransaction(check)
          tx.persistForNavigation()
          const challenge = await tx.challenge(
            'EMAIL_MAGIC_LINK',
            current.loginIdentifier,
          )
          check()
          if (snapshot.current.step !== 'method')
            throw new SessionInvalidatedError()
          update({
            ...snapshot.current,
            magicLinkSent: true,
            phase: 'magic-link',
            challengeExpiresAt: challenge.challengeExpiresAt,
          })
          setCooldown(challenge.cooldownSeconds)
        })
      },
      completeMagicLink(url) {
        return run('complete-magic-link', url, async (check, committed) => {
          const current = method('magic_link')
          const tx = transaction.current ?? (await client.resumeMagicLink(url))
          check()
          transaction.current = tx
          update({
            ...snapshot.current,
            transactionExpiresAt: tx.getSnapshot().expiresAt,
          })
          try {
            await advance(
              await tx.authenticateMagicLink(url, current.loginIdentifier),
              check,
              committed,
            )
          } finally {
            if (typeof window !== 'undefined' && window.location.href === url) {
              const clean = new URL(url)
              clean.hash = ''
              window.history.replaceState(window.history.state, '', clean.href)
            }
          }
        })
      },
      resumeProviderCallback(url) {
        if (snapshot.current.step === 'success')
          return Promise.reject(new AuthFlowStateError('Authentication is already complete'))
        return run('provider-callback', url, async (check, committed) => {
          try {
            await consumeProvider(url, check, committed)
          } finally {
            if (typeof window !== 'undefined' && window.location.href === url) {
              const clean = new URL(url)
              for (const key of [
                'kind',
                'auth_transaction_id',
                'state',
                'code',
                'error',
              ])
                clean.searchParams.delete(key)
              window.history.replaceState(window.history.state, '', clean.href)
            }
          }
        })
      },
      verifyMfa(code, method: MfaProofMethod = 'TOTP') {
        return run(
          'mfa',
          JSON.stringify({ method, code }),
          async (check, committed) => {
            if (snapshot.current.step !== 'mfa' || !transaction.current)
              throw new AuthFlowStateError('No MFA challenge is pending')
            await advance(
              await transaction.current.verifyMfa(method, code),
              check,
              committed,
            )
          },
        )
      },
      signUp(input) {
        return run('sign-up', JSON.stringify(input), async (check) => {
          const grant = signupGrant(input.registrationGrant)
          const { current, policy, capabilities } = assertSignup(grant)
          if (
            current.step !== 'sign-up' ||
            !['EMAIL', 'USERNAME'].includes(input.identifier.kind) ||
            !capabilities.allowedSignupIdentifierKinds.includes(input.identifier.kind) ||
            !hasLocalRegistration(capabilities, input.identifier.kind)
          )
            throw new AuthFlowStateError('Password registration is unavailable')
          assertSignupPassword(input.password, policy)
          const request = {
            identifier: input.identifier,
            password: input.password,
            ...registrationGrantBody(grant),
          }
          const body = JSON.stringify(request)
          if (
            !registrationAttempt.current ||
            registrationAttempt.current.body !== body
          )
            registrationAttempt.current = { body, key: crypto.randomUUID() }
          const registration = await client.identity.startRegistration(
            request,
            registrationAttempt.current.key,
          )
          registrationAttempt.current = null
          check()
          update({
            ...snapshot.current,
            step: 'verification',
            registration,
            verificationEmail:
              input.identifier.kind === 'EMAIL' ? input.identifier.value : null,
          })
          registrationCooldown(registration)
          if (registration.status === 'COMPLETED')
            latest.current.onSignUpSuccess?.(registration)
        })
      },
      completeRegistration(code) {
        return run('complete-registration', code, async (check) => {
          const current = assertAvailable()
          if (current.step !== 'verification')
            throw new AuthFlowStateError('Registration is not pending')
          if (current.registrationCancelUnconfirmed)
            throw new AuthFlowStateError('Reconcile registration cancellation before submitting another proof')
          const registration = await client.identity.registrationAction(
            current.registration.registrationId,
            'complete',
            code,
          )
          check()
          update({
            ...snapshot.current,
            step: 'verification',
            registration,
            registrationCancelUnconfirmed: false,
          })
          registrationCooldown(registration)
          if (registration.status === 'COMPLETED')
            latest.current.onSignUpSuccess?.(registration)
        })
      },
      cancelRegistration() {
        return run('cancel-registration', '', async (check) => {
          const current = assertAvailable()
          if (current.step !== 'verification')
            throw new AuthFlowStateError('Registration is not pending')
          update({ ...snapshot.current, registrationCancelUnconfirmed: true })
          const registration = await client.identity.registrationAction(
            current.registration.registrationId,
            'cancel',
          )
          check()
          update({
            ...snapshot.current,
            step: 'verification',
            registration,
            registrationCancelUnconfirmed: false,
          })
          registrationCooldown(registration)
        })
      },
      resumeRegistration(id) {
        return run('resend-verification', id, async (check) => {
          const registration = await client.identity.getRegistration(id)
          check()
          update({
            ...snapshot.current,
            step: 'verification',
            registration,
            registrationCancelUnconfirmed: false,
          })
          registrationCooldown(registration)
        })
      },
      resendVerification() {
        return run('resend-verification', '', async (check) => {
          const current = assertAvailable()
          requireCooldown()
          if (
            current.step === 'method' &&
            current.verificationEmail &&
            current.capabilities
          ) {
            await authFlowRequest(
              client,
              'email/verification/send',
              { email: current.verificationEmail, client_id: client.clientId },
              check,
              true,
            )
            const seconds =
              current.capabilities.resend.emailVerificationCooldownSeconds
            update({
              ...snapshot.current,
              verificationResendDeadline: Date.now() + seconds * 1000,
            })
            setCooldown(seconds)
            return
          }
          if (current.step !== 'verification')
            throw new AuthFlowStateError('Registration is not pending')
          if (current.registrationCancelUnconfirmed)
            throw new AuthFlowStateError('Reconcile registration cancellation before requesting another challenge')
          const registration = await client.identity.registrationAction(
            current.registration.registrationId,
            'challenges',
          )
          check()
          update({
            ...snapshot.current,
            step: 'verification',
            registration,
            registrationCancelUnconfirmed: false,
          })
          registrationCooldown(registration)
        })
      },
      startProvider(providerId, suppliedGrant) {
        return run('provider', providerId, check => authorizeProvider(providerId, suppliedGrant, check))
      },
      signInWithProvider(providerId, options = {}) {
        return run('provider', providerId, async (check, committed) => {
          const redirectUri = client.mode === 'server_session' ? client.config.sessionProviderReturnUri : client.config.redirectUri
          if (!redirectUri) throw new AuthFlowStateError('A provider return URI is required')
          const popup = new AuthProviderWindow(redirectUri, options.timeoutMs, client.mode === 'server_session' ? 'server-session' : 'oauth')
          providerWindow.current = popup
          try {
            const url = await popup.start(() => authorizeProvider(providerId, options.registrationGrant, check))
            check()
            await consumeProvider(url, check, committed)
          } finally {
            popup.close()
            if (providerWindow.current === popup) providerWindow.current = null
          }
        })
      },
    }
  }, [client])

  useEffect(() => {
    if (latest.current.autoProviderCallback === false || typeof window === 'undefined' ||
        AuthProviderWindow.isCallbackWindow() || state.step === 'loading' || state.pending ||
        state.step === 'success') return
    const url = window.location.href
    if (automaticCallback.current === url) return
    const matches = client.mode === 'oauth_tokens'
      ? client.canResumeProviderCallback(url)
      : Boolean(client.config.sessionProviderReturnUri &&
          new URL(client.config.sessionProviderReturnUri, window.location.origin).href === url)
    if (!matches) return
    // StrictMode's discarded effect must never claim the one-use callback.
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        automaticCallback.current = url
        void actions.resumeProviderCallback(url).catch(() => { /* Public state carries failure. */ })
      }
    })
    return () => { cancelled = true }
  }, [client, actions, state.step, state.pending])

  useEffect(() => {
    if (observedGeneration.current === client.state.generation) return
    observedGeneration.current = client.state.generation
    // An external logout/replacement already owns the session. Only retire this hook's work.
    transaction.current?.invalidate()
    transaction.current = null
    invalidate()
    update(idle(snapshot.current.intent))
  }, [client, sessionGeneration, actions])

  return { state, actions }
}
