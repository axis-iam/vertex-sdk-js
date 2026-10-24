import { IamConfigurationError } from './types'
import { record } from './identity-client'

function decode(value: unknown): ArrayBuffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new IamConfigurationError('Invalid WebAuthn challenge')
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer
}
function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
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
