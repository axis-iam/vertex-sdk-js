import {
  createMfaOperationRequestId, mfaOperationReference, parseMfaCapabilities,
  parseMfaChallengeResult, parseMfaCompletionResult, parseMfaOperation,
  parseMfaStepUpResult, parseMfaTotpBeginResult, parseMfaWebAuthnStartResult,
  SessionInvalidatedError, SessionTransportError, sessionRecord, sessionText,
} from '@axis-iam/vertex'
import type {
  MfaOperationClient, MfaOperationType, MfaOperationReauthentication,
  MfaOperationAuthorizeInput, SessionRequest,
} from '@axis-iam/vertex'
import type { AuthClient } from './auth-client'
import { requestJson } from './http-client'
import { IamApiError, IamConfigurationError } from './types'
import { generatePKCEPair } from './pkce'
import { ProviderOperationWindow } from './provider-operation-window'

/** Shared semantics; only this adapter knows Server IDs versus opaque BFF refs. */
export class AccountSecurityOperations implements MfaOperationClient {
  private provider: {
    ref: string
    generation: number
    popup: ProviderOperationWindow
    authorizationId?: string
    verifier?: string
  } | null = null
  private providerRevision = 0
  private providerExpiry: ReturnType<typeof setTimeout> | null = null
  constructor(private readonly client: AuthClient) {
    let generation = client.state.generation
    client.state.subscribe(() => {
      if (generation !== client.state.generation) {
        generation = client.state.generation
        this.cancelProviderWindow()
      }
    })
  }

