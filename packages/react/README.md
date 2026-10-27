# @axis-iam/vertex-react

## Explicit Server Sessions

Choose a mode deliberately. `sessionMode: 'oauth_tokens'` (default) uses public-client OAuth and memory-default tokens.
`sessionMode: 'server_session'` requires a public `SessionTransport`; it creates no TokenManager and never switches
to tokens on errors. A customer BFF can implement the finite `SessionRequest` union directly; arbitrary URL/header
proxy requests are not part of that interface.

```tsx
import { CookieSessionTransport, IamProvider, SignIn, useServerSession } from '@axis-iam/vertex-react'

const transport = new CookieSessionTransport({ origin: window.location.origin, basePath: '/console' })
// Construct once per host, outside render. SSR may construct with its explicit canonical origin.
<IamProvider sessionMode="server_session" sessionTransport={transport}
  clientId="configured-client" issuerUri="https://iam.example.com" redirectUri="/login">
  <SignIn mode="embedded" />
</IamProvider>

function WorkspaceControl() {
  const { view, actions } = useServerSession()
  // Memberships come from actions.listWorkspaces(), never user-supplied authority.
  return <button onClick={() => void actions.selectWorkspace('selected-membership-id')}>
    Select workspace
  </button>
}
```

The adapter performs `GET /console/session/bootstrap`, uses same-origin Cookie credentials, no-store and
redirect refusal. Writes use that session's `X-CSRF-Token`; the browser supplies Origin. It accepts no bearer,
forwarded host, upstream target or custom headers. Safe authenticated views bind profile, permissions, owner,
version and original expiry. Session restoration, account/Workspace changes, logout and deadlines invalidate
old work. Failures are visible; a failed read is not an empty authenticated view. The host registers the BFF's
callback, not a browser verifier. Provider HTML returns to `/login` or `/settings/security` after the BFF consumes
its private callback; `sessionProviderReturnUri` may name the exact same-origin identity return for a customer BFF.

Embedded, Dialog and `useAuthFlow` use the same Cookie login/challenge/Provider/MFA/complete/cancel actions.
On reload or Provider return, MFA is restored through bootstrap, without URL proof or tab storage.
`useAuth().login()`/redirect SignIn navigates to the explicitly configured same-origin `sessionLoginUri`
(default `/login`), whose host page mounts the Embedded/Custom form. Existing Hosted OAuth remains the explicit
oauth_tokens branded server entry; the SDK does not fabricate a BFF Hosted endpoint.

`getAccessToken`, `refreshToken`, browser code exchange, OIDC logout URL and token-specific APIs throw
`UNSUPPORTED_OPERATION`. `logout` uses the BFF and immediately invalidates local ownership; a remote refusal
is reported, not claimed as confirmed. AccountCenter/profile/security/sessions/ConnectedAccounts use safe Cookie
actions without Access Tokens. Identity state distinguishes `{ref,...}` from OAuth `{id,...}`; use
`actions.transfers()` to discover current participant transfers, then `useIdentityOperations().actions.reopen(ref)`.
Never substitute another browser's ref or raw operation/control ID.

`useServerSession().actions` also exposes purpose-bound `startStepUp(trigger, reason)` (TOTP/WebAuthn),
enrollment reauthentication, TOTP/WebAuthn enrollment, credential removal and recovery-code actions. A successful
step-up returns a purpose ref consumed by the matching sensitive action; it is not a reusable authentication flag.
`generateRecoveryCodes()` returns `{codes,count}` only to its caller. Show/save those intentional one-time user
materials within the host's dedicated recovery UI; never put them in generic session/query state, logs or storage.
Enrollment secrets/QR are likewise caller-owned, not session authority.

