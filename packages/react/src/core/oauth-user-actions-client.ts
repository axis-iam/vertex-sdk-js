import { requestJson, requestNoContent } from './http-client'
import type {
  EmailVerificationResponse,
  OIDCConfiguration,
  RequestPasswordResetInput,
  ResetPasswordInput,
  SendEmailVerificationInput,
  VerifyEmailInput,
} from './types'

export interface OAuthUserActionsClientOptions {
  clientId: string
  discover: () => Promise<OIDCConfiguration>
}

export class OAuthUserActionsClient {
  constructor(private readonly options: OAuthUserActionsClientOptions) {}

  async sendEmailVerification(input: SendEmailVerificationInput): Promise<EmailVerificationResponse> {
    const config = await this.options.discover()
    return await requestJson<EmailVerificationResponse>(`${config.issuer}/api/v1/auth/email/verification/send`, {
      method: 'POST',
      json: {
        email: input.email,
        client_id: this.options.clientId,
      },
    })
  }

  async verifyEmail(input: VerifyEmailInput): Promise<EmailVerificationResponse> {
    const config = await this.options.discover()
    return await requestJson<EmailVerificationResponse>(`${config.issuer}/api/v1/auth/email/verification/verify`, {
      method: 'POST',
      json: {
        token: input.token,
      },
    })
  }

  async requestPasswordReset(input: RequestPasswordResetInput): Promise<void> {
    const config = await this.options.discover()
    const body: { email: string; client_id: string; redirect_uri?: string } = {
      email: input.email,
      client_id: this.options.clientId,
    }
    if (input.redirectUri) {
      body.redirect_uri = input.redirectUri
    }

    await requestNoContent(`${config.issuer}/api/v1/auth/password/forgot`, {
      method: 'POST',
      json: body,
    })
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const config = await this.options.discover()
    await requestNoContent(`${config.issuer}/api/v1/auth/password/reset`, {
      method: 'POST',
      json: {
        token: input.token,
        newPassword: input.newPassword,
      },
    })
  }
}
