import { ConnectedAppSessionTransport } from '@axis-iam/vertex'
import { useState } from 'react'
import { IamProvider, SignIn, AuthDialog, useAuthFlow, useServerSession } from '@axis-iam/vertex-react'

const transport = new ConnectedAppSessionTransport({ origin: window.location.origin })

export function ConnectedApp(props: { clientId: string; issuer: string; entry: 'hosted' | 'embedded' | 'dialog' | 'headless' }) {
  const [open, setOpen] = useState(true)
  return <IamProvider sessionMode="server_session" sessionTransport={transport}
    clientId={props.clientId} issuerUri={props.issuer} redirectUri="/signed-in"
    sessionLoginUri="/auth/login" sessionProviderReturnUri={window.location.origin + '/signed-in'}>
    {props.entry === 'dialog' ? <AuthDialog open={open} onOpenChange={setOpen} /> : props.entry === 'headless' ? <Headless /> :
      <SignIn mode={props.entry === 'embedded' ? 'embedded' : 'redirect'} />}
    <BusinessAction />
  </IamProvider>
}

function BusinessAction() {
  const { view } = useServerSession()
  return <button disabled={!view || !('profile' in view)} onClick={async () => {
    if (!view || !('profile' in view)) return
    const response = await fetch('/api/private/action', { method: 'POST', credentials: 'same-origin',
      headers: { 'X-CSRF-Token': view.csrfToken }, cache: 'no-store' })
    if (!response.ok) throw new Error('Application action refused')
  }}>Run application action</button>
}

function Headless() {
  const { state, actions } = useAuthFlow()
  // Render your fields from the typed state and submit through these actions.
  return <div data-auth-step={state.step}>
    {state.error && <p role="alert">{state.error.message}</p>}
    {state.step === 'identifier' && <button onClick={() => actions.continueWithIdentifier({ kind: 'EMAIL', value: 'reader@example.com' })}>Continue with email</button>}
  </div>
}
