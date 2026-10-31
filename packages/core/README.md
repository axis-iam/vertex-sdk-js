# @axis-iam/vertex

Core Axis Vertex runtime for TypeScript applications. It provides the browser-safe root export and the explicit
`@axis-iam/vertex/server` entry point for confidential server integrations.

Install the first beta with `npm install @axis-iam/vertex@beta`.

## Framework-neutral session coordination

The browser-safe root exports `SessionLifecycle<T>` and `SessionInvalidatedError`. `run` shares the same promise while
an operation is pending. `invalidate()` advances the generation, releases that flight and cancels its timer; callers
must check the supplied generation with `assertCurrent` after every await and before applying side effects.
`scheduleAt` takes an absolute millisecond deadline and bounds individual timers to the platform limit. The class
owns no tokens, storage or transport; adapters enforce those contracts. React's TokenManager composes this engine.

## Primary browser authentication

`AuthenticationTransaction` is the framework-neutral primary sign-in protocol used by the React Custom, Embedded and Dialog entries. Configure the discovered issuer/token endpoint, public `clientId`, exact `redirectUri` and strict scopes. `start` creates real S256 state/verifier binding and an OIDC nonce for `openid`.

```ts
import { AuthenticationTransaction } from '@axis-iam/vertex'

const transaction = await AuthenticationTransaction.start({
  issuer: discovery.issuer,
  tokenEndpoint: discovery.token_endpoint,
  clientId: 'public-app',
  redirectUri: 'https://app.example/callback',
  scopes: ['openid', 'profile'],
  assertOwner: () => session.assertCurrent(generation),
})
const view = await transaction.authenticate({
  method: 'PASSWORD', identifier: { kind: 'EMAIL', value: email }, password,
})
if (view.state === 'MFA_REQUIRED') await transaction.verifyMfa('TOTP', authenticatorCode)
const tokens = await transaction.exchange()
```

`challenge(method, identifier)` returns server cooldown and challenge expiry. Proof authentication accepts `EMAIL_OTP`, `SMS_OTP`, or `EMAIL_MAGIC_LINK` plus `proof`; MFA accepts `TOTP` or `RECOVERY_CODE`. Always finish the same controlled transaction. `get`, `cancel`, `getSnapshot` and `invalidate` expose status and ownership control without exposing secrets. Parent expiry is absolute.

Proof/MFA/complete calls retain the identical request and key after an uncertain response. Explicitly repeat the same input or query status. A lost completion response can be recovered by `get()` then `exchange()` with the retained key, including a server `COMPLETED` status. Never exchange a code twice: `TOKEN_EXCHANGE_UNCERTAIN` invalidates this transaction and requires fresh sign-in. Callers must bind `assertOwner` and discard results after unmount/account replacement.

Memory is the default. Only `persistForNavigation()` opts into short-lived tab storage for Magic link return. `restoreMagicLink(config, callbackUrl)` requires that original record plus exact redirect/state/transaction and five-field AUTH_PROOF fragment. Re-enter the original typed identifier and call `authenticateMagicLink(url, identifier)`, continue MFA if required, then exchange. Control/verifier are never placed in the link; identifiers, proofs, passwords and ordinary tokens are never stored in the pending record. Clear the consumed fragment in the host. Explicit cancellation removes pending control. `discardNavigation({ issuer, clientId })` removes a matching saved record on account replacement/logout.

Provider navigation uses `await transaction.authorizeProvider(providerId)`, returning `{authorizationUrl,expiresAt}` and explicitly saving the pending binding. On the exact callback, call `AuthenticationTransaction.restoreProvider(config, url)` then `completeProviderCallback(url)`. The normal code/state branch requires server COMPLETED and exchanges once; AUTH_CONTINUATION requires the same transaction and server MFA_REQUIRED, returns only a view, then continues MFA/complete. No callback token/proof/control is accepted. Missing original-tab control, owner change, wrong client/state/redirect, duplicate/mixed branches and expiry fail closed. Restore consumes the tab context once.

The public `PendingAuthorizationStore` is shared by CUSTOM and existing HOSTED navigation. HOSTED saves only state/verifier/owner/context/deadline, never fabricated transaction control; it retains its real server authorization/branding route. Both use bounded sessionStorage with explicit failure, not ordinary token storage. Provider authorize accepts exactly one optional `registrationGrantToken` (max 2048) or `registrationAccessCode` (max 128); these gate registration, not authentication/MFA. The separate server_session transport is documented below.

