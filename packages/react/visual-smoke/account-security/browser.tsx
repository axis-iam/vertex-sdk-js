import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  AccountCenter, AccountSecurityDialog, AccountSecurityPanel, IamProvider,
  OAuthClient, useAccountSecurity, useAuth,
} from '@axis-iam/vertex-react'
import { CookieSessionTransport } from '@axis-iam/vertex'
import { HeadlessSecurity } from './AccountSecurity'

let root, model, auth, theme, locale
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(test, description) {
  for (let i = 0; i < 200; i++) { if (test()) return; await wait(25) }
  throw new Error(description)
}
function Probe() { model = useAccountSecurity(); auth = useAuth(); return null }
function Surface({ config, surface }) {
  const [scheme, setScheme] = useState('light'), [language, setLanguage] = useState('en')
  const [open, setOpen] = useState(false)
  theme = setScheme; locale = setLanguage
  return <IamProvider {...config} colorScheme={scheme} locale={language}>
    <Probe />
    <div className="consumer-controls"><button id="consumer-open" onClick={() => setOpen(true)}>Open account security</button><p>Isolated protocol fixture. Not a real account.</p></div>
    {surface === 'center' || surface === 'methods' ? <AccountCenter open={open} onOpenChange={setOpen} identityRedirectUri={config.redirectUri} initialSection={surface === 'methods' ? 'methods' : 'security'} /> :
      surface === 'dialog' ? <AccountSecurityDialog open={open} onOpenChange={setOpen} /> :
      surface === 'custom' ? <HeadlessSecurity /> : <AccountSecurityPanel />}
  </IamProvider>
}
window.accountSecurityHarness = {
  async mount(mode = 'oauth_tokens', surface = 'panel') {
    root?.unmount(); model = undefined; auth = undefined
    document.querySelector('#app')?.remove()
    const node = document.createElement('main'); node.id = 'app'; document.body.append(node)
    const config = { issuerUri: location.origin, clientId: 'security-fixture-client', redirectUri: `${location.origin}/callback`, scopes: ['profile'], tokenStorage: 'sessionStorage' }
    if (mode === 'oauth_tokens') {
      const client = new OAuthClient(config)
      const authorization = new URL(await client.startAuthorizationFlow())
      await client.handleCallback('fixture-code', authorization.searchParams.get('state'))
      client.dispose()
    } else {
      delete config.tokenStorage
      Object.assign(config, { sessionMode: 'server_session', sessionTransport: new CookieSessionTransport({ origin: location.origin }), sessionLoginUri: '/console/session/login', sessionProviderReturnUri: '/console/session/callback' })
    }
    root = createRoot(node); root.render(<Surface config={config} surface={surface} />)
    await until(() => auth?.isLoaded && auth.isAuthenticated && model?.capabilities, 'public provider initialization')
    return true
  },
  theme(value) { theme(value) }, locale(value) { locale(value) },
  state() {
    const s = model.state
    return { ref: s.operation?.ref, state: s.operation?.state, type: s.operation?.type, pending: s.pending, uncertain: s.uncertain, hasMaterial: Boolean(s.material), hasCodes: Boolean(s.recoveryCodes), materialUnavailable: s.materialUnavailable, recoveryCodesUnavailable: s.recoveryCodesUnavailable, authenticated: auth.isAuthenticated }
  },
  async action(name, ...args) { await model.actions[name](...args); return this.state() },
  unmount() { root?.unmount(); root = null },
}
