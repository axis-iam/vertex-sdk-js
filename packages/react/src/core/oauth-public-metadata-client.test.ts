import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthPublicMetadataClient } from './oauth-public-metadata-client'
import type {
  IdentityProviderOption,
  IamConfig,
  OIDCConfiguration,
  PublicAuthMethodsResponse,
  PublicAuthPolicyResponse,
} from './types'

const ISSUER = 'https://auth.example.com'

const oidcConfig: OIDCConfiguration = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  userinfo_endpoint: `${ISSUER}/userinfo`,
  jwks_uri: `${ISSUER}/oauth2/jwks`,
  end_session_endpoint: `${ISSUER}/logout`,
}

const config: IamConfig = {
  clientId: 'my-app',
  issuerUri: ISSUER,
  redirectUri: '/callback',
  postLogoutRedirectUri: 'https://app.example.com/signed-out',
}

const googleProvider: IdentityProviderOption = {
  id: 'idp-google',
  applicationId: 'app-1',
  providerType: 'GOOGLE',
  name: 'google',
  displayName: 'Google',
  enabled: true,
  protocol: 'OIDC',
  authorizationUrl: `${ISSUER}/api/v1/apps/my-app/identity-providers/idp-google/oidc/authorize`,
  samlAcsUrl: null,
  supportsBrokeredToken: true,
}

const publicAuthPolicy: PublicAuthPolicyResponse = {
  passwordLoginEnabled: true,
  passwordlessEnabled: true,
  minPasswordLength: 8,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
  breachedPasswordCheck: false,
  totpEnabled: true,
  webauthnEnabled: false,
  mfaEnforcement: 'OPTIONAL',
  stepUpEnabled: true,
  stepUpTriggers: ['MFA_CHANGE'],
  deviceTrustDays: 30,
  maxTrustedDevices: 5,
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  progressiveLockout: false,
  idpAutoProvisioningEnabled: false,
  signupMode: 'OPEN',
  allowedRegistrationGrantTypes: ['EMAIL_LINK', 'ACCESS_CODE', 'ORG_INVITATION'],
}

const publicAuthMethods: PublicAuthMethodsResponse = {
  clientId: 'my-app',
  passwordLoginEnabled: true,
  emailMagicLinkEnabled: true,
  emailOtpEnabled: false,
  smsOtpEnabled: false,
  socialLoginEnabled: true,
  signupEnabled: true,
  selfRegistrationEnabled: true,
  idpAutoProvisioningEnabled: false,
  loginInitiationUri: 'https://app.example.com/login',
  postVerificationRedirectUri: 'https://app.example.com/verified',
  identifierMethods: [],
  defaultIdentifierKind: null,
  methods: [],
  idpProviders: [],
  resend: {
    emailVerificationCooldownSeconds: 45,
  },
}

describe('oauth public metadata client', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let client: OAuthPublicMetadataClient

  beforeEach(() => {
    fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    client = new OAuthPublicMetadataClient(config)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and caches OIDC discovery', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => oidcConfig,
    })

    await expect(client.discover()).resolves.toEqual(oidcConfig)
    await expect(client.discover()).resolves.toEqual(oidcConfig)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${ISSUER}/.well-known/openid-configuration`, expect.objectContaining({
      method: 'GET',
      headers: {},
    }))
  })

  it('normalizes identity provider list response wrappers', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => oidcConfig,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ providers: [googleProvider] }),
      })

    await expect(client.listIdentityProviders()).resolves.toEqual([googleProvider])
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/identity-providers`)
  })

  it('does not cache a failed public auth policy request', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => oidcConfig,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ message: 'temporarily unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => publicAuthPolicy,
      })

    await expect(client.getPublicAuthPolicy()).rejects.toThrow('temporarily unavailable')
    await expect(client.getPublicAuthPolicy()).resolves.toEqual(publicAuthPolicy)
  })

  it('builds app continuation from public auth methods and local logout config', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => oidcConfig,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => publicAuthMethods,
      })

    await expect(client.getAppContinuation()).resolves.toEqual({
      loginInitiationUri: 'https://app.example.com/login',
      postVerificationRedirectUri: 'https://app.example.com/verified',
      postLogoutRedirectUri: 'https://app.example.com/signed-out',
    })
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${ISSUER}/api/v1/apps/my-app/auth-methods`)
  })
})
