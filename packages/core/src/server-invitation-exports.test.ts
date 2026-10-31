import { describe, expect, it } from 'vitest'
import { ConfidentialInvitationClient, InvitationError } from './server.js'

describe('server invitation exports', () => {
  it('exports the error constructor thrown by the confidential client', () => {
    expect(() => new ConfidentialInvitationClient({
      issuer: 'https://issuer.example.test',
      clientId: 'confidential-client',
      clientSecret: '',
      getAccessToken: () => null,
    })).toThrow(InvitationError)
  })
})
