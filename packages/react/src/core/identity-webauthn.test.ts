import { afterEach, expect, it, vi } from 'vitest'
import { assertIdentityWebAuthn } from './identity-webauthn'
const buffer = () => Uint8Array.from([1, 2, 3]).buffer
afterEach(() => vi.unstubAllGlobals())
it('converts the actual credentials-get wrapper and serializes the second-factor assertion', async () => {
  class Assertion {
    authenticatorData = buffer()
    clientDataJSON = buffer()
    signature = buffer()
    userHandle = null
  }
  class Credential {
    id = 'credential-id'
    rawId = buffer()
    type = 'public-key'
    response = new Assertion()
    getClientExtensionResults() { return {} }
  }
  vi.stubGlobal('PublicKeyCredential', Credential)
  vi.stubGlobal('AuthenticatorAssertionResponse', Assertion)
  const get = vi.fn().mockResolvedValue(new Credential())
  vi.stubGlobal('navigator', { credentials: { get } })
  const result = JSON.parse(await assertIdentityWebAuthn(JSON.stringify({ publicKey: {
    challenge: 'AQID', rpId: 'app.invalid', userVerification: 'required', allowCredentials: [{ id: 'AQID', type: 'public-key' }],
  } })))
  expect(new Uint8Array(get.mock.calls[0][0].publicKey.challenge)).toEqual(Uint8Array.from([1, 2, 3]))
  expect(get.mock.calls[0][0].publicKey.userVerification).toBe('required')
  expect(result).toMatchObject({ type: 'public-key', response: { authenticatorData: 'AQID', signature: 'AQID', userHandle: null } })
})
it('rejects malformed challenge and unexpected verification without invoking credentials', async () => {
  const get = vi.fn()
  vi.stubGlobal('navigator', { credentials: { get } })
  await expect(assertIdentityWebAuthn('{"publicKey":{"challenge":"not valid"}}')).rejects.toThrow()
  await expect(assertIdentityWebAuthn('{"publicKey":{"challenge":"AQID","userVerification":"bypass"}}')).rejects.toThrow()
  expect(get).not.toHaveBeenCalled()
})
