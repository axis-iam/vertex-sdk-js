import { useEffect, useMemo, useRef, useState } from 'react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { useIamContext } from '../provider/IamProvider'
import { IamApiError, IamConfigurationError } from '../core/types'
import { startProviderAuthorization } from '../core/oauth-provider-authorization'
import type { RegistrationGrantInput } from '../core/types'
import { AuthFlowStateError } from '../core/auth-flow-types'
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
  parseDirectAuthResult,
  parseSignupUser,
  registrationGrantBody,
  validateFlowMetadata,
} from '../core/auth-flow-client'
import {
  getAvailableCredentialMethods,
  getAvailableProviderOptions,
  getIdentifierKind,
  storeTokensFromResponse,
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
})

/** Explicit Direct Auth flow shared by prebuilt forms and host-owned presentation. */
export function useAuthFlow(options: UseAuthFlowOptions = {}): UseAuthFlowResult {
  const { client } = useIamContext()
  const latest = useRef(options)
  latest.current = options
  const [state, setState] = useState<AuthFlowState>(() => initial(options.initialIntent ?? 'sign-in'))
  const snapshot = useRef(state)
  const epoch = useRef(0)
  const observedGeneration = useRef(client.tokenManager.generation)
  const sessionGeneration = client.tokenManager.generation
  const mounted = useRef(true)
  const challenge = useRef<string | null>(null)
  const cooldown = useRef(0)
  const operation = useRef<{ name: AuthFlowPending; key: string; promise: Promise<unknown> } | null>(null)
  const update = (next: AuthFlowState) => {
    snapshot.current = next
    setState(next)
  }
  const invalidate = () => {
    epoch.current++
    operation.current = null
    challenge.current = null
    cooldown.current = 0
  }
  const idle = (intent: AuthFlowIntent): AuthFlowState => {
    const previous = snapshot.current
    const base = { ...initial(intent), capabilities: previous.capabilities, policy: previous.policy }
    if (!base.capabilities || !base.policy)
      return { ...base, step: previous.step === 'unavailable' ? 'unavailable' : 'loading' }
    const signup =
      base.capabilities.signupEnabled &&
      base.capabilities.selfRegistrationEnabled &&
      base.policy.signupMode !== 'DISABLED'
    const providers = getAvailableProviderOptions(
      base.capabilities,
      client.config.socialProviders,
      intent,
    ).filter((x) => intent === 'sign-in' || (signup && x.availableForSignup))
    const hasMethod = base.capabilities.methods.some((x) =>
      intent === 'sign-in'
        ? x.availableForLogin && x.type !== 'SOCIAL'
        : signup && x.availableForSignup && x.type === 'PASSWORD',
    )
    return {
      ...base,
      providers,
      step: hasMethod || providers.length ? (intent === 'sign-in' ? 'identifier' : 'sign-up') : 'unavailable',
    }
  }

  useEffect(() => {
    mounted.current = true
    ++epoch.current
    let cancelled = false
    update(initial(latest.current.initialIntent ?? 'sign-in'))
    Promise.all([client.getPublicAuthMethods(), client.getPublicAuthPolicy()])
      .then(([capabilities, policy]) => {
        validateFlowMetadata(capabilities, policy)
        if (cancelled || !mounted.current) return
        snapshot.current = { ...snapshot.current, capabilities, policy }
        update(idle(snapshot.current.intent))
      })
      .catch((error: unknown) => {
        if (cancelled || !mounted.current) return
        update({
          ...snapshot.current,
          step: 'unavailable',
          error: error instanceof Error ? error : new Error('Authentication options are unavailable'),
        })
      })
    return () => {
      cancelled = true
      mounted.current = false
      invalidate()
    }
  }, [client])

  useEffect(() => {
    if (!state.retryAfterSeconds) return
    const timer = setInterval(() => {
      if (!mounted.current) return
      const remaining = Math.max(0, Math.ceil((cooldown.current - Date.now()) / 1000))
      if (snapshot.current.retryAfterSeconds !== remaining)
        update({ ...snapshot.current, retryAfterSeconds: remaining })
    }, 250)
    return () => clearInterval(timer)
  }, [state.retryAfterSeconds])

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
        (expected === 'code' && current.method !== 'sms' && current.method !== 'email_otp')
      )
        throw new AuthFlowStateError('This action is not available in the current authentication step')
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
        if (pending.name === name && pending.key === key) return pending.promise as Promise<T>
        return Promise.reject(new AuthFlowStateError('Another authentication operation is pending'))
      }
      const attempt = epoch.current
      let generation = client.tokenManager.generation
      const check = () => {
        if (!mounted.current || epoch.current !== attempt) throw new SessionInvalidatedError()
        client.tokenManager.assertCurrent(generation)
      }
      const committed = () => {
        generation = client.tokenManager.generation
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
          check()
          const next = error instanceof Error ? error : new Error('Authentication failed')
          const retry = next instanceof IamApiError ? next.retryAfterSeconds : undefined
          if (retry !== undefined) cooldown.current = Date.now() + retry * 1000
          update({
            ...snapshot.current,
            error: next,
            ...(retry !== undefined ? { retryAfterSeconds: retry } : {}),
            ...(next instanceof IamApiError &&
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
              if (client.tokenManager.generation === generation)
                update({ ...snapshot.current, pending: null })
              else {
                observedGeneration.current = client.tokenManager.generation
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
    function tokens(data: unknown, check: () => void, committed: () => void) {
      check()
      const response = parseDirectAuthResult(data)
      if (response.kind !== 'tokens') throw new IamConfigurationError('Expected a completed authentication response')
      storeTokensFromResponse(client, response.data)
      committed()
      const user = client.tokenManager.getUser()
      if (!user) throw new AuthFlowStateError('Authentication response did not establish a user')
      challenge.current = null
      update({ ...snapshot.current, step: 'success', user, error: null })
      latest.current.onSignInSuccess?.(user)
    }
    function reset(intent = snapshot.current.intent) {
      invalidate()
      update(idle(intent))
    }
    function requireCooldown() {
      if (Date.now() < cooldown.current) throw new AuthFlowStateError('Wait before requesting another code')
    }
    function setCooldown(seconds: number) {
      cooldown.current = Date.now() + seconds * 1000
      update({ ...snapshot.current, retryAfterSeconds: seconds })
    }
    function signupGrant(input?: RegistrationGrantInput) {
      if (input && latest.current.registrationGrant)
        throw new IamApiError('Provide only one registration proof.', {
          status: 400,
          code: 'REGISTRATION_GRANT_INVALID',
        })
      return input ?? latest.current.registrationGrant
    }
    return {
      setIntent: reset,
      reset: () => reset(latest.current.initialIntent ?? 'sign-in'),
      cancel: () => reset(),
      back: () => reset(),
      continueWithIdentifier(identifier) {
        const current = assertAvailable()
        if (current.intent !== 'sign-in' || current.step !== 'identifier')
          throw new AuthFlowStateError('An identifier cannot be selected in this step')
        const identifierKind = getIdentifierKind(identifier)
        if (!identifierKind) throw new AuthFlowStateError('Enter a valid email address or phone number')
        const methods = getAvailableCredentialMethods(current.capabilities!, identifierKind).map((x) => x.id)
        invalidate()
        update({
          ...current,
          step: 'method',
          identifier: identifier.trim(),
          identifierKind,
          methods,
          method: methods[0] ?? null,
          codeSent: false,
          magicLinkSent: false,
          error: null,
          pending: null,
          retryAfterSeconds: 0,
        })
      },
      selectMethod(next) {
        const current = method()
        if (!current.methods.includes(next))
          throw new AuthFlowStateError('This authentication method is unavailable')
        invalidate()
        update({
          ...current,
          method: next,
          codeSent: false,
          magicLinkSent: false,
          error: null,
          pending: null,
          retryAfterSeconds: 0,
          verificationEmail: null,
          verificationResendDeadline: null,
        })
      },
      submitPassword(password) {
        return run('password', password, async (check, committed) => {
          const current = method('password')
          const response = parseDirectAuthResult(
            await authFlowRequest(
              client,
              'login',
              { identifier: current.identifier, password, client_id: client.clientId },
              check,
            ),
          )
          if (response.kind === 'mfa') {
            challenge.current = response.token
            update({
              ...snapshot.current,
              step: 'mfa',
              methods: response.methods,
              identifier: current.identifier,
            })
          } else tokens(response.data, check, committed)
        })
      },
      sendCode() {
        return run('send-code', '', async (check) => {
          const current = method('code')
          requireCooldown()
          await authFlowRequest(
            client,
            current.method === 'sms' ? 'sms/send' : 'passwordless/email-otp',
            {
              [current.method === 'sms' ? 'phone' : 'email']: current.identifier,
              client_id: client.clientId,
            },
            check,
            true,
          )
          if (snapshot.current.step !== 'method') throw new SessionInvalidatedError()
          update({ ...snapshot.current, codeSent: true })
          setCooldown(60)
        })
      },
      verifyCode(code) {
        return run('verify-code', code, async (check, committed) => {
          const current = method('code')
          if (!current.codeSent) throw new AuthFlowStateError('Request a code first')
          const data = await authFlowRequest(
            client,
            current.method === 'sms' ? 'sms/verify' : 'passwordless/email-otp/verify',
            {
              [current.method === 'sms' ? 'phone' : 'email']: current.identifier,
              code,
              client_id: client.clientId,
            },
            check,
          )
          tokens(data, check, committed)
        })
      },
      sendMagicLink() {
        return run('magic-link', '', async (check) => {
          const current = method('magic_link')
          requireCooldown()
          await authFlowRequest(
            client,
            'passwordless/magic-link',
            { email: current.identifier, client_id: client.clientId },
            check,
            true,
          )
          if (snapshot.current.step !== 'method') throw new SessionInvalidatedError()
          update({ ...snapshot.current, magicLinkSent: true })
          setCooldown(60)
        })
      },
      completeMagicLink(token) {
        return run('complete-magic-link', token, async (check, committed) => {
          const current = assertAvailable()
          if (
            current.intent !== 'sign-in' ||
            !current.capabilities?.methods.some((x) => x.type === 'EMAIL_MAGIC_LINK' && x.availableForLogin)
          )
            throw new AuthFlowStateError('Magic link authentication is unavailable')
          tokens(
            await authFlowRequest(client, 'passwordless/magic-link/verify', { token }, check),
            check,
            committed,
          )
        })
      },
      verifyMfa(code) {
        return run('mfa', code, async (check, committed) => {
          if (snapshot.current.step !== 'mfa' || !challenge.current)
            throw new AuthFlowStateError('No MFA challenge is pending')
          tokens(
            await authFlowRequest(client, 'mfa/verify', { mfaToken: challenge.current, code }, check),
            check,
            committed,
          )
        })
      },
      signUp(input) {
        return run('sign-up', JSON.stringify(input), async (check) => {
          const grant = signupGrant(input.registrationGrant)
          const { current, policy, capabilities } = assertSignup(grant)
          if (
            current.step !== 'sign-up' ||
            !capabilities.methods.some((x) => x.type === 'PASSWORD' && x.availableForSignup)
          )
            throw new AuthFlowStateError('Password registration is unavailable')
          assertSignupPassword(input.password, policy)
          const user = parseSignupUser(
            await authFlowRequest(
              client,
              'signup',
              {
                email: input.email,
                ...(input.username?.trim() ? { username: input.username.trim() } : {}),
                password: input.password,
                client_id: client.clientId,
                ...registrationGrantBody(grant),
              },
              check,
            ),
          )
          const verificationMode = user.status === 'PENDING' ? 'REQUIRED' : capabilities.emailVerificationMode
          const resend = verificationMode !== 'OFF'
          const seconds = capabilities.resend.emailVerificationCooldownSeconds
          update({
            ...snapshot.current,
            step: 'verification',
            result: { user, verificationMode },
            verificationEmail: resend ? user.email : null,
            verificationResendDeadline: resend ? Date.now() + seconds * 1000 : null,
          })
          if (resend) setCooldown(seconds)
          latest.current.onSignUpSuccess?.(user)
        })
      },
      resendVerification() {
        return run('resend-verification', '', async (check) => {
          const current = assertAvailable()
          requireCooldown()
          if (!current.verificationEmail || !current.capabilities)
            throw new AuthFlowStateError('Email verification is not pending')
          await authFlowRequest(
            client,
            'email/verification/send',
            { email: current.verificationEmail, client_id: client.clientId },
            check,
            true,
          )
          const seconds = current.capabilities.resend.emailVerificationCooldownSeconds
          update({ ...snapshot.current, verificationResendDeadline: Date.now() + seconds * 1000 })
          setCooldown(seconds)
        })
      },
      startProvider(providerId) {
        return run('provider', providerId, async (check) => {
          const current = assertAvailable()
          const provider = current.providers.find((x) => x.id === providerId)
          if (!provider) throw new AuthFlowStateError('This provider is unavailable')
          const grant = latest.current.registrationGrant
          if (current.intent === 'sign-up') assertSignup(grant)
          if (grant?.type === 'ORG_INVITATION')
            throw new IamApiError(
              'Organization invitation proof is unsupported for provider authorization.',
              { status: 400, code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED' },
            )
          const url = await startProviderAuthorization({
            provider,
            config: client.config,
            options: grant ? { registrationGrant: grant } : {},
            resolveRedirectUri: (uri) =>
              new URL(uri ?? client.config.redirectUri, window.location.origin).toString(),
            assertCurrent: check,
            intent: current.intent,
          })
          check()
          return url
        })
      },
    }
  }, [client])

  useEffect(() => {
    if (observedGeneration.current === client.tokenManager.generation) return
    observedGeneration.current = client.tokenManager.generation
    actions.cancel()
  }, [client, sessionGeneration, actions])

  return { state, actions }
}
