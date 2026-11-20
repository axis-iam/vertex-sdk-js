import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedAppSessionTransport } from '@axis-iam/vertex'
import { IamProvider, SignIn, SignUp, AuthDialog, useAuth, useAuthFlow, useServerSession } from '@axis-iam/vertex-react'
let root, flow, auth, client, successes = 0
const config = {
  sessionMode: 'server_session', clientId: 'connected-web', issuerUri: location.origin,
  redirectUri: location.origin + '/done', sessionLoginUri: '/auth/login', sessionProviderReturnUri: location.origin + '/done',
}
function Probe({ headless }) {
  auth = useAuth()
  client = useServerSession().actions
  return headless ? <Headless /> : <p id="identity">{auth.user?.email ?? 'anonymous'}</p>
}
function Headless() {
  flow = useAuthFlow({ onSignInSuccess: () => successes++ })
  return <p id="step">{flow.state.step}</p>
}
window.bff = {
  mount(entry = 'headless') {
    root?.unmount()
    const app = document.getElementById('app')
    root = createRoot(app)
    flow = undefined; auth = undefined; successes = 0
    root.render(<IamProvider {...config} sessionTransport={new ConnectedAppSessionTransport({ origin: location.origin })}>
      <Probe headless={entry === 'headless'} />
      {entry === 'embedded' ? <SignIn mode="embedded" onSuccess={() => successes++} /> :
        entry === 'signup' ? <SignUp mode="embedded" onSuccess={() => successes++} /> :
        entry === 'dialog' ? <AuthDialog open onOpenChange={() => {}} signInProps={{ onSuccess: () => successes++ }} /> : null}
    </IamProvider>)
  },
  step: () => flow?.state.step,
  error: () => flow?.state.error?.code,
  restore: () => client.restoreSession(),
  businessWrite: async () => {
    await client.restoreSession()
    const view = client.session.getSnapshot()
    return fetch('/business-write', { method: 'POST', credentials: 'same-origin',
      headers: { 'X-CSRF-Token': view.csrfToken } }).then(r => r.status)
  },
  registrationStart: () => client.identity.startRegistration({ identifier: { kind: 'EMAIL', value: 'new@example.test' }, password: 'FixturePass123!' }, crypto.randomUUID()),
  registrationGet: ref => client.identity.getRegistration(ref),
  registrationAction: (ref, action) => client.identity.registrationAction(ref, action, action === 'complete' ? '123456' : undefined),
  successes: () => successes,
  authenticated: () => Boolean(auth?.isAuthenticated),
  identify: () => flow.actions.continueWithIdentifier({ kind: 'EMAIL', value: 'u@example.test' }),
  password: value => flow.actions.submitPassword(value),
  mfa: () => flow.actions.verifyMfa('123456', 'TOTP'),
  magic: async () => { flow.actions.selectMethod('magic_link'); await flow.actions.sendMagicLink() },
  provider: () => flow.actions.signInWithProvider('019b0000-0000-7000-8000-000000000098', { timeoutMs: 5000 }),
  hosted: async () => {
    const transport = new ConnectedAppSessionTransport({ origin: location.origin })
    await transport.request({ action: 'bootstrap' })
    location.assign('/auth/login')
  },
  logout: () => auth.logout(),
  fill(selector, value) {
    const input = document.querySelector(selector)
    if (!input) throw new Error('Missing input')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  },
  submit(selector) {
    document.querySelector(selector).closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  },
}
window.bff.mount()
