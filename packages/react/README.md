# @axis-iam/vertex-react

React components, providers and hooks for Axis Vertex. React and React DOM are peer dependencies. Server rendering
helpers are available from `@axis-iam/vertex-react/server`.

Install the first beta with `npm install @axis-iam/vertex-react@beta`.

## Authentication entries

Wrap each entry in `IamProvider` with the Application Client's `issuerUri`, `clientId` and registered `redirectUri`. Browser tokens stay in memory unless the host explicitly chooses supported persistence. Direct Auth is an explicit integration choice; no entry falls back from Hosted to Direct Auth.

| Entry | Usage | Completion |
| --- | --- | --- |
| Hosted | `<SignIn />`, or `useAuth().login()` | Authorization Code + S256 PKCE; call `handleRedirectCallback()` on the configured callback page |
| Embedded | `<SignIn mode="embedded" />`, `<SignUp mode="embedded" />` | Shared Direct Auth flow, with discovered methods and policy |
| Dialog | `<AuthDialog open={open} onOpenChange={setOpen}>…</AuthDialog>` | One active Embedded form by default; `mode="redirect"` launches Hosted |
| Custom | `useAuthFlow(options)` | Public state/actions; the host renders its own UI |

Hosted callback handling validates state, consumes the saved PKCE verifier and scrubs callback parameters. Treat the callback result/error explicitly. Do not store authorization codes, proofs, passwords or tokens in app URLs, logs or analytics. Use `config.redirectUri` to configure navigation; `SignIn` does not expose a `redirectUrl` prop. `onSuccess` is an explicit completion callback, not a navigation promise.

Dialog has a single title and a small localized intent switch when registration policy permits it. Switching intent, closing, Escape, backdrop, or unmount cancels the old attempt and discards the prior form. Reopening returns to `initialView`. Desktop and mobile framing, focus trapping/return, locale, Appearance and light/dark/system themes are inherited from the provider. It does not preserve hidden forms.

### Public Direct Auth flow

```tsx
import { useAuthFlow } from '@axis-iam/vertex-react'

function AppOwnedSignIn() {
  const { state, actions } = useAuthFlow({
    onSignInSuccess: user => showAccount(user),
    onSignUpSuccess: profile => showVerificationInstructions(profile),
    onError: error => reportSafeErrorCode(error.name),
  })
  // Render according to state.step. These actions are called from host-owned forms:
  // actions.continueWithIdentifier(emailOrPhone)
  // await actions.submitPassword(password)
  // if state.step === 'mfa': await actions.verifyMfa(authenticatorCode)
  return <p role="status">{state.step}</p>
}
```