  private async call(request: SessionRequest, path: string, body?: unknown, key?: string): Promise<unknown> {
    const generation = this.client.state.generation
    if (!this.client.state.isAuthenticated()) throw new IamApiError('Authentication required', { status: 401, code: 'UNAUTHENTICATED' })
    let result: unknown
    try {
      if (this.client.mode === 'server_session') {
        result = await this.client.request(request)
      } else {
        const token = this.client.tokenManager.getAccessToken()
        const config = await this.client.discover()
        this.client.state.assertCurrent(generation)
        result = await requestJson<unknown>(new URL(`/api/v1/auth/mfa/${path}`, config.issuer).href, {
          bearerToken: token, json: body, ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
        })
      }
    } catch (error) {
      if (generation === this.client.state.generation &&
        (error instanceof IamApiError || error instanceof SessionTransportError) && error.status === 401)
        this.client.state.clear('unauthorized')
      throw error
    }
    this.client.state.assertCurrent(generation)
    if (request.action === 'mfaOperationCreate' || ('ref' in request && request.action.startsWith('mfaOperation') && !['mfaOperationStepUpStart', 'mfaOperationWebAuthnStart', 'mfaOperationAuthorize'].includes(request.action))) {
      const nested = ['mfaOperationBegin', 'mfaOperationComplete', 'mfaOperationChallenge'].includes(request.action)
      const operation = parseMfaOperation(nested ? sessionRecord(result).operation : result, this.client.mode)
      if (request.action === 'mfaOperationCreate') {
        if (operation.type !== request.body.type || operation.expectedLoginMethodVersion !== request.body.expectedLoginMethodVersion || (this.client.mode === 'server_session' && operation.ref !== request.body.requestId)) throw new IamConfigurationError('MFA operation response mismatch')
      } else if ('ref' in request && operation.ref !== request.ref) throw new IamConfigurationError('MFA operation response mismatch')
    }
    return result
  }
  private path(ref: string, action = '') {
    mfaOperationReference(ref, this.client.mode)
    return `operations/${encodeURIComponent(ref)}${action ? `/${action}` : ''}`
  }
  getRecoveryCodesRemaining = async () => {
    const v = sessionRecord(await this.call({ action: 'recoveryRemaining' }, 'recovery-codes/remaining'))
    if (typeof v.remaining !== 'number' || !Number.isSafeInteger(v.remaining) || v.remaining < 0) throw new IamConfigurationError('Invalid recovery-code count')
    return v.remaining
  }
  getMfaCapabilities = async () => parseMfaCapabilities(await this.call({ action: 'mfaCapabilities' }, 'capabilities'))
  createMfaOperation = async (type: MfaOperationType, expectedLoginMethodVersion: number, requestId = createMfaOperationRequestId()) => {
    mfaOperationReference(requestId, 'server_session')
    if (!['TOTP_ENROLL', 'TOTP_DISABLE', 'RECOVERY_CODES_GENERATE'].includes(type) || !Number.isSafeInteger(expectedLoginMethodVersion) || expectedLoginMethodVersion < 0) throw new IamConfigurationError('Invalid MFA operation request')
    return parseMfaOperation(await this.call({ action: 'mfaOperationCreate', body: { requestId, type, expectedLoginMethodVersion } }, 'operations', { type, expectedLoginMethodVersion }, requestId), this.client.mode)
  }
  getMfaOperation = async (ref: string) => parseMfaOperation(await this.call({ action: 'mfaOperationGet', ref }, this.path(ref)), this.client.mode)
  reauthenticateMfaOperation = async (ref: string, input: MfaOperationReauthentication) => {
    let body: unknown
    let sessionBody: MfaOperationReauthentication
    if (input.method === 'PASSWORD') {
      if (Object.keys(input).some(key => !['method', 'password'].includes(key)) || typeof input.password !== 'string' || !input.password.trim() || input.password.length > 128) throw new IamConfigurationError('Invalid password proof')
      body = { method: input.method, password: input.password }
      sessionBody = { method: 'PASSWORD', password: input.password }
    } else if (input.method === 'EMAIL_OTP') {
      if (Object.keys(input).some(key => !['method', 'challengeRef', 'code'].includes(key)) || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new IamConfigurationError('Invalid email proof')
      this.challengeRef(input.challengeRef)
      body = { method: input.method, challengeId: input.challengeRef, code: input.code }
      sessionBody = { method: 'EMAIL_OTP', challengeRef: input.challengeRef, code: input.code }
    } else throw new IamConfigurationError('Invalid proof method')
    return parseMfaOperation(await this.call({ action: 'mfaOperationReauthenticate', ref, body: sessionBody }, this.path(ref, 'reauthenticate'), body), this.client.mode)
  }
  challengeMfaOperation = async (ref: string, identifierId: string) => {
    const body = { method: 'EMAIL_OTP' as const, identifierId }
    return parseMfaChallengeResult(await this.call({ action: 'mfaOperationChallenge', ref, body }, this.path(ref, 'challenges'), body), this.client.mode)
  }
  startMfaOperationStepUp = async (ref: string) => parseMfaStepUpResult(await this.call({ action: 'mfaOperationStepUpStart', ref }, this.path(ref, 'step-up/start'), {}), this.client.mode)
  verifyMfaOperationStepUp = async (ref: string, challengeRef: string, code: string) => parseMfaOperation(await this.call({ action: 'mfaOperationStepUpVerify', ref, body: { challengeRef, code } }, this.path(ref, 'step-up/verify'), { challengeId: challengeRef, code }), this.client.mode)
  startMfaOperationWebAuthn = async (ref: string, challengeRef: string) => parseMfaWebAuthnStartResult(await this.call({ action: 'mfaOperationWebAuthnStart', ref, body: { challengeRef } }, this.path(ref, 'step-up/webauthn/start'), { challengeId: challengeRef }), this.client.mode)
  verifyMfaOperationWebAuthn = async (ref: string, challengeRef: string, requestRef: string, credential: string) => parseMfaOperation(await this.call({ action: 'mfaOperationWebAuthnVerify', ref, body: { challengeRef, requestRef, credential } }, this.path(ref, 'step-up/webauthn/verify'), { challengeId: challengeRef, requestId: requestRef, credential }), this.client.mode)
  beginTotpEnrollmentOperation = async (ref: string) => parseMfaTotpBeginResult(await this.call({ action: 'mfaOperationBegin', ref }, this.path(ref, 'begin'), {}), this.client.mode)
  completeMfaOperation = async (ref: string, code?: string) => {
    if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) throw new IamConfigurationError('Invalid confirmation code')
    const body = code === undefined ? {} : { code }
    return parseMfaCompletionResult(await this.call({ action: 'mfaOperationComplete', ref, body }, this.path(ref, 'complete'), body), this.client.mode)
  }
  cancelMfaOperation = async (ref: string) => {
    this.cancelProviderWindow()
    return parseMfaOperation(await this.call({ action: 'mfaOperationCancel', ref }, this.path(ref, 'cancel'), {}), this.client.mode)
  }