The console registration adapter accepts the strict `{identifier:{kind:"EMAIL"|"USERNAME",value},password}` body,
with one optional `registrationGrantToken` or `registrationAccessCode`. It never previews or consumes the grant early.
Server-session grant-preview and organization-invitation adapters remain explicitly unsupported. Browser Magic callback
completion uses the delivered `/console/session/login/magic` DTO; the server-owned fragment bridge normally handles
the callback and returns to `/login`, where bootstrap restores the safe session or MFA continuation. Provider registration uses the delivered strict authorize
DTO independently of that registration adapter. Impersonation destination wire is outside this frozen handoff.

### Provider Registration DTO

Core `authorizeProvider(providerId, proof?)` accepts mutually exclusive `registrationGrantToken` (1-2048) or
`registrationAccessCode` (1-128). React accepts typed `registrationGrant` in Provider options or
`useAuthFlow().actions.startProvider(providerId, registrationGrant?)`; supply it either in hook options or the action,
not both. Embedded/Dialog access-code input uses this exact DTO. Hosted signup retains the actual server form/grant
contract. Grants are never persisted in the navigation store and do not bypass Provider identity or required MFA.
`ORG_INVITATION`, mixed/empty/oversized fields fail before transport. Sign-in without a grant remains unchanged.

React components, providers and hooks for Axis Vertex. React and React DOM are peer dependencies. Server rendering
helpers use `JwtVerifier` from `@axis-iam/vertex/server` or the Express/Nest adapters. The decode-only React server subpath has been removed.

Install the first beta with `npm install @axis-iam/vertex-react@beta`.

## Authentication entries

Wrap each entry in `IamProvider` with the Application Client's `issuerUri`, `clientId` and registered `redirectUri`. Browser tokens stay in memory unless the host explicitly chooses supported persistence. Primary sign-in in Embedded, Dialog and Custom uses controlled authentication transactions followed by Authorization Code + S256 PKCE. Provider sign-in uses the same controlled transaction. Hosted retains its branded server authorization route and shares the finite navigation store. Explicit server_session uses a separate Cookie/CSRF transport; it never stores browser OAuth control or tokens.

| Entry | Usage | Completion |
| --- | --- | --- |
| Hosted | `<SignIn />`, or `useAuth().login()` | Authorization Code + S256 PKCE; call `handleRedirectCallback()` on the configured callback page |
| Embedded | `<SignIn mode="embedded" />`, `<SignUp mode="embedded" />` | Shared primary transaction flow, with discovered methods and policy |
| Dialog | `<AuthDialog open={open} onOpenChange={setOpen}>…</AuthDialog>` | One active Embedded form by default; `mode="redirect"` launches Hosted |
| Custom | `useAuthFlow(options)` | Public state/actions; the host renders its own UI |

Hosted callback handling validates state, consumes the saved PKCE verifier and scrubs callback parameters. Treat the callback result/error explicitly. Do not store authorization codes, proofs, passwords or tokens in app URLs, logs or analytics. Use `config.redirectUri` to configure navigation; `SignIn` does not expose a `redirectUrl` prop. `onSuccess` is an explicit completion callback, not a navigation promise.

Dialog has a single title and a small localized intent switch when registration policy permits it. Switching intent, closing, Escape and backdrop immediately discard local ownership and request server cancellation. Cancellation failure remains visible and rejects the action; Dialog stays open on refusal. Unmount discards local ownership. An explicitly saved navigation record may survive unmount until its original deadline. Reopening returns to `initialView`. Desktop and mobile framing, focus trapping/return, locale, Appearance and light/dark/system themes are inherited from the provider. It does not preserve hidden forms.

### Public transaction flow

```tsx
import { useAuthFlow } from '@axis-iam/vertex-react'

function AppOwnedSignIn() {
  const { state, actions } = useAuthFlow({
    onSignInSuccess: user => showAccount(user),
    onSignUpSuccess: profile => showVerificationInstructions(profile),
    onError: error => reportSafeErrorCode(error.name),
  })
  // Render according to state.step. These actions are called from host-owned forms:
  // actions.continueWithIdentifier({ kind: 'EMAIL', value: email })
  // await actions.submitPassword(password)
  // if state.step === 'mfa': await actions.verifyMfa(authenticatorCode)
  return <p role="status">{state.step}</p>
}
```

