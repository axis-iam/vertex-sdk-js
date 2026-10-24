import React, { Component, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { IamConfigurationError, IamProvider, SignIn, useAuth } from '@axis-iam/vertex-react'

const mode = new URLSearchParams(location.search).get('mode') ?? 'memory'
const sessionKey = 'axis_iam_session'
const sensitiveMarker = 'SENSITIVE_TOKEN_MARKER'
const callbackState = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc'
const original = {
  getItem: Storage.prototype.getItem,
  setItem: Storage.prototype.setItem,
  removeItem: Storage.prototype.removeItem,
}
const storageCalls = { get: 0, set: 0, remove: 0 }
window.__storageCalls = storageCalls
window.__authTransitions = []

if (mode === 'valid' || mode === 'remove') seedValidSession()
if (mode === 'corrupt') sessionStorage.setItem(sessionKey, `{"token":"${sensitiveMarker}"`)
if (mode === 'write') {
  sessionStorage.setItem('axis_iam_pending_authorization', JSON.stringify({
    version: 1, issuer: location.origin, clientId: 'packed-client',
    redirectUri: new URL('/callback', location.origin).href, entryMode: 'HOSTED',
    flowOwner: callbackState, state: callbackState, verifier: callbackState,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  }))
}

if (mode === 'memory') denyAllStorage()
if (mode === 'read') {
  Storage.prototype.getItem = function (key) {
    storageCalls.get++
    if (key === sessionKey) throw new DOMException(`read denied ${sensitiveMarker}`, 'SecurityError')
    return original.getItem.call(this, key)
  }
}

class Boundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch() {}

  render() {
    if (this.state.error) {
      window.__result = describeError(this.state.error)
      return <output id="result">storage-error</output>
    }
    return this.props.children
  }
}

function Probe() {
  const auth = useAuth()
  useEffect(() => {
    const observation = {
      authenticated: auth.isAuthenticated,
      accessTokenPresent: auth.getAccessToken() !== null,
      loaded: auth.isLoaded,
    }
    window.__authObservation = observation
    const transitions = window.__authTransitions
    if (transitions.at(-1) !== observation.authenticated) transitions.push(observation.authenticated)
  }, [auth.getAccessToken, auth.isAuthenticated, auth.isLoaded])

  useEffect(() => {
    window.__clearMemory = async () => {
      await auth.logout({ redirect: false })
    }
    window.__runScenario = async () => {
      try {
        if (mode === 'write') {
          Storage.prototype.setItem = function (key, value) {
            storageCalls.set++
            if (key === sessionKey) throw new DOMException(`write denied ${sensitiveMarker}`, 'SecurityError')
            return original.setItem.call(this, key, value)
          }
          await auth.handleCallback('authorization-code', callbackState)
        } else if (mode === 'remove') {
          Storage.prototype.removeItem = function (key) {
            storageCalls.remove++
            if (key === sessionKey) throw new DOMException(`remove denied ${sensitiveMarker}`, 'SecurityError')
            return original.removeItem.call(this, key)
          }
          await auth.logout({ redirect: false })
        }
        window.__result = {
          ok: true,
          authenticated: auth.isAuthenticated,
          storageCalls,
        }
      } catch (error) {
        window.__result = {
          ...describeError(error),
          canonicalPresent: original.getItem.call(sessionStorage, sessionKey) !== null,
          storageCalls,
        }
      }
    }
    if (mode === 'valid') {
      window.__result = {
        ok: true,
        authenticated: auth.isAuthenticated,
        loaded: auth.isLoaded,
        storageCalls,
      }
    }
  }, [auth])
  return <output id="result">ready</output>
}

function describeError(error) {
  return {
    ok: false,
    errorName: error?.name,
    errorMessage: error?.message,
    configurationError: error instanceof IamConfigurationError,
    storageCalls,
  }
}

function denyAllStorage() {
  Storage.prototype.getItem = function () {
    storageCalls.get++
    throw new DOMException(`read denied ${sensitiveMarker}`, 'SecurityError')
  }
  Storage.prototype.setItem = function () {
    storageCalls.set++
    throw new DOMException(`write denied ${sensitiveMarker}`, 'SecurityError')
  }
  Storage.prototype.removeItem = function () {
    storageCalls.remove++
    throw new DOMException(`remove denied ${sensitiveMarker}`, 'SecurityError')
  }
}

