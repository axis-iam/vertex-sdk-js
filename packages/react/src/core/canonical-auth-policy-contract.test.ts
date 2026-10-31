import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { OAuthPublicMetadataClient } from './oauth-public-metadata-client'
import { validateFlowMetadata } from './auth-flow-client'
import { flowCapabilities, flowPolicy } from './auth-flow-fixtures.test-support'
import { getAvailableCredentialMethods } from '../components/sign-in/sign-in-flow'
import type { PublicAuthMethodsResponse, PublicAuthPolicyResponse } from './types'

const independentFields = [
  'emailMagicLinkEnabled', 'emailOtpEnabled', 'smsOtpEnabled',
  'socialLoginEnabled', 'smsAutoProvisioningEnabled',
] as const
const issuer = 'https://policy.example.invalid'
const config = {
  issuerUri: issuer, clientId: 'canonical-policy',
  redirectUri: 'https://app.example.invalid/callback',
}

function capabilities(password: boolean): PublicAuthMethodsResponse {
  return {
    ...flowCapabilities,
    clientId: config.clientId,
    passwordLoginEnabled: password,
    emailMagicLinkEnabled: false,
    socialLoginEnabled: false,
    idpProviders: [],
    allowedPasswordIdentifierKinds: ['EMAIL'],
    defaultLogin: { identifierKind: 'EMAIL', method: password ? 'PASSWORD' : 'EMAIL_OTP' },
    identifierMethods: [
      { kind: 'EMAIL', methods: password ? ['PASSWORD', 'EMAIL_OTP'] : ['EMAIL_OTP'] },
      { kind: 'PHONE', methods: ['SMS_OTP'] },
    ],
    methods: flowCapabilities.methods.map((method) => ({
      ...method,
      enabled: method.type === 'PASSWORD' ? password : method.type !== 'EMAIL_MAGIC_LINK',
      availableForLogin: method.type === 'PASSWORD' ? password : method.type !== 'EMAIL_MAGIC_LINK',
    })),
  }
}

function policy(methods: PublicAuthMethodsResponse): PublicAuthPolicyResponse {
  return {
    ...flowPolicy,
    passwordLoginEnabled: methods.passwordLoginEnabled,
    allowedPasswordIdentifierKinds: methods.allowedPasswordIdentifierKinds,
    defaultLogin: { identifierKind: 'EMAIL', method: methods.passwordLoginEnabled ? 'PASSWORD' : 'EMAIL_OTP' },
    emailMagicLinkEnabled: false,
    socialLoginEnabled: false,
    smsAutoProvisioningEnabled: false,
  }
}

function servePolicy(value: unknown) {
  return vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer, authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
      })
    }
    if (url === `${issuer}/api/v1/apps/${config.clientId}/auth-policy`) return Response.json(value)
    throw new Error(`Unexpected metadata route: ${url}`)
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('canonical auth-policy contract', () => {
  it('publishes the required independent facts without the retired aggregate', () => {
    expectTypeOf<Pick<PublicAuthPolicyResponse, typeof independentFields[number]>>()
      .toEqualTypeOf<{
        emailMagicLinkEnabled: boolean
        emailOtpEnabled: boolean
        smsOtpEnabled: boolean
        socialLoginEnabled: boolean
        smsAutoProvisioningEnabled: boolean
      }>()
    expectTypeOf<'passwordlessEnabled'>().not.toMatchTypeOf<keyof PublicAuthPolicyResponse>()
    expect(Object.keys(flowPolicy)).toHaveLength(29)
    expect(flowPolicy).not.toHaveProperty('passwordlessEnabled')
  })

  it('consumes the canonical bare response and preserves independent false facts and restrictions', async () => {
    const canonical = policy(capabilities(true))
    servePolicy(canonical)
    const client = new OAuthPublicMetadataClient(config)
    const result = await client.getPublicAuthPolicy()
    expect(result).toEqual(canonical)
    expect(result.emailMagicLinkEnabled).toBe(false)
    expect(result.emailOtpEnabled).toBe(true)
    expect(result.smsAutoProvisioningEnabled).toBe(false)
    expect(result.identifierRestrictions).toEqual(canonical.identifierRestrictions)
    expect(result.allowedPasswordIdentifierKinds).toEqual(['EMAIL'])
    expect(await client.getPublicAuthPolicy()).toBe(result)
  })

  it.each(independentFields)('rejects missing or non-boolean %s without filling defaults', async (field) => {
    const methods = capabilities(true)
    for (const invalid of [undefined, null, 'false', 0]) {
      const malformed: Record<string, unknown> = { ...policy(methods), [field]: invalid }
      if (invalid === undefined) delete malformed[field]
      servePolicy(malformed)
      await expect(new OAuthPublicMetadataClient(config).getPublicAuthPolicy()).rejects.toThrow()
      expect(() => validateFlowMetadata(methods, malformed as unknown as PublicAuthPolicyResponse)).toThrow()
    }
  })

  it('does not cache an invalid policy and consumes a subsequent canonical response', async () => {
    const canonical = policy(capabilities(true))
    const invalid = { ...canonical, emailOtpEnabled: undefined }
    servePolicy(invalid)
    const client = new OAuthPublicMetadataClient(config)
    await expect(client.getPublicAuthPolicy()).rejects.toThrow()
    servePolicy(canonical)
    expect(await client.getPublicAuthPolicy()).toEqual(canonical)
  })

  it('retains EMAIL_OTP when password is disabled without enabling other password identifiers', () => {
    const methods = capabilities(false)
    expect(() => validateFlowMetadata(methods, policy(methods))).not.toThrow()
    expect(getAvailableCredentialMethods(methods, 'email')).toEqual([{ id: 'email_otp' }])
    expect(getAvailableCredentialMethods(methods, 'phone')).toEqual([{ id: 'sms' }])
    expect(getAvailableCredentialMethods(methods, 'username')).toEqual([])
  })

  it('allows password only for EMAIL and does not infer available methods from policy toggles', () => {
    const methods = capabilities(true)
    const canonical = { ...policy(methods), emailMagicLinkEnabled: true, socialLoginEnabled: true }
    expect(() => validateFlowMetadata(methods, canonical)).not.toThrow()
    expect(getAvailableCredentialMethods(methods, 'email')).toEqual([{ id: 'password' }, { id: 'email_otp' }])
    expect(getAvailableCredentialMethods(methods, 'phone')).toEqual([{ id: 'sms' }])
    expect(getAvailableCredentialMethods(methods, 'username')).toEqual([])
    expect(methods.idpProviders).toEqual([])
    for (const kind of ['USERNAME', 'PHONE'] as const) {
      const widened: PublicAuthMethodsResponse = {
        ...methods,
        identifierMethods: [
          ...methods.identifierMethods.filter((entry) => entry.kind !== kind),
          { kind, methods: ['PASSWORD'] },
        ],
      }
      expect(() => validateFlowMetadata(widened, canonical)).toThrow()
    }
  })
})