The complete [CustomAuth example](https://github.com/axis-iam/vertex-sdk-js/blob/develop/packages/react/examples/CustomAuth.tsx) uses only public package imports. The package consumer runner compiles and renders that exact example from packed core/react tarballs.

`useAuthFlow(options?: UseAuthFlowOptions)` returns `{ state, actions }`. Options are `initialIntent: 'sign-in' | 'sign-up'`, `registrationGrant`, `onSignInSuccess`, `onSignUpSuccess` and `onError`. Exported contracts include `UseAuthFlowResult`, `AuthFlowState`, `AuthFlowActions`, `AuthFlowIntent`, `AuthCredentialMethod`, `AuthFlowStateError` and `RegistrationOperation`.

State steps are `loading`, `unavailable`, `identifier`, `method`, `mfa`, `sign-up`, `verification`, and `success`. Narrow on `step` before reading branch fields. Common readonly fields expose capabilities, resolved password/registration policy, intent-filtered providers, `pending`, typed `error`, `retryAfterSeconds`, verification email and `verificationResendDeadline`. State exposes the original transaction/challenge deadlines, `completionPending` and `cancellationUnconfirmed`. It never contains passwords, OTP values, transaction control, PKCE verifier or registration secrets. Profile/roles metadata is not an authorization source.

| Actions | Contract |
| --- | --- |
| `continueWithIdentifier`, `selectMethod` | Synchronous selection with typed validation. Method changes discard local ownership and report cancellation failure in state. |
| `setIntent`, `back`, `cancel`, `reset` | Promise-returning cancellation; await or consume rejection. State resets immediately, with `cancellationUnconfirmed` on failure. |
| `submitPassword`, `sendCode`, `verifyCode`, `sendMagicLink`, `completeMagicLink`, `verifyMfa` | Controlled primary transaction actions; `verifyMfa(code, "TOTP" | "RECOVERY_CODE")` continues the same transaction. `completeMagicLink(callbackUrl)` consumes the exact AUTH_PROOF fragment with original-tab control and typed identifier. |
| `retryCompletion()` | Explicit recovery after an uncertain completion response, using status and the original completion key. Never retries a sent token exchange. |
| `signUp({identifier, password, registrationGrant?})` | Returns a profile result through state/callback. It does **not** authenticate. Password constraints come from policy. Host UI owns confirmation matching. |
| `resendVerification()` | Available only for pending email verification; obeys the discovered verification resend interval. |
| `startProvider(providerId)` | Calls the original transaction `/authorize` with `{providerId}`, saves its pending control/PKCE binding, and returns the validated provider URL. Host owns current-attempt navigation. |
| `resumeProviderCallback(url)` | Consumes exact original-tab binding, GETs transaction state and restores MFA or exchanges the returned code once. |

Async actions reject typed Core `AuthenticationTransactionError`, `IamApiError`, `IamNetworkError`, `IamConfigurationError` or `AuthFlowStateError`, record the failure in state and call `onError` once. The same pending action/input shares one promise; a conflicting action rejects without another request. There is no implicit retry. A canceled or replaced attempt rejects `SessionInvalidatedError` and cannot write tokens/state, emit callbacks or navigate. Hosts should consume that cancellation without displaying an authentication failure. Guard host-owned promise `then`/`finally` work by mount and attempt ownership; clear secrets before leaving the form.

Password, email OTP, SMS, magic link and provider controls are available only when discovery reports readiness for the current intent. Registration requires both capability and policy approval. `INVITE_REQUIRED` requires an accepted explicit `EMAIL_LINK`, `ACCESS_CODE` or `ORG_INVITATION` proof. Supply the proof either in options or in `signUp`, never both. Provider signup filters `availableForSignup` and posts the delivered mutually exclusive registration grant token/access-code fields. A grant gates registration, never substitutes for Provider identity or MFA. `ORG_INVITATION` is never reinterpreted. No production SMS or external provider credentials are supplied by the SDK.

Primary authentication posts to `/api/v1/auth/transactions` with `entryMode: "CUSTOM"`, strict scopes, random state, S256 challenge and an `openid` nonce when applicable. Challenges, PASSWORD/EMAIL_OTP/SMS_OTP/EMAIL_MAGIC_LINK proofs, TOTP or recovery-code MFA, and completion share the private `Authentication-Transaction` header. Proof, MFA and completion requests have canonical random 32-byte base64url idempotency keys. Lost proof/MFA responses require the same input/key; a changed input is rejected until status or cancellation resolves ownership. No primary action uses a Direct login or verification fallback.

`sendMagicLink()` explicitly saves only short-lived transaction control and PKCE binding in tab `sessionStorage`; ordinary sessions remain memory-only unless separately configured. The exact callback fragment contains `kind=AUTH_PROOF`, `auth_transaction_id`, `method=EMAIL_MAGIC_LINK`, `state`, and `proof`. It contains no control or verifier. Return to the original tab, re-enter the original typed identifier, select Magic link, then submit or call `completeMagicLink(window.location.href)`. The backend binds the proof to its original target. A new tab without saved control, wrong redirect/state/transaction, or expired record fails before proof submission. The action scrubs the current URL fragment after consuming it. Recovery from a lost in-memory proof or token-exchange uncertainty requires fresh sign-in.

Challenge expiry and resend cooldown come from the transaction challenge response, bounded by the original parent deadline. Server rejection and numeric 429 `Retry-After` remain observable. Resending invalidates the earlier proof on the server. Local timers never renew transaction or token deadlines.

Completion returns an authorization code and state, followed by one request to the discovered token endpoint. `TOKEN_EXCHANGE_UNCERTAIN` means a sent code exchange may have succeeded: start a new login. `TOKEN_REFRESH_UNCERTAIN` is terminal after a sent refresh has an unknown result; the SDK clears that session and never retries the old refresh token. Discovery failure before transport remains distinct.

Authentication becomes ready only after both `/api/v1/auth/me` and `/api/v1/auth/me/permissions` load under the new owner. View errors remain explicit. Access Tokens are never decoded for identity, permissions or expiry. Browser persistence uses version 6 with tokens, original response-derived deadline and owner; it does not persist safe views or permissions.

OAuth logout clears local state before revoking the current session via `/api/v1/auth/logout` with no Direct RT body; optional redirect uses discovered OIDC end-session. Refresh uses only discovered OAuth form transport. Legacy Direct session storage is rejected and cleared; no Direct refresh/logout alias remains. Complete real-backend combined smoke remains separate. Server-only WebAuthClient retains its own supported contract.

### Provider return and signed-in confirmation

Anonymous Provider sign-in uses `POST /api/v1/auth/transactions/{id}/authorize` with exact `{providerId}` and original transaction control. The normal code/state callback and `kind=AUTH_CONTINUATION&auth_transaction_id&state` query callback are mutually exclusive. `handleRedirectCallback()` returns `{status:"continuation",transaction,view}` for required MFA; no tokens are stored. Continue through `transaction.verifyMfa(...)` and `client.completeAuthentication(transaction)`, or use `useAuthFlow().actions.resumeProviderCallback(url)` and its MFA actions. Embedded/Dialog render a Continue action on the callback page; CustomAuth demonstrates it. Callbacks are scrubbed and consumed once. A continuation never acts as proof or a login ticket.

`PendingAuthorizationStore` from Core is the single tab-local store for CUSTOM Provider/Magic navigation and existing HOSTED OAuth. It binds issuer/client/exact redirect/entryMode/flowOwner/state/verifier, optional transaction/control and absolute expiry. Hosted's local context is bounded to ten minutes; CUSTOM never exceeds its original transaction deadline. Unknown fields, ordinary tokens, expired records, duplicate callback fields, alternate redirects and wrong state fail closed. No legacy `iam_pkce_verifier`/`iam_oauth_state` or localStorage fallback is read. Storage refusal prevents navigation. Explicit logout/cancellation and account changes discard matching pending control.

Authenticated identity Provider confirmation is not anonymous login. Call `useIdentityOperations().actions.openProvider(purpose, exactRedirect, methodId?)` directly from a user gesture. It opens the separate window **before** asynchronous PKCE/authorize work, keeps the current token and verifier in the original window, and reports popup blocking without top-level fallback. On return, the original host calls `actions.providerCallback()`: the SDK reads only that window's exact callback location, checks operation/authorization IDs and `identity_operation=proof_pending`, performs protected GET, then consumes the existing PKCE-bound proof endpoint. Callback query, popup close and GET alone never satisfy proof. This also applies to a TRANSFER recipient using `TRANSFER_COUNTERPART`. Closing/canceling/unmount/expiry/account replacement rejects late work; `cancelProviderWindow()` explicitly closes local confirmation without claiming remote cancellation. Custom hooks close their popup on unmount. No window message supplies tokens or a generic grant.

Server sessions use the explicit public SessionTransport described below. Browser OAuth persistence is a separate mode and is never enabled for Cookie navigation continuity.

### Reproducible auth-entry consumer

`node packages/react/visual-smoke/run-auth-entries.mjs --fixtures-only` builds packed consumers and uses controlled transaction routes. Its result is fixture proof. Live mode is explicitly disabled until the complete backend/Hosted/Provider candidate is delivered; obsolete Direct/MFA/Redis live probes have been retired. The session-lifecycle runner now uses OAuth token refresh only; live password admission is disabled rather than calling the retired Direct issuer.

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

### Application identity operations

Password login accepts an explicit `LoginIdentifier` (`EMAIL`, `USERNAME`, or `PHONE` with an explicit region when needed). Registration accepts only the effective allowed EMAIL/USERNAME kinds, never PHONE. Text never changes the selected kind. Email registration returns a registration operation, not a User or session. Use `client.identity.startRegistration`, `getRegistration`, and `registrationAction` (`challenges`, `complete`, `cancel`). The Registration-Control secret stays in memory and is separate from the email code. If it is lost, restart and choose your own password. Only a completed operation offers sign-in; completion does not sign in automatically.

`client.identity` exposes identifier/version facts, durable create/get/reauthenticate/challenge/authorize/providerCallback/complete/cancel/confirmTransfer actions and independent recovery authorization/status/challenge/completion/cancellation. `useIdentityOperations` exposes the same shared state to Custom and AccountCenter. Preserve the operation ID when a cancellation is uncertain and GET it before retrying. Provider confirmation uses PKCE and a separate window so the initiating context keeps the verifier in memory. The callback page contains no token handling; return to the initiating window to finish confirmation. A receiving account opens the operation ID in its own session and reauthenticates before ACCEPT; REJECT ends the transfer.

When a create response is lost, `state.uncertainCreate` retains the original typed
`request` (including `expectedLoginMethodVersion`) and `idempotencyKey`.
Custom hosts should disable edits and other operation actions and offer
`actions.retryCreate()` to recover that exact request. The store also rejects
changed payloads, changed keys and other operation actions with `CREATE_UNCONFIRMED`
until recovery succeeds or the server definitively rejects creation. Repeating
`actions.create()` with the same input and key is also supported.

```tsx
const { state, actions } = useIdentityOperations()
if (state.uncertainCreate) {
  return <button disabled={state.pending} onClick={() => {
    void actions.retryCreate().catch(showOperationError)
  }}>Recover original request</button>
}
```

Known pre-creation validation errors such as `INVALID_IDENTIFIER` clear the
attempt so the user can correct the input and deliberately submit with a new key.
For `STALE_LOGIN_METHOD_VERSION`, Custom hosts must reload identifier/login-method
facts before the next submission; ConnectedAccounts does this automatically.
Transport errors, server failures, malformed responses and unknown rejection codes
retain the attempt. This recovery state is held in memory and cleared on session
change. Keep the initiating window open: a full page reload cannot recover a
creation whose operation ID was never received, including when token storage is
explicitly set to sessionStorage.

`listAccountLoginMethods` returns `{ loginMethodVersion, methods }`; capabilities and unavailable reasons come from the server. Profile PATCH accepts displayName/avatarUrl only; username changes use identifier operations. The old link-ticket/exchange/direct DELETE protocol and hooks are retired. Users without a primary email have a nullable email projection.

## Safe session views

`useAuth().user` and `isAuthenticated` become available only after both
`GET /api/v1/auth/me` and `/me/permissions` succeed. `user.authenticationContext`
contains the explicit Application, client, session, nullable Workspace/Organization,
authentication time/methods, assurance, and impersonation context. Nullable email,
empty roles/permissions and a Workspace requiring selection are valid. Metadata is
for display only. The former `user.raw`, JWT payload decoder and React `/server`
guards are removed without aliases.

`useAuth().sessionView` exposes `status` (`anonymous`, `loading`, `ready`, `error`,
`expired`), `error`, and `expiresAt`. While either required view is loading or
fails, user and permissions are unavailable. HTTP 401 ends the local session;
403, malformed context and dependency errors reject the action and expose an error.
Retry `client.fetchPermissions()` through `useIamContext()` after resolving the
failure. OAuth callback and Custom `useAuthFlow` success wait for both views.

Token deadlines come only from OAuth response `expires_in`. Access Token bytes are
never decoded for identity, roles, assurance or expiry. Refresh reloads both views
and checks User/Application/client/session ownership; late responses from a previous
login cannot replace a current session. Storage remains memory by default. Explicit
`tokenStorage="sessionStorage"` uses version 6: tokens, original absolute deadline,
provenance and owner only. Reload fetches new views without renewing the deadline.
Prior storage versions are rejected and removed; sign in again after upgrading.

`useStepUp().start('PASSWORD_CHANGE', reason?)` calls the actual `/step-up/start`
endpoint and returns `challengeId`, `availableMethods` and `verifyTotp(code)`.
The server owns the purpose/session-bound grant and consumes it on the sensitive
operation. Assurance and a successful refresh never establish a local grant flag;
there is no `isSteppedUp`. WebAuthn remains available through the existing WebAuthn
API. `useImpersonation()` reads the API's exact `impersonationId`; ending it clears
the local session after server confirmation and rejects stale account responses.

This migration consumes stable `/me` and delivered primary/Provider CUSTOM transaction contracts. Hosted retains branded authorization; server_session consumes the delivered finite BFF contract. Impersonation destination continuation is not inferred from unrelated active producer work. Protocol-fixture evidence is not complete-backend integration proof.

### Hosted OpenID nonce and current public metadata

Public auth-methods/auth-policy no longer contain the retired email verification mode.
Email registration always completes its verification operation before activation; readiness,
signup grants, access-code gates and resolved password constraints still apply.

`startAuthorizationFlow()` generates independent random state, S256 verifier and (for `openid`)
nonce. The nonce joins the bounded, exact issuer/client/redirect/owner pending record in
sessionStorage and survives navigation. `handleCallback` consumes that record before the
single code exchange and validates the ID Token with issuer JWKS, ES256 signature, issuer,
client audience, lifetime, subject and the expected nonce. Missing/mismatched nonce or ID Token
fails with `OIDC_ID_TOKEN_INVALID` before storing any OAuth session. Access Tokens remain opaque;
profile and permissions still come from the authoritative APIs. Expired/cancelled/consumed
records require a new sign-in; a stale callback cannot replace a newer pending owner. Existing
pending OpenID records without nonce must restart sign-in. Non-OpenID scopes use OAuth-only
code exchange without inventing an ID Token requirement. Dispose preserves navigation pending
state; explicit logout discards it and invalidates local ownership.
### Identifier Capabilities And Account Changes

Embedded, Dialog and `useAuthFlow` consume the public auth-methods response's
`identifierMethods: Array<{ kind: 'EMAIL' | 'PHONE' | 'USERNAME'; methods: Array<'PASSWORD' | 'EMAIL_MAGIC_LINK' | 'EMAIL_OTP' | 'SMS_OTP'> }>`
and the resolved `defaultLogin:{identifierKind,method}`, nullable `defaultIdentifierKind`,
and effective `allowedSignupIdentifierKinds`. The resolved pair must match the first ordered identifier/method; Provider-only applications return an empty set and a null default.
Missing, duplicate or contradictory capabilities fail closed. The unavailable
view offers Retry (`actions.retryOptions()` for Custom); there is no guessed
kind or account-existence probe. `auth-policy.defaultLogin` is only a preference and is never used to invent an available method. The strict parser validates the resolved default before the ordered list is used.

The shared form shows compact identifier segments only when multiple kinds are available,
with the typed field above ordered credential choices. Single choices hide their switchers.
Changing credential method preserves the identifier (including PHONE country/local number)
but clears password/OTP. Changing identifier kind clears its draft, region and proof inputs.
User choices never reorder the server list. OTP enters a separate verification view only after
a successful send; `state.phase` exposes `credentials`, `code`, or `magic-link` for Custom.
Cooldown/429 and expiry use server deadlines; Change/Back cancel the old challenge. A magic
link waits for a real callback rather than an "already clicked" authentication shortcut.
EMAIL and USERNAME registration are independent, gated by the effective allowed set;
USERNAME never fabricates an email. An empty signup set leaves existing login/binding alone. PHONE password support does not depend on SMS delivery readiness.
Appearance, host fonts, brand copy, logo visibility and EN/zh-CN localization
remain host-controlled through the existing APIs.

PHONE sign-in uses a country/region selector (localized name and calling code)
and a local-number field. No country is selected from locale. Pasting a valid
international number synchronizes both fields; unresolved shared-code services,
unknown numbers and country mismatches are rejected locally. Changing country
clears the draft. Embedded and Dialog submit normalized E.164
`{ kind: 'PHONE', value: '+8613800138000' }` without `region`.
Custom/headless keeps its existing typed-identifier contract: hosts own any
country-selection UI and must supply valid E.164 without `region`, or a local
number with the explicit region. `examples/CustomAuth.tsx` has no duplicate
region form and retains the public E.164 path.

Registration verification has one primary action, a text resend/cooldown helper,
and a separate text cancellation action. Resend failures preserve entered codes;
cancellation uncertainty retains the original registration and offers a status
refresh. A live registration must complete or be explicitly cancelled before
`reset`/`setIntent` can discard its view.

Account profile email and its verification badge come from the active primary
EMAIL identifier, not the legacy profile `emailVerified` boolean. Unknown
verification is not shown as unverified; no primary email means no email badge.
Managed identifiers show their actual source, and unavailable provider names are
not substituted with technical IDs.

Connected-account changes use one protected dialog (the existing AccountCenter
dialog when embedded). **Continue later** closes the view, clears password/code
inputs and preserves the same operation. It does not call cancel. **Cancel
operation** calls the server; an uncertain response retains the reference and
requires status reconciliation before submitting more proofs. Technical
references and exact expiry are in expandable details, not the main heading.
Custom integrations can still use `useIdentityOperations().actions.reopen(ref)`
when they already hold an authorized operation reference; the prebuilt view no
longer asks ordinary users to paste an operation ID.

### Headless Capability Consumption

Core exports `parseAuthCapabilities`, `AuthCapabilities`, `DefaultLogin`, `IdentifierMethods`,
and `SignupIdentifierKind`. React re-exports the types and exposes `useAuthFlow` public actions
without requiring any prebuilt UI. `examples/CustomAuth.tsx` uses only public imports and the
same authoritative capability/default/registration state. PHONE hosts may reuse the pure
`phoneCountries`, `parsePhoneIdentifier` and `normalizePhoneIdentifier` helpers; no country is
inferred from locale. `allowSignUp` only controls presentation; it cannot enable server-disabled
registration and is not a substitute for the effective allowed set.
