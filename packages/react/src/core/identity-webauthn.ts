import { IamConfigurationError } from './types'
import { record } from './identity-client'

function decode(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new IamConfigurationError('Invalid WebAuthn challenge')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer
}
function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** UV-required registration uses the same attestation wire format as the backend verifier. */
export async function createInvitationWebAuthn(serialized: string): Promise<string> {
  const raw = record(JSON.parse(serialized)), options = record(raw.publicKey)
  const rp = record(options.rp), user = record(options.user)
  const selection = record(options.authenticatorSelection)
  if (typeof rp.id !== 'string' || typeof rp.name !== 'string' ||
      typeof user.name !== 'string' || typeof user.displayName !== 'string' ||
      selection.userVerification !== 'required' || !Array.isArray(options.pubKeyCredParams))
    throw new IamConfigurationError('Invalid WebAuthn enrollment options')
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: decode(options.challenge), rp: { id: rp.id, name: rp.name },
    user: { id: decode(user.id), name: user.name, displayName: user.displayName },
    pubKeyCredParams: options.pubKeyCredParams.map(value => {
      const param = record(value)
      if (param.type !== 'public-key' || typeof param.alg !== 'number' || !Number.isSafeInteger(param.alg))
        throw new IamConfigurationError('Invalid WebAuthn algorithm')
      return { type: 'public-key', alg: param.alg }
    }),
    authenticatorSelection: { userVerification: 'required' },
  }
  if (options.timeout !== undefined) {
    if (typeof options.timeout !== 'number' || !Number.isFinite(options.timeout) || options.timeout <= 0)
      throw new IamConfigurationError('Invalid WebAuthn timeout')
    publicKey.timeout = options.timeout
  }
  if (options.attestation !== undefined) {
    const value = options.attestation
    if (value !== 'none' && value !== 'direct' && value !== 'indirect' && value !== 'enterprise')
      throw new IamConfigurationError('Invalid WebAuthn attestation')
    publicKey.attestation = value
  }
  if (options.excludeCredentials !== undefined) {
    if (!Array.isArray(options.excludeCredentials)) throw new IamConfigurationError('Invalid WebAuthn exclusions')
    publicKey.excludeCredentials = options.excludeCredentials.map(value => {
      const c = record(value)
      if (c.type !== 'public-key') throw new IamConfigurationError('Invalid WebAuthn exclusion')
      return { type: 'public-key', id: decode(c.id) }
    })
  }
  const credential = await navigator.credentials.create({ publicKey })
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse))
    throw new IamConfigurationError('WebAuthn enrollment did not complete')
  return JSON.stringify({ id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { attestationObject: encode(credential.response.attestationObject),
      clientDataJSON: encode(credential.response.clientDataJSON), transports: credential.response.getTransports() },
    clientExtensionResults: credential.getClientExtensionResults() })
}
/** Existing second-factor assertion only; this does not enable WebAuthn first-factor login. */
export async function assertIdentityWebAuthn(serialized: string): Promise<string> {
  const input: unknown = JSON.parse(serialized)
  const raw = record(input)
  // The backend serializes a CredentialRequestOptions wrapper.
  const options = record(raw.publicKey)
  if (options.rpId !== undefined && typeof options.rpId !== 'string') throw new IamConfigurationError('Invalid WebAuthn RP')
  const verification = options.userVerification
  if (verification !== undefined && verification !== 'required' && verification !== 'preferred' && verification !== 'discouraged')
    throw new IamConfigurationError('Invalid WebAuthn verification requirement')
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: decode(options.challenge),
    ...(options.rpId ? { rpId: options.rpId } : {}),
    ...(verification ? { userVerification: verification } : {}),
  }
  if (options.allowCredentials !== undefined) {
    if (!Array.isArray(options.allowCredentials)) throw new IamConfigurationError('Invalid WebAuthn credentials')
    publicKey.allowCredentials = options.allowCredentials.map(entry => {
      const c = record(entry)
      if (c.type !== 'public-key') throw new IamConfigurationError('Invalid WebAuthn credential type')
      return { type: 'public-key', id: decode(c.id) }
    })
  }
  const credential = await navigator.credentials.get({ publicKey })
  if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAssertionResponse))
    throw new IamConfigurationError('WebAuthn assertion did not complete')
  const response = credential.response
  return JSON.stringify({ id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: { authenticatorData: encode(response.authenticatorData), clientDataJSON: encode(response.clientDataJSON),
      signature: encode(response.signature), userHandle: response.userHandle ? encode(response.userHandle) : null },
    clientExtensionResults: credential.getClientExtensionResults() })
}
