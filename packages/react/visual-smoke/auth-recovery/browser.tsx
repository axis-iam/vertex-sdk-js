import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CookieSessionTransport } from '@axis-iam/vertex'
import { IamProvider, SignIn, SignUp, AuthDialog, SignInButton, useAuth, useAuthFlow } from '@axis-iam/vertex-react'
import { CustomAuth } from './CustomAuth'

// Public fixture configuration is inline, so closing a callback cannot abort a top-level await.
const config = JSON.parse(document.getElementById('auth-recovery-config')!.textContent!)
const id = config.id
let auth, flow, root
let successes = 0
let errors: string[] = []
const success = () => { successes++ }
const failure = (error: { code?: string; name: string }) => { errors.push(error.code ?? error.name) }
function Probe() {
  auth = useAuth()
  return <output data-user>{auth.user?.id ?? 'anonymous'}</output>
}
function Headless() {
  flow = useAuthFlow({ onSignInSuccess: success, onError: failure })
  return <section>
    <p data-step>{flow.state.step}</p>
    <button onClick={() => void flow.actions.signInWithProvider('provider', { timeoutMs: config.timeoutMs }).catch(() => {})}>Headless provider</button>
    <button onClick={() => void flow.actions.reset().catch(() => {})}>Reset flow</button>
  </section>
}
function Dialog() {
  const [open, setOpen] = useState(true)
  return <AuthDialog open={open} onOpenChange={setOpen}
    signInProps={{ providerNavigation: 'popup', onSuccess: success, onError: failure }}>
    <SignInButton>Open sign-in</SignInButton>
  </AuthDialog>
}
function Hosted() {
  const context = useAuth()
  useEffect(() => {
    if (!location.search) return
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void context.handleRedirectCallback().catch(failure)
    })
    return () => { cancelled = true }
  }, [context.handleRedirectCallback])
  return <SignIn />
}
const iam = {
  issuerUri: config.issuer,
  clientId: config.clientId,
  redirectUri: config.redirectUri,
  scopes: ['profile', 'email'],
  colorScheme: config.theme ?? 'light',
  locale: config.locale ?? 'en',
  ...(config.mode === 'server_session' ? {
    sessionMode: 'server_session' as const,
    sessionLoginUri: `${location.origin}/app/${id}`,
    sessionProviderReturnUri: config.redirectUri,
    sessionTransport: new CookieSessionTransport({ origin: location.origin, basePath: `/bff/${id}` }),
  } : {}),
}
const mount = () => {
  root = createRoot(document.getElementById('app')!)
  root.render(<StrictMode><IamProvider {...iam}>
    <Probe />
    {config.entry === 'dialog' ? <Dialog />
      : config.entry === 'custom' ? <CustomAuth onSignInSuccess={success} onError={failure} providerNavigation={config.navigation} />
      : config.entry === 'headless' ? <Headless />
      : config.entry === 'hosted' ? <Hosted />
      : config.entry === 'signup' ? <SignUp mode="embedded" onSuccess={success} onError={failure} />
      : <SignIn mode="embedded" providerNavigation={config.navigation ?? 'popup'} onSuccess={success} onError={failure} />}
  </IamProvider></StrictMode>)
}
mount()
window.recovery = {
  snapshot() {
    return {
      loaded: auth?.isLoaded, authenticated: auth?.isAuthenticated, user: auth?.user?.id ?? null,
      clientId: auth?.user?.authenticationContext.clientId ?? null,
      step: flow?.state.step, pending: flow?.state.pending,
      successes, errors, tokenPresent: config.mode === 'server_session' ? false : Boolean(auth?.getAccessToken()),
      persistentTokens: ['axis_iam_session', 'axis_iam_tokens'].some(key => localStorage.getItem(key) || sessionStorage.getItem(key)),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  },
  async action(name, ...args) {
    try { await flow.actions[name](...args); return { ok: true } }
    catch (error) { return { ok: false, code: error.code ?? error.name } }
  },
  async duplicate(url) {
    const one = flow.actions.resumeProviderCallback(url)
    const two = flow.actions.resumeProviderCallback(url)
    const same = one === two
    await Promise.all([one, two])
    return { same }
  },
  start(name, ...args) { void flow.actions[name](...args).catch(() => {}) },
  unmount() { root.unmount(); flow = null },
  async logout() { await auth.logout({ redirect: false }) },
}
