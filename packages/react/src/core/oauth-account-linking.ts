import { request, requestNoContent } from './http-client'
import { IamApiError } from './types'
import type {
  AccountLinkAuthorizeOptions,
  AccountLinkAuthorizeResult,
  AccountLinkCallbackResult,
  AccountLinkTicketExchangeInput,
  AccountLoginMethod,
  LinkableIdentityProvider,
  OIDCConfiguration,
} from './types'

export interface OAuthAccountLinkingClientOptions {
  discover: () => Promise<OIDCConfiguration>
  getAccessToken: () => string | null
  resolveRedirectUri: (redirectUri?: string) => string
}

export class OAuthAccountLinkingClient {
  private readonly discover: () => Promise<OIDCConfiguration>
  private readonly getAccessToken: () => string | null
  private readonly resolveRedirectUri: (redirectUri?: string) => string

  constructor(options: OAuthAccountLinkingClientOptions) {
    this.discover = options.discover
    this.getAccessToken = options.getAccessToken
    this.resolveRedirectUri = options.resolveRedirectUri
  }

  async listAccountLoginMethods(): Promise<AccountLoginMethod[]> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    const res = await request(`${config.issuer}/api/v1/auth/me/login-methods`, {
      bearerToken: token,
    })
    return await readJson<AccountLoginMethod[]>(res)
  }

  async listLinkableIdentityProviders(): Promise<LinkableIdentityProvider[]> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    const res = await request(`${config.issuer}/api/v1/auth/me/linkable-identity-providers`, {
      bearerToken: token,
    })
    return await readJson<LinkableIdentityProvider[]>(res)
  }

  async startAccountLink(
    idpId: string,
    options: AccountLinkAuthorizeOptions = {},
  ): Promise<AccountLinkAuthorizeResult> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    const body: { redirectUri: string; state?: string } = {
      redirectUri: this.resolveRedirectUri(options.redirectUri ?? '/account-link/callback'),
    }
    if (options.state) {
      body.state = options.state
    }

    const res = await request(
      `${config.issuer}/api/v1/auth/me/identity-providers/${encodeURIComponent(idpId)}/link/authorize`,
      {
        method: 'POST',
        json: body,
        bearerToken: token,
      },
    )
    return await readJson<AccountLinkAuthorizeResult>(res)
  }

  async exchangeAccountLinkTicket(input: AccountLinkTicketExchangeInput): Promise<AccountLinkCallbackResult> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    const res = await request(
      `${config.issuer}/api/v1/auth/me/identity-providers/link-ticket/exchange`,
      {
        method: 'POST',
        json: {
          linkTicket: input.linkTicket,
          state: input.state,
        },
        bearerToken: token,
      },
    )
    return await readJson<AccountLinkCallbackResult>(res)
  }

  async unlinkAccountLoginMethod(methodId: string): Promise<void> {
    const token = this.requireCurrentAccessToken()
    const config = await this.discover()
    await requestNoContent(`${config.issuer}/api/v1/auth/me/login-methods/${encodeURIComponent(methodId)}`, {
      method: 'DELETE',
      bearerToken: token,
    })
  }

  private requireCurrentAccessToken(): string {
    const token = this.getAccessToken()
    if (!token) {
      throw new IamApiError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      })
    }
    return token
  }
}

async function readJson<T>(res: Response): Promise<T> {
  return await res.json() as T
}
