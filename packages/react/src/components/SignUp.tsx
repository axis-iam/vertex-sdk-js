import { useEffect, useRef, useState } from 'react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import type { Appearance } from './styles'
import { containerStyle, buttonStyle, errorStyle } from './styles'
import { useIamContext } from '../provider/IamProvider'
import { useIamAppearance, useIamUi } from '../provider/IamUiProvider'
import { useAuthFlow } from '../hooks/useAuthFlow'
import { BrandedAuthContent, useAuthBranding } from './sign-in/BrandedAuthContent'
import { IamApiError } from '../core/types'
import type { RegistrationGrantInput } from '../core/types'
import type { RegistrationOperation } from '@axis-iam/vertex'
import { localizeError } from '../localization'
export type { RegistrationOperation } from '@axis-iam/vertex'
export interface SignUpProps {
  mode?: 'redirect' | 'embedded'
  registrationGrant?: RegistrationGrantInput
  onSuccess?: (operation: RegistrationOperation) => void
  onError?: (error: Error) => void
  appearance?: Appearance
  presentation?: 'standalone' | 'dialog'
}
export function SignUp(props: SignUpProps) {
  return props.mode === 'embedded' ? <EmbeddedSignUp {...props} /> : <RedirectSignUp {...props} />
}
function EmbeddedSignUp({
  registrationGrant,
  onSuccess,
  onError,
  appearance,
  presentation = 'standalone',
}: SignUpProps) {
  const flow = useAuthFlow({
    initialIntent: 'sign-up',
    registrationGrant,
    onSignUpSuccess: onSuccess,
    onError,
  })
  const brand = useAuthBranding(flow.state.intent, appearance)
  return <BrandedAuthContent flow={flow} brand={brand} presentation={presentation} registrationGrant={registrationGrant} />
}

function RedirectSignUp({
  registrationGrant,
  onError,
  appearance,
  presentation = 'standalone',
}: SignUpProps) {
  const { client, login } = useIamContext()
  const { localization: l, locale } = useIamUi()
  const [a] = useIamAppearance(appearance)
  const [error, setError] = useState<Error | null>(null)
  const [pendingOwner, setPendingOwner] = useState<object | null>(null)
  const active = useRef(true)
  const currentClient = useRef(client)
  currentClient.current = client
  const operation = useRef<{ client: typeof client; generation: number } | null>(null)
  const owns = (owner: NonNullable<typeof operation.current>) =>
    active.current &&
    operation.current === owner &&
    currentClient.current === owner.client &&
    owner.client.state.generation === owner.generation
  const pending = operation.current !== null && pendingOwner === operation.current && owns(operation.current)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      operation.current = null
    }
  }, [])
  const start = async () => {
    if (operation.current && owns(operation.current)) return
    const owner = { client, generation: client.state.generation }
    operation.current = owner
    setPendingOwner(owner)
    setError(null)
    try {
      if (!registrationGrant) {
        await login({ locale })
        if (!owns(owner)) return
        return
      }
      assertHostedRegistrationGrant(registrationGrant)
      const policy = await client.getPublicAuthPolicy()
      if (!owns(owner)) return
      if (!policy.allowedRegistrationGrantTypes.includes(registrationGrant.type))
        throw new IamApiError('Registration proof is not accepted.', {
          status: 400,
          code: 'REGISTRATION_GRANT_TYPE_NOT_ALLOWED',
        })
      const config = await client.discover()
      if (owns(owner))
        window.location.assign(buildHostedSignupUrl(config.issuer, client.clientId, registrationGrant, locale))
    } catch (err) {
      if (owns(owner) && !(err instanceof SessionInvalidatedError)) {
        const next = err instanceof Error ? err : new Error(l.signUp.unavailable)
        setError(next)
        onError?.(next)
      }
    } finally {
      // Cleanup owns only this pending slot, even when its auth result was invalidated.
      if (active.current && operation.current === owner) {
        operation.current = null
        setPendingOwner(null)
      }
    }
  }
  return (
    <div
      style={{
        ...containerStyle(a),
        ...(presentation === 'dialog'
          ? { maxWidth: 'none', margin: 0, padding: 0, backgroundColor: 'transparent' }
          : {}),
      }}
    >
      {presentation !== 'dialog' && <h2>{l.signUp.title}</h2>}
      {error && (
        <p role="alert" style={errorStyle(a)}>
          {localizeError(error, l, 'signUpFailed')}
        </p>
      )}
      <button type="button" disabled={pending} onClick={() => void start()} style={buttonStyle(a)}>
        {pending ? l.auth.redirecting : l.signUp.signUp}
      </button>
    </div>
  )
}

function assertHostedRegistrationGrant(input: RegistrationGrantInput): void {
  if (!isRegistrationGrantRecord(input)) throw invalidRegistrationGrant()

  switch (input.type) {
    case 'EMAIL_LINK':
      requireRegistrationGrantProof(input.registrationGrantToken)
      return
    case 'ACCESS_CODE':
      requireRegistrationGrantProof(input.registrationAccessCode)
      return
    case 'ORG_INVITATION':
      throw new IamApiError('Organization invitation proof is not supported for hosted sign-up.', {
        status: 400,
        code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED',
      })
    default:
      throw invalidRegistrationGrant()
  }
}

export function buildHostedSignupUrl(
  issuer: string,
  clientId: string,
  input: RegistrationGrantInput,
  locale?: string,
): string {
  assertHostedRegistrationGrant(input)
  const url = new URL('/signup', issuer)
  url.searchParams.set('client_id', clientId)
  if (locale) url.searchParams.set('ui_locales', locale)
  switch (input.type) {
    case 'EMAIL_LINK':
      url.searchParams.set(
        'registrationGrantToken',
        requireRegistrationGrantProof(input.registrationGrantToken),
      )
      break
    case 'ACCESS_CODE':
      url.searchParams.set(
        'registrationAccessCode',
        requireRegistrationGrantProof(input.registrationAccessCode),
      )
      break
    case 'ORG_INVITATION':
      throw new IamApiError('Organization invitation proof is not supported for hosted sign-up.', {
        status: 400,
        code: 'REGISTRATION_GRANT_HOSTED_UNSUPPORTED',
      })
    default:
      throw invalidRegistrationGrant()
  }
  return url.toString()
}

function requireRegistrationGrantProof(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidRegistrationGrant()
  return value
}

function invalidRegistrationGrant(): IamApiError {
  return new IamApiError('Registration invitation is invalid.', {
    status: 400,
    code: 'REGISTRATION_GRANT_INVALID',
  })
}

function isRegistrationGrantRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