function seedValidSession() {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = jwt({ sub: 'packed-user', exp: now + 3600, roles: ['stale-role'] })
  sessionStorage.setItem(sessionKey, JSON.stringify({
    version: 6,
    expiresAt: Date.now()+3600_000,
    owner:null,
    tokens: { access_token: accessToken, id_token: 'packed-id-token', token_type: 'Bearer', expires_in: 3600 },
    authenticationProvenance: 'OAUTH_AUTHORIZATION_CODE',
    refreshProvenance: null,
  }))
}

function jwt(payload) {
  const encode = value => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`
}

let pendingAuthentication
globalThis.fetch = async (input,init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.endsWith('/.well-known/openid-configuration')) return json({
    issuer: location.origin,
    authorization_endpoint: `${location.origin}/authorize`,
    token_endpoint: `${location.origin}/token`,
    userinfo_endpoint: `${location.origin}/userinfo`,
    jwks_uri: `${location.origin}/jwks`,
    end_session_endpoint: `${location.origin}/logout`,
  })
  if (url.endsWith('/token')) return json({
    access_token: jwt({ sub: mode==='memory'?'memory-user':'packed-user', exp: Math.floor(Date.now() / 1000) + 3600 }),
    refresh_token: sensitiveMarker,
    token_type: 'Bearer',
    expires_in: 3600,
  })
  if (url.endsWith('/api/v1/apps/packed-client/auth-methods')) return json({
    clientId: 'packed-client',
    passwordLoginEnabled: true,
    emailMagicLinkEnabled: false,
    emailOtpEnabled: false,
    smsOtpEnabled: false,
    socialLoginEnabled: false,
    signupEnabled: false,
    selfRegistrationEnabled: false,
    idpAutoProvisioningEnabled: false,
    loginInitiationUri: null,
    postVerificationRedirectUri: null,
    methods: [{
      type: 'PASSWORD',
      enabled: true,
      configured: true,
      availableForLogin: true,
      availableForSignup: false,
      unavailableReason: null,
    }],
    idpProviders: [],
    resend: { emailVerificationCooldownSeconds: 60 },
  })
  if(url.endsWith('/auth/transactions')){
    pendingAuthentication=JSON.parse(init.body)
    pendingAuthentication.expiresAt=new Date(Date.now()+600000).toISOString()
    return json({transactionId:'storage-transaction',controlSecret:'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',expiresAt:pendingAuthentication.expiresAt,nextAction:'authenticate'})
  }
  if(url.endsWith('/authenticate'))return json({transactionId:'storage-transaction',expiresAt:pendingAuthentication.expiresAt,state:'AUTHENTICATED',nextAction:'complete'})
  if(url.endsWith('/complete'))return json({kind:'authorization_code',code:'storage-code',state:pendingAuthentication.state,expiresIn:120})
  if (url.endsWith('/api/v1/auth/logout')) return new Response(null, { status: 204 })
  if (url.endsWith('/api/v1/auth/me')) return json({ id: mode==='memory'?'memory-user':'packed-user', email: null, username: null, status:'ACTIVE', emailVerified:true, metadata:{}, authenticationContext:{subjectType:'USER',applicationId:'packed-app',clientId:'packed-client',sessionId:'packed-session',workspaceId:null,workspaceSelectionRequired:true,organizationId:null,organizationSlug:null,organizationRole:null,authTime:null,authenticationMethods:[],assuranceLevel:null,impersonation:null} })
  if (url.endsWith('/api/v1/auth/me/permissions')) return json({ applicationId:'packed-app',organizationId:null,roles: ['member'], permissions: ['orders:read'] })
  return json({ message: 'not found' }, 404)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

createRoot(document.getElementById('root')).render(
  <Boundary>
    <IamProvider clientId="packed-client" issuerUri={location.origin} redirectUri="/callback" tokenStorage={mode === 'memory' ? 'memory' : 'sessionStorage'}>
      <Probe />
      {mode === 'memory' && <SignIn mode="embedded" onSuccess={() => { window.__memorySignInCompleted = true }} />}
    </IamProvider>
  </Boundary>,
)