## Registration grant management (server only)

Import `PortalOpenApiClient`, `PortalOpenApiError`, `RegistrationGrantDeliveryInput`, and
`RegistrationGrantDelivery` from `@axis-iam/vertex/server`. Create requires a caller-owned
`idempotencyKey` as its second argument. `CreatedRegistrationGrant.secretAlreadyIssued`
distinguishes an initial response from a same-key replay: only the initial EMAIL_LINK response
includes `registrationGrantToken` and the complete `registrationInvitationUrl`; replay contains
no secret or URL. ACCESS_CODE initially includes only `registrationAccessCode`.

Creation does not send email. Explicitly call
`deliverRegistrationGrant(grantId, { recipient, locale, variant: 'LINK' }, sendKey)` and then
`getRegistrationGrantDelivery(grantId, deliveryId)` for authoritative status, not a resend.
Use `rotateRegistrationGrant(grantId, lastRead.version, rotateKey)` to rotate a secret;
its same-key replay is also secretless. Keep command keys stable for caller-directed retries.
These mutations do not automatically retry. Read/status uses `registration_grants:read`;
create, delivery and rotation use `registration_grants:write`.

## Confidential WEB/BFF authentication

Import `WebAuthClient` and its store contracts from `@axis-iam/vertex/server`. The client implements OIDC discovery,
Authorization Code + S256 PKCE, HTTP Basic confidential token exchange, refresh-token rotation, and local-first
logout. It is server-only and is not exported from the browser-safe package root.

```ts
import {
  WebAuthClient,
  type WebAuthTransactionStore,
  type WebAuthSessionStore,
} from '@axis-iam/vertex/server'

const client = new WebAuthClient({
  issuer: 'https://auth.example.com',
  clientId: process.env.IAM_WEB_CLIENT_ID!,
  clientSecret: process.env.IAM_WEB_CLIENT_SECRET!,
  applicationOrigin: 'https://app.example.com',
  redirectUri: 'https://app.example.com/auth/callback',
  successRedirect: '/dashboard',
  postLogoutRedirect: '/signed-out',
  transactionStore,
  sessionStore,
})
```

`WebAuthTransactionStore.consume` must atomically read and delete one transaction.
`WebAuthSessionStore.replace` must atomically compare the expected revision and replace the session. Store values
contain the verifier or tokens and therefore belong only in customer-controlled server storage. The SDK provides no
implicit in-memory, Redis, database, or process-global store.

## Explicit Cookie Session Transport

`CookieSessionTransport({origin,basePath:'/console'})` implements the finite public `SessionTransport.request(SessionRequest)`
contract. It permits only declared same-origin session/login/account/purpose/MFA actions, Cookie credentials and bound CSRF.
No arbitrary URL/headers, bearer or browser PKCE/control fields exist. Customer BFFs can implement that interface without
using our console. `ServerSession` owns safe view/owner/version/deadline and local invalidation; `SessionLogin` owns no
secret and supports primary/MFA/Provider/cancel. Browser Token methods are not simulated. See the React guide for actual
IamProvider/AccountCenter wiring and one-time enrollment/recovery-code material handling.

`IdTokenVerifier` is the separate Hosted OpenID response validator. Configure exact issuer,
clientId and same-origin jwksUri; `verify(idToken, expectedNonce)` verifies the producer's ES256
signature and required issuer/audience/sub/iat/exp/nonce claims, including azp binding where
present or required. It throws `IdTokenValidationError` (`OIDC_ID_TOKEN_INVALID`) without
claim/provider text. It does not decode Access Tokens or supply UI permissions. Hosted
`PendingAuthorization.nonce` is finite tab-local navigation material, never an ordinary token.

## Resolved Authentication Capabilities

`parseAuthCapabilities(raw)` is framework-neutral. It returns the producer-ordered
`identifierMethods`, resolved nullable `defaultLogin`/`defaultIdentifierKind`, and effective
`allowedSignupIdentifierKinds`. Missing/duplicate/invalid pairs, inconsistent first/default
combinations and PHONE signup fail closed with `AuthCapabilitiesError`. It never resolves
the preference from auth-policy or enables a disabled method. Empty local capabilities have
null defaults; an empty signup array explicitly disables local registration, not existing login.

