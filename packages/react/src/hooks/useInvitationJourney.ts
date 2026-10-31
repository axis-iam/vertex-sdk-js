import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { InvitationJourneyStore } from '../core/invitation-journey-store'
import { useIamContext } from '../provider/IamProvider'
import { InvitationLoginWindow } from '../core/invitation-login-window'

export interface UseInvitationJourneyOptions { continuation?: string; ref?: string }
export function useInvitationJourney(options: UseInvitationJourneyOptions) {
  const { client, isLoaded, isAuthenticated, user, logout } = useIamContext()
  const owner = user ? JSON.stringify([user.authenticationContext.applicationId, user.authenticationContext.clientId, user.id]) : null
  const store = useMemo(() => new InvitationJourneyStore(client.invitations, options),
    [client, options.continuation, options.ref])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const loginWindow = useMemo(() => new InvitationLoginWindow(client), [client])
  useEffect(() => () => loginWindow.close(), [loginWindow])
  useEffect(() => {
    if (!isLoaded) return
    store.bindOwner(owner)
    if (snapshot.phase === 'loading') return
    const work = snapshot.phase !== 'idle' ? null : store.hasRef() && !snapshot.entryPending ? store.recover() : isAuthenticated && store.hasContinuation() ? store.open('authenticated') : null
    // The store exposes the exact error state; effects never create an unhandled rejection.
    void work?.catch(() => {})
  }, [store, isLoaded, isAuthenticated, owner, snapshot.phase, snapshot.entryPending])
  return {
    ...snapshot, isLoaded, isAuthenticated, canSwitchAccount: store.canSwitchAccount(), canRetryPreparation: store.canRetryPreparation(),
    retryPreparation: useCallback(() => store.retryPreparation(), [store]),
    switchAccount: useCallback(() => store.switchAccount(() => logout({ redirect: false })), [store, logout]),
    beginRegistration: useCallback(() => store.open('registration'), [store]),
    startHostedLogin: useCallback((locale?: string) => store.login(() => loginWindow.start(locale)), [store, loginWindow]),
    completeHostedLogin: useCallback(() => store.login(() => loginWindow.complete()), [store, loginWindow]),
    continueJourney: useCallback(() => store.continue(), [store]),
    confirm: useCallback(() => store.confirm(), [store]),
    cancel: useCallback(() => store.cancel(), [store]),
    recover: useCallback(() => store.recover(), [store]),
    useAuthenticatedSession: useCallback(() => store.authenticatedSession(), [store]),
    register: useCallback((input: Parameters<InvitationJourneyStore['register']>[0]) => store.register(input), [store]),
    recoverRegistration: useCallback(() => store.recoverRegistration(), [store]),
    verifyRegistration: useCallback((code: string) => store.verifyRegistration(code), [store]),
    resendRegistration: useCallback(() => store.resendRegistration(), [store]),
    cancelRegistration: useCallback(() => store.cancelRegistration(), [store]),
    startAuthentication: useCallback(() => store.startAuthentication(), [store]),
    authenticate: useCallback((input: Parameters<InvitationJourneyStore['authenticate']>[0]) => store.authenticate(input), [store]),
    challenge: useCallback((method: Parameters<InvitationJourneyStore['challenge']>[0], identifier: Parameters<InvitationJourneyStore['challenge']>[1]) => store.challenge(method, identifier), [store]),
    cancelAuthentication: useCallback(() => store.cancelAuthentication(), [store]),
    verifyMfa: useCallback((method: Parameters<InvitationJourneyStore['mfa']>[0], code: string) => store.mfa(method, code), [store]),
    recoverEnrollment: useCallback(() => store.recoverEnrollment(), [store]),
    startEnrollment: useCallback((method: Parameters<InvitationJourneyStore['startEnrollment']>[0]) => store.startEnrollment(method), [store]),
    completeEnrollment: useCallback((input: Parameters<InvitationJourneyStore['completeEnrollment']>[0]) => store.completeEnrollment(input), [store]),
    cancelEnrollment: useCallback(() => store.cancelEnrollment(), [store]),
  }
}
