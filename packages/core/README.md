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