Compose these capabilities with public `AuthenticationTransaction`/`AuthenticationFlow` actions:
`challenge` first, then proof `authenticate`, and retain the original MFA/complete protocol.
The finite Cookie transport adds `magic` with exactly `{transactionId,proof,state}` and typed
EMAIL/USERNAME `registrationStart` with the optional mutually-exclusive token/access-code grant.
No grant preview/redemption, browser token, control secret or PKCE material is added to Cookie
state. `SessionTransportError.retryAfterSeconds` carries a valid numeric server Retry-After.

### Identifier range snapshots

`parseAuthCapabilities` includes the required `identifierRestrictions` snapshot, also available
through `parseIdentifierRestrictions`. Its `signup` purpose applies to registration/new binding;
`login` applies only when that restriction explicitly includes existing identifier sign-in.
Each purpose exposes `email.restricted` and `phone.{restricted,allowedRegions}`. Unrestricted
phone regions are `null`, never an empty allow-list. Email domains are never public. These are
rendering constraints, not an account-wide fence or a replacement for server authorization.

### Account-security operation protocol

The root export provides `MfaOperationClient`, `MfaOperation`, `MfaCapabilities`,
`MfaOperationReauthentication`, typed action/delivery/results and strict response
parsers. Pass the explicit mode (`oauth_tokens` or `server_session`) when parsing:
Server UUID `id` and opaque BFF `ref` normalize to the public operation's `ref`.
There is no ID/ref guessing and no legacy TOTP enrollment endpoint fallback.

`CookieSessionTransport` implements finite MFA capability/create/get/reauthentication,
current-email proof, provider authorization/callback, scoped TOTP/WebAuthn step-up,
begin/complete/cancel actions. Browser writes use the delivered same-origin Cookie
and CSRF contract; they cannot supply arbitrary bearer headers, URLs or upstream
provider verifiers. Strict payload validation rejects legacy `STEP_UP_PROOF`
reauthentication, wrong challenge fields, extra fields and null confirmation codes.

GET is a safe operation receipt, never setup material. Only begin can deliver the
TOTP secret/QR; only recovery-code completion can deliver a code set, once.
`delivery: ALREADY_DELIVERED` does not mean the material can be fetched again.
The operation result determines session impact, not account-summary heuristics.

### Authenticated identifier management and Provider targets

`AccountIdentifiers` contains required authenticated `management.add` capabilities
for USERNAME/EMAIL/PHONE and each item's VERIFY/SET_PRIMARY/REMOVE/REPLACE/TRANSFER
capabilities. `IdentifierManagementCapability` preserves `allowed`, stable
`unavailableReasons`, `requirements` and exact `replacementPrimaryIds`.
`management.proofOptions` is the actual current-account proof inventory. Use the
exported strict `parseIdentifierManagement` / `parseIdentifierActions`; missing or
contradictory snapshots fail closed instead of granting default actions.
These snapshots are not authorization grants and do not replace mutation-time
policy, range, ownership, version and last-path checks. Anonymous login/signup
metadata does not describe self-service permissions or grandfathered identifiers.

`IdentityOperation.providerTarget` is a nullable `IdentityProviderTarget`, parsed
by `parseIdentityProviderTarget`. It contains providerId, nullable masked name and
email, and an opaque 64-lowercase-hex reference for the actual verified LINK target.
Do not infer it from catalog/existing identities or send its reference as a new
completion field. Cancelled/expired/rejected and pre-proof views have no target;
committed status/replay retains the same presentation. No raw subject, provider
token, claims or verifier is part of the public target.

### Application invitation journeys

`InvitationJourneyClient` (public root) uses actual user bearer authority with issuer cookies explicitly omitted.
`registrationContext(continuation)` instead binds a one-use continuation to a private, expiring Client-scoped
registration context. It returns only a safe journey view; the context is never an ordinary Access Token.
The two authorities are exclusive. `authenticatedSession(ref)` explicitly discards that finite context after a
normal Client login; there is no automatic bearer fallback when a context expires or fails.

