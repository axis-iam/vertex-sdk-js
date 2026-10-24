import {
  CookieSessionTransport,
} from '@axis-iam/vertex'
import {
  AccountCenter,
  IamProvider,
  SignIn,
  useAuth,
} from '@axis-iam/vertex-react'

function Screen() {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <AccountCenter open onOpenChange={() => {}} /> : <SignIn mode="embedded" />
}

/** The host serves /console and /login on this origin; no browser token store. */
export function ServerSessionExample({ clientId }: { clientId: string }) {
  return (
    <IamProvider
      issuerUri={window.location.origin}
      clientId={clientId}
      redirectUri={`${window.location.origin}/login`}
      sessionMode="server_session"
      sessionTransport={new CookieSessionTransport({ origin: window.location.origin })}
    >
      <Screen />
    </IamProvider>
  )
}
