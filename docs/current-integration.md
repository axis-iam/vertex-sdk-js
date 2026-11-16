# Current integration map

This source candidate is not published to npm. Manifest version `0.1.0` and older preview tarballs do not identify
this candidate. Pin the actual reviewed Git commit and matching approved tarball hashes; do not overwrite or relabel
an old preview. This documentation change publishes no package and changes no SDK version.

| Need | Current entry |
| --- | --- |
| Browser authentication | [React transaction guide](../packages/react/README.md#public-transaction-flow), `useAuthFlow`, [CustomAuth](../packages/react/examples/CustomAuth.tsx) |
| Framework-neutral protocol | [Core AuthenticationTransaction](../packages/core/README.md#primary-browser-authentication) |
| Provider callback and MFA | [Provider return](../packages/react/README.md#provider-return-and-signed-in-confirmation) |
| AccountCenter six sections / headless security | [Security guide](../packages/react/README.md#account-security-embedded-dialog-accountcenter-and-headless), [AccountSecurity example](../packages/react/examples/AccountSecurity.tsx) |
| Application / Organization invitations | [Invitation journey](../packages/react/README.md#invitation-journey-entry), [InvitationJourney example](../packages/react/examples/InvitationJourney.tsx) |
| Explicit Cookie BFF | [Server sessions](../packages/react/README.md#explicit-server-sessions) and finite `SessionTransport` |

Hosted uses OAuth authorization code + S256 PKCE. Embedded, Dialog and Custom primary sign-in use one controlled
Authentication Transaction, followed by code completion and OAuth token exchange/refresh. Do not call retired Direct
login/refresh endpoints. Handle Provider `continuation` by resuming the original transaction and completing required
MFA; it is not a login result or token. Keep the initiating tab and exact registered callback binding.

Provider popup completion is automatic through `useAuthFlow().actions.signInWithProvider(id)`, shared by
Embedded/Dialog and Custom. Full-page CUSTOM returns auto-consume only a matching pending Client/issuer/redirect;
HOSTED keeps its separate callback entry. Render `pending` as ordinary busy. Final `useAuthFlow` login failures
restore the normal form with `error` and immediately discard tokens belonging to that failed attempt. Remote
revocation is best effort and never blocks a fresh login; do not claim remote logout confirmation. Remove the old
`recovery` / `retrySessionViews` screen. A sent code is not replayed.

Choose identifier kind explicitly from effective capabilities (`EMAIL`/`USERNAME`/`PHONE` for login;
server-allowed `EMAIL`/`USERNAME` for registration). `clientId` locates the ApplicationClient's owning Application;
it is not an internal Application UUID or a policy override. Permissions load from authenticated `/me/permissions`,
not login responses, profile fields or decoded JWTs.

Tokens default to memory. Explicit persistence uses v6 records; legacy Direct sessions are invalidated and require
fresh authentication. Await cancellation; retain unresolved operations and query their status after uncertain writes.
A sent token exchange/refresh with unknown outcome cannot be replayed. Follow the linked protocol's typed recovery
rules rather than guessing from local state.

AccountCenter sections are `profile`, `methods`, `password`, `security`, `sessions`, `permissions`. Bind/unbind,
identifier management and MFA use authenticated action-specific capabilities, not public login/signup availability.
Keep setup keys, QR enrollment URIs and recovery-code plaintext only in ephemeral authorized UI memory.

Invitations use `OrganizationInvitationAccept`, `useInvitationJourney` and Core `InvitationJourneyClient`.
Retired raw-token preview/accept APIs, `useOrganizationInvitation`, `token` and `onLoginRequired` props are unavailable.
Scrub the finite continuation before I/O; verification/registration/MFA never imply membership. The displayed current
role requires separate explicit confirmation. Workspace invitations remain control-plane operations.
