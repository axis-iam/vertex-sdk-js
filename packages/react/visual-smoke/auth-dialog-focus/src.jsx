import React, { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthDialog, IamProvider, SignInButton } from '@axis-iam/vertex-react'

const mode = new URLSearchParams(location.search).get('mode') ?? 'external'

globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input)
  if (url.includes('openid-configuration')) return json({ issuer: location.origin, authorization_endpoint: `${location.origin}/authorize`, token_endpoint: `${location.origin}/oauth`, userinfo_endpoint: `${location.origin}/userinfo`, jwks_uri: `${location.origin}/jwks` })
  if (url.includes('/auth-methods')) return json({ identifierRestrictions: { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }, identifierMethods: [{ kind: 'EMAIL', methods: ['PASSWORD'] }], defaultIdentifierKind: 'EMAIL', defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' }, allowedSignupIdentifierKinds: ['EMAIL'], allowedPasswordIdentifierKinds: ['EMAIL'], clientId: 'focus-consumer', passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: false, smsOtpEnabled: false, socialLoginEnabled: false, signupEnabled: false, selfRegistrationEnabled: false, idpAutoProvisioningEnabled: false, loginInitiationUri: null, postVerificationRedirectUri: null, methods: [{ type: 'PASSWORD', enabled: true, configured: true, availableForLogin: true, availableForSignup: false, unavailableReason: null }], idpProviders: [], resend: { emailVerificationCooldownSeconds: 60 } })
  if (url.includes('/auth-policy')) return json({ identifierRestrictions: { signup: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } }, login: { email: { restricted: false }, phone: { restricted: false, allowedRegions: null } } }, defaultLogin: { identifierKind: 'EMAIL', method: 'PASSWORD' }, allowedSignupIdentifierKinds: ['EMAIL'], allowedPasswordIdentifierKinds: ['EMAIL'], passwordLoginEnabled: true, emailMagicLinkEnabled: false, emailOtpEnabled: false, smsOtpEnabled: false, socialLoginEnabled: false, smsAutoProvisioningEnabled: false, minPasswordLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireSpecialChar: false, breachedPasswordCheck: false, totpEnabled: false, webauthnEnabled: false, mfaEnforcement: 'OPTIONAL', stepUpEnabled: false, stepUpTriggers: [], deviceTrustDays: 0, maxTrustedDevices: 0, maxLoginAttempts: 5, lockoutDurationMinutes: 15, progressiveLockout: false, idpAutoProvisioningEnabled: false, signupMode: 'OPEN', allowedRegistrationGrantTypes: [] })
  if (url.includes('/branding')) return json({}, 404)
  if (url.includes('/permissions')) return json({ permissions: [] })
  return json({ message: 'not found' }, 404)
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function App() {
  const [open, setOpen] = useState(false)
  const [connected, setConnected] = useState(true)
  const child = mode === 'child'
  const opener = child
    ? <SignInButton id="sdk-opener">Open with SDK trigger</SignInButton>
    : connected && <button id="external-opener" type="button" onClick={() => setOpen(true)}>Open authentication</button>

  return <IamProvider clientId="focus-consumer" issuerUri={location.origin} redirectUri="/callback" tokenStorage="memory">
    <main>
      {mode === 'disconnected' && <button id="disconnect-opener" type="button" onClick={() => setConnected(false)}>Disconnect opener</button>}
      {child
        ? <AuthDialog open={open} onOpenChange={setOpen} allowSignUp={false}>{opener}</AuthDialog>
        : <>{opener}<AuthDialog open={open} onOpenChange={setOpen} allowSignUp={false} /></>}
    </main>
  </IamProvider>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