The complete [CustomAuth example](https://github.com/axis-iam/vertex-sdk-js/blob/develop/packages/react/examples/CustomAuth.tsx) uses only public package imports. The package consumer runner compiles and renders that exact example from packed core/react tarballs.

`useAuthFlow(options?: UseAuthFlowOptions)` returns `{ state, actions }`. Options are `initialIntent: 'sign-in' | 'sign-up'`, `registrationGrant`, `onSignInSuccess`, `onSignUpSuccess` and `onError`. Exported contracts include `UseAuthFlowResult`, `AuthFlowState`, `AuthFlowActions`, `AuthFlowIntent`, `AuthCredentialMethod`, `AuthFlowStateError` and `SignUpUserInfo`.

State steps are `loading`, `unavailable`, `identifier`, `method`, `mfa`, `sign-up`, `verification`, and `success`. Narrow on `step` before reading branch fields. Common readonly fields expose capabilities, resolved password/registration policy, intent-filtered providers, `pending`, typed `error`, `retryAfterSeconds`, verification email and `verificationResendDeadline`. State never contains passwords, OTP values, registration secrets or the private MFA challenge proof. Profile/roles metadata is not an authorization source.

| Actions | Contract |
| --- | --- |
| `setIntent`, `continueWithIdentifier`, `selectMethod`, `back`, `cancel`, `reset` | Synchronous; invalid state/input throws `AuthFlowStateError`. Switching/back/reset cancels previous work. |
| `submitPassword`, `sendCode`, `verifyCode`, `sendMagicLink`, `completeMagicLink`, `verifyMfa` | Async Direct Auth actions. `completeMagicLink(token)` consumes the existing magic-link verification producer; the host removes the proof from its callback URL. |
| `signUp({email, password, registrationGrant?})` | Returns a profile result through state/callback. It does **not** authenticate. Password constraints come from policy. Host UI owns confirmation matching. |
| `resendVerification()` | Available only for pending email verification; obeys the discovered verification resend interval. |
| `startProvider(providerId)` | Returns a validated HTTP(S) authorization URL using existing Authorization Code/S256 PKCE. The host owns current-attempt navigation. |

Async actions reject typed `IamApiError`, `IamNetworkError`, `IamConfigurationError` or `AuthFlowStateError`, record the failure in state and call `onError` once. The same pending action/input shares one promise; a conflicting action rejects without another request. There is no implicit retry. A canceled or replaced attempt rejects `SessionInvalidatedError` and cannot write tokens/state, emit callbacks or navigate. Hosts should consume that cancellation without displaying an authentication failure. Guard host-owned promise `then`/`finally` work by mount and attempt ownership; clear secrets before leaving the form.

Password, email OTP, SMS, magic link and provider controls are available only when discovery reports readiness for the current intent. Registration requires both capability and policy approval. `INVITE_REQUIRED` requires an accepted explicit `EMAIL_LINK`, `ACCESS_CODE` or `ORG_INVITATION` proof. Supply the proof either in options or in `signUp`, never both. Provider signup filters `availableForSignup`; `ORG_INVITATION` is rejected for Hosted/provider flows rather than reinterpreted. No production SMS or external provider credentials are supplied by the SDK.

Direct password login can return the backend TOTP challenge. Embedded, Dialog and Custom retain its proof privately and continue through `/api/v1/auth/mfa/verify` with camelCase `{mfaToken, code}`. Wrong, expired and consumed challenges reject without authenticating. Hosted currently has no MFA pipeline/continuation producer; this SDK does not claim Hosted MFA parity or add TOTP enrollment/account management.

Email-verification resend timing comes from `auth-methods.resend.emailVerificationCooldownSeconds`. OTP and magic-link send success use a separate local 60-second advisory cooldown; it is not a server-configured interval. A typed 429 `Retry-After` is an independent server retry restriction.

### Reproducible auth-entry consumer

Run `node packages/react/visual-smoke/run-auth-entries.mjs --fixtures-only` for packed imports/types, controlled readiness/error/cancellation paths, and browser appearance checks. Fixture success does not establish live SMS/IdP or backend authentication.

For the live scenarios, omit `--fixtures-only` and supply `IAM_ENTRIES_ISSUER`, `IAM_ENTRIES_CLIENT_ID`, `IAM_ENTRIES_IDENTIFIER`, `IAM_ENTRIES_PASSWORD`, `IAM_ENTRIES_DATABASE`, and `IAM_ENTRIES_REDIS_CONTAINER` for an isolated disposable local backend. This harness seeds TOTP/risk data **only in that disposable fixture**, verifies real Direct/signup/Hosted PKCE/MFA, and requires the runner's owner to destroy the fixture afterward. It does not modify producer code. `AUTH_ENTRIES_OUTPUT`, `AUTH_ENTRIES_PORT`, and `AUTH_ENTRIES_CHROME_PORT` select private output/ports. Results retain booleans, counts, composited contrast and artifact hashes; credentials, codes, challenge proofs and tokens are not written to results or screenshots.

## Browser session lifecycle

`useAuth()` exposes `refreshToken()` and `tokenRefreshError`. Timer and manual callers share one refresh promise per
client/session. It resolves after validating and applying rotated tokens and attempting the authoritative permission
lookup. A permission failure clears permissions and remains observable through `permissionFetchError`; a permission
401 ends the session. `OAuthClient` is also exported for advanced consumers.

Refresh scheduling uses the response's positive integer `expires_in` and its receipt time. It does not read JWT `exp`
for scheduling; the existing JWT-based user/profile contract remains in place. This does not introduce opaque-token
backend support. Explicit `tokenStorage="sessionStorage"` uses envelope version 4 with an absolute `expiresAt`;
reloads preserve that deadline. Older envelopes are cleared and require a new sign-in. Memory remains the default.

Refresh failures expose `IamTokenRefreshError` with stable `code`, `reason`, `retryable`, and optional HTTP/retry
metadata, without provider text or raw response bodies. Network/timeout, 429 and 5xx failures retain the session until
its existing expiry, stop automatic retries, and allow explicit retry. Rejected sessions, invalid rotation responses,
or missing refresh configuration clear local authority. `SessionInvalidatedError` reports a result belonging to a
replaced, logged-out or disposed session; it cannot overwrite a newer session.

Logout invalidates pending work and clears local state before waiting for network activity. Direct Auth logout calls
the authenticated logout endpoint and reports revocation failures. OAuth `logout({ redirect: false })` is local-only;
use the redirect flow for OIDC end-session. Discovery failures remain observable. Provider cleanup cancels timers and
invalidates pending work, including React StrictMode effect replay. If cleanup interrupts an already sent refresh, the server may have consumed its refresh token. The SDK
clears that local session with `SESSION_UNAVAILABLE`; sign in again. This does not claim remote revocation.
A refresh cancelled before transport preserves the session. Ordinary StrictMode replay and reload without a pending
refresh preserve the persisted session. OAuth refresh may omit `id_token`; the existing logout identity is retained.
Expiry notifications continue while refresh or permission bodies are pending; JSON request timeouts include body reads.
Advanced standalone clients must call `dispose()`
when no longer used.

## Reproducible package consumer

From the SDK repository, run `node packages/react/visual-smoke/run-session-lifecycle.mjs --fixtures-only` for packed
ESM/CJS/types and browser race scenarios. The runner builds and packs core/react, installs the tarballs in an isolated
consumer and uses task-owned loopback ports and a temporary Chrome profile. Fixture-only success is not live proof.

For real Direct Auth rotation, replay rejection and logout revocation, omit `--fixtures-only` and supply
`IAM_LIFECYCLE_ISSUER`, `IAM_LIFECYCLE_CLIENT_ID`, `IAM_LIFECYCLE_IDENTIFIER`, and `IAM_LIFECYCLE_PASSWORD` for a disposable
local backend/user. Credentials stay in process memory. `SESSION_LIFECYCLE_OUTPUT`, `SESSION_LIFECYCLE_PORT`, and
`SESSION_LIFECYCLE_CHROME_PORT` select output and isolated ports. Results contain counts and artifact hashes, never
tokens or passwords. Real OAuth grant acquisition is a separate gate; Direct runtime proof does not claim it.

### Application branding in Embedded, SignUp and Dialog

Embedded `<SignIn>`, embedded `<SignUp>` and embedded `<AuthDialog>` share one scoped
branding view. They request `GET /api/v1/apps/{clientId}/branding?ui_locales=en&intent=login`
(or `zh-CN` / `signup`) using the resolved `IamProvider` locale and current flow intent.
The server localizes system title/subtitle/button/footer copy and preserves authored
copy verbatim, including explicit empty strings and English strings in a Chinese UI.
Switching between login and signup requests the matching intent. No English-text
matching or SDK translation of authored branding occurs.

The view honors `showLogo` plus `logoUrl`, title/subtitle, password/OTP login submit
text, signup submit text and footer. Busy/verification/continue/provider actions keep
their state-specific localized labels. Empty button text is preserved as configured;
Application authors should provide an accessible action label. Branding loading and
failure are visible; failure offers a retry and authentication stays available with
SDK defaults. A failed request never reports a successful branding load. Changing
client, locale or intent clears the previous branding immediately and ignores obsolete
responses. Requests have the transport timeout; obsolete results are ignored rather
than applied (a request already sent may finish).

| Token | Light | Dark |
| --- | --- | --- |
| Primary action | server `primaryColor` | same server accent |
| Text and background/surface | server `textColor` / `backgroundColor` | SDK readable dark semantic defaults |
| Link/focus | server `secondaryColor` | SDK readable dark focus default |
| Logo and authored copy | server fields | same fields |

Light token priority is component `appearance` → provider `appearance` → applicable
server tokens → SDK defaults. Provider `appearance.primaryColor`, font and radius also
carry into dark; light-only provider surface/text colors do not. In dark, explicit
provider `darkAppearance` overrides brand accent/default dark tokens, and component
`appearance` overrides those explicit dark tokens. Supply readable foreground/surface
pairs when overriding. `system` follows the OS using these same two palettes. Dark
does not copy a configured light background/text or a potentially dark secondary link
color onto a dark surface. Host component overrides remain deliberate and can override
any token in either scheme.

`faviconUrl`, `backgroundImageUrl`, `loginLayout`, `socialButtonPosition` and
`defaultLocale` are available as data, not document-wide styling instructions. The
SDK does not inject Hosted CSS, customCss, favicon, remote fonts or full-page layouts.

### Opt-in branding for Custom hosts

The public root exports `useBranding(intent?: BrandingIntent): UseBrandingResult`,
`BrandingConfig`, `BrandingIntent` (`'login' | 'signup'`) and `BrandingFetchError`.
Call the hook inside `IamProvider`, alongside `useAuthFlow`:

```tsx
const flow = useAuthFlow()
const { branding, isLoading, error, retry } = useBranding(
  flow.state.intent === 'sign-up' ? 'signup' : 'login',
)
// Host renders loading/error/retry, then chooses logo, copy and style tokens.
// error instanceof BrandingFetchError; code = 'BRANDING_FETCH_FAILED'; status may exist.
```

The result contains nullable `branding`/`error`, `isLoading`, and an explicit `retry`.
Transport/discovery/malformed-response errors are typed; their public message is
sanitized. A missing/invalid `showLogo` or incorrectly typed rendering field rejects
the payload. Nullable/absent optional server strings remain optional data. The hook
never applies styles or changes the document. Headless `useAuthFlow` itself does not
fetch branding. [CustomBranding](examples/CustomBranding.tsx) demonstrates opt-in host
rendering; the host owns its loading/error copy, accessible labels and theme mapping.

### Registration access-code policy

Embedded SignIn/SignUp and Dialog share the policy-driven registration form. OPEN
with ACCESS_CODE shows an optional input: blank uses ordinary open registration;
a supplied code uses the existing grant contract. INVITE_REQUIRED with no preset
registrationGrant requires the allowed access-code input. A preset email-link,
organization invitation or access-code proof stays owned by the public flow; the
form does not add a competing proof. Disallowed codes, disabled registration and
loading/unavailable policy never show or submit old code. Intent/policy changes
clear entered codes; typed server failures keep them editable. Custom hosts use
state.policy/capabilities gates; actions.signUp already rejects missing required,
disallowed and conflicting proofs before transport.