  /** Must be called from a user gesture. PKCE stays in short-lived client memory. */
  authorizeMfaOperation = async (ref: string, input: MfaOperationAuthorizeInput) => {
    if (Object.keys(input).some(key => key !== 'methodId') || typeof input.methodId !== 'string' || !input.methodId.trim()) throw new IamConfigurationError('Invalid provider proof')
    this.path(ref)
    this.cancelProviderWindow()
    const generation = this.client.state.generation
    const revision = this.providerRevision
    const popup = new ProviderOperationWindow(() => {
      this.client.state.assertCurrent(generation)
      if (revision !== this.providerRevision) throw new SessionInvalidatedError()
    })
    const owner = { ref, generation, popup }
    this.provider = owner
    try {
      if (this.client.mode === 'server_session') {
        const returnUri = this.client.config.sessionProviderReturnUri
        if (!returnUri) throw new IamConfigurationError('sessionProviderReturnUri must name the BFF callback')
        const result = sessionRecord(await this.call({ action: 'mfaOperationAuthorize', ref, body: input }, this.path(ref, 'authorize')))
        if (result.ref !== ref || 'authorizationId' in result || 'codeVerifier' in result) throw new IamConfigurationError('Invalid provider reference')
        const authorizationUrl = sessionText(result.authorizationUrl), expiresAt = sessionText(result.expiresAt)
        popup.navigateServer(authorizationUrl, returnUri, expiresAt, 'mfa_operation')
        this.armProviderExpiry(expiresAt)
        return { ref, authorizationUrl, expiresAt }
      }
      const pair = await generatePKCEPair()
      this.client.state.assertCurrent(generation)
      const redirectUri = this.client.config.redirectUri
      const result = sessionRecord(await this.call({ action: 'mfaOperationAuthorize', ref, body: input }, this.path(ref, 'authorize'), { methodId: input.methodId, redirectUri, codeChallenge: pair.codeChallenge, codeChallengeMethod: 'S256' }))
      if (this.provider !== owner) throw new SessionInvalidatedError()
      const authorizationId = sessionText(result.authorizationId), authorizationUrl = sessionText(result.authorizationUrl), expiresAt = sessionText(result.expiresAt)
      this.provider = { ...owner, authorizationId, verifier: pair.codeVerifier }
      popup.navigate({ operationId: ref, authorizationId, authorizationUrl, expiresAt, redirectUri, family: 'mfa_operation' })
      this.armProviderExpiry(expiresAt)
      return { ref, authorizationUrl, expiresAt }
    } catch (error) {
      popup.close()
      if (this.provider?.popup === popup) this.provider = null
      throw error
    }
  }
  completeMfaProviderAuthorization = async (ref: string) => {
    const owner = this.provider
    if (!owner || owner.ref !== ref) throw new IamConfigurationError('Open the original provider window')
    this.client.state.assertCurrent(owner.generation)
    owner.popup.callbackUrl()
    const operation = parseMfaOperation(await this.call({ action: 'mfaOperationProviderCallback', ref }, this.path(ref, 'provider-callback'), this.client.mode === 'server_session' ? {} : { authorizationId: owner.authorizationId, codeVerifier: owner.verifier }), this.client.mode)
    if (this.provider !== owner) throw new SessionInvalidatedError()
    this.cancelProviderWindow()
    return operation
  }
  cancelProviderWindow = () => {
    ++this.providerRevision
    if (this.providerExpiry) clearTimeout(this.providerExpiry)
    this.providerExpiry = null
    this.provider?.popup.close()
    this.provider = null
  }
  private armProviderExpiry(expiresAt: string) {
    this.providerExpiry = setTimeout(this.cancelProviderWindow, Math.min(Date.parse(expiresAt) - Date.now(), 2_147_483_647))
  }
  private challengeRef(value: string) {
    if (this.client.mode === 'server_session') mfaOperationReference(value, 'server_session')
    else if (typeof value !== 'string' || !value.trim()) throw new IamConfigurationError('Invalid challenge reference')
  }
}
