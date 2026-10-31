import { vi } from 'vitest'
import type { InvitationJourney, InvitationRegistration, InvitationEnrollment, InvitationEnrollmentBegin } from '@axis-iam/vertex'
export const invitationRef = '20000000-0000-0000-0000-000000000001'
export const invitationApp = '10000000-0000-0000-0000-000000000001'
export const invitationProof = 'c'.repeat(43)
export function invitationView(state: InvitationJourney['state'] = 'CONFIRM_REQUIRED'): InvitationJourney {
  return { ref: invitationRef, kind: 'ORGANIZATION', state, expiresAt: '2090-01-01T00:00:00Z',
    invitationVersion: 5, configVersion: 1,
    subject: { applicationId: invitationApp, applicationName: 'Example', organizationId: invitationRef, organizationName: 'Team' },
    maskedRecipient: 'm***@example.test', role: 'MEMBER', result: state === 'COMMITTED' ? 'JOINED' : 'NONE',
    nextAction: { type: state === 'COMMITTED' ? 'VIEW_RESULT' : 'CONFIRM' } }
}
export function invitationRegistration(state = 'PENDING_VERIFICATION'): InvitationRegistration {
  return { registrationRef: invitationRef, state, expiresAt: '2090-01-01T00:00:00Z',
    nextAction: state === 'COMPLETED' ? 'LOGIN' : 'VERIFY_EMAIL', nextChallengeAt: null }
}
export function invitationEnrollment(state: InvitationEnrollment['state'] = 'AVAILABLE'): InvitationEnrollment {
  return { enrollmentRef: state === 'AVAILABLE' ? null : invitationRef, method: state === 'AVAILABLE' ? null : 'TOTP',
    state, expiresAt: '2090-01-01T00:00:00Z', availableMethods: ['TOTP', 'WEBAUTHN'], reasonCode: null }
}
export function invitationApi() {
  const authentication = { authRef: invitationRef, state: 'AUTHENTICATED', expiresAt: '2090-01-01T00:00:00Z', methods: [], providers: [] }
  return {
    prepareEntry: vi.fn(async () => invitationView('PREVIEW')),
    exchange: vi.fn(async () => invitationView()),
    registrationContext: vi.fn(async () => invitationView('REGISTRATION_REQUIRED')),
    get: vi.fn(async () => invitationView()),
    authenticatedSession: vi.fn(async () => invitationView()),
    continue: vi.fn(async () => invitationView()),
    confirm: vi.fn(async () => invitationView('COMMITTED')),
    cancel: vi.fn(async () => invitationView('CANCELLED')),
    register: vi.fn(async () => invitationRegistration()),
    registration: vi.fn(async () => invitationRegistration()),
    verifyRegistration: vi.fn(async () => invitationRegistration('COMPLETED')),
    resendRegistration: vi.fn(async () => invitationRegistration()),
    cancelRegistration: vi.fn(async () => invitationRegistration('CANCELLED')),
    startAuthentication: vi.fn(async () => authentication),
    cancelAuthentication: vi.fn(async () => ({ ...authentication, state: 'CANCELLED' })),
    authenticate: vi.fn(async () => authentication),
    challenge: vi.fn(async () => ({ authRef: invitationRef, expiresAt: authentication.expiresAt, nextAction: 'AUTHENTICATE' })),
    mfa: vi.fn(async () => authentication),
    enrollment: vi.fn(async () => invitationEnrollment()),
    startEnrollment: vi.fn(async (): Promise<InvitationEnrollmentBegin> => ({ enrollment: invitationEnrollment('PENDING'), delivery: 'AVAILABLE',
      totp: { secret: 'JBSWY3DPEHPK3PXP', qrCodeUri: 'otpauth://totp/Unit?secret=JBSWY3DPEHPK3PXP', issuer: 'Unit' }, webauthn: null })),
    completeEnrollment: vi.fn(async () => invitationEnrollment('COMPLETED')),
    cancelEnrollment: vi.fn(async () => invitationEnrollment('CANCELLED')),
  }
}