```ts
import { InvitationJourneyClient, consumeInvitationContinuation } from '@axis-iam/vertex'
const continuation = consumeInvitationContinuation(window.location, window.history)
const invitations = new InvitationJourneyClient({
  issuer, clientId, applicationId, getAccessToken, timeoutMs: 10000,
})
// After ordinary Application Client OAuth, not issuer Cookie login:
const journey = await invitations.exchange(continuation!)
const current = await invitations.get(journey.ref)
// Only in response to the user's explicit confirmation:
await invitations.confirm(current.ref, {
  expectedInvitationVersion: current.invitationVersion, expectedRole: current.role,
}, crypto.randomUUID())
```

`register`, `registration`, `verifyRegistration`, `resendRegistration`, `cancelRegistration` reuse the finite
journey authority and real EMAIL/USERNAME registration. PHONE registration is not supported. Registration never
joins an organization; `confirm` is separate. `startAuthentication`, `authenticate`, `challenge`, `mfa` and
`cancelAuthentication` expose finite first-factor/TOTP/recovery-code steps. Provider sign-in uses ordinary Client
OAuth **before** consuming the continuation, never a hosted-only finite provider endpoint.

A timeout, malformed successful response, or lost network response can leave a mutation committed. No mutation
is retried by this client. Read `get(ref)` or registration status before deciding another action. A 409 is not
success; reread role/version, call `continue(ref, current.invitationVersion)` to review a `ROLE_CHANGED` source,
then obtain a new explicit confirmation. `clear()` aborts pending work and erases
context on logout/owner replacement. `signal` provides native lifecycle cancellation. The SDK does not log proof,
context, password, OTP, bearer, or issuer owner-cookie values.

#### Finite Node BFF

`InvitationBff`, `ConfidentialInvitationClient`, `WebAuthClient`, and `IamClient` are server-only `/server` exports.

Catch errors from `ConfidentialInvitationClient` with `InvitationError` imported from
`@axis-iam/vertex/server`. Use the error class from the same public entry point as the client;
independently bundled browser/server or ESM/CJS entry points do not promise constructor identity.
The stable `code` and HTTP `status` remain the wire-error contract.
`SessionInvitationJourneyClient` and `CookieSessionTransport` consume the finite safe-view route allowlist.
The host owns HttpOnly/Secure/SameSite session cookies, prelogin/bootstrap, CSRF issuance, actual OAuth callback,
verified `/me` identity and session-store persistence. Do not trust identity or owner from browser JSON or a
merely decoded JWT. `resolveSession` returns `{owner, csrfToken, expiresAt, accessToken, identity}`; `identity`
is null for prelogin and otherwise `{applicationId,clientId,userId}` verified by the host. Both authority fields
must be null or both populated. Owner may survive its first login but must change on user/App/Client replacement.

```ts
import { InvitationBff } from '@axis-iam/vertex/server'
const invitations = new InvitationBff({
  issuer, applicationId, clientId, clientSecret, applicationOrigin,
  basePath: '/bff/invitation-journeys', resolveSession,
})
// Adapt only this exact route subtree to native Request / Response.
const response = await invitations.handle(request)
```

Writes require the exact application Origin and host session CSRF; caller Authorization/context headers and
cross-site/same-site metadata are denied. No arbitrary URL/header proxy exists. Context-backed requests use
confidential Basic authentication server-side; normal OAuth requests use the actual user bearer. No upstream
Cookie, raw context or control reaches the browser. Same-identity terminal refs can be recovered after adapter
restart only if the backend authorizes the read. Pending context loss requires reopening the original invitation.
`releaseOwner` / `dispose` erase state. The bounded in-memory adapter is single-process, not a multi-instance
persistent session store. Route to one owning process or provide host-level affinity; do not silently fail over.

The current `WebAuthClient` default OpenID request lacks a nonce and is rejected by the authentication
transaction producer. Configure explicit non-OpenID OAuth scopes (`profile email offline_access`) for this helper.
This supports OAuth authorization-code login, not Hosted OIDC completion. Do not use an unverified ID Token as
identity; validate the actual access token or use authenticated `/me`. Ordinary WebAuth OpenID support remains
a separate integration prerequisite.

`ServerSession.invalidationReason` distinguishes `unauthorized` (a current-generation HTTP 401)
from explicit `cleared`, session `replaced`, and `disposed` lifecycle changes. Every path still
invalidates the old generation and authentication as before; an old response cannot invalidate a
new session. Adapters may use this signal for a non-sensitive, owner-bound read receipt, never
to retain old-session credentials, proofs or mutation authority.
