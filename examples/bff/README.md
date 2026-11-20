# Connected application BFF example

Use the matching locally packed `@axis-iam/vertex`, `@axis-iam/vertex-react`,
`@axis-iam/vertex-express`, and `@axis-iam/vertex-nestjs` artifacts. Version 0.1.0
alone does not identify this unpublished candidate. Install tarballs in an empty
project with express and React; no workspace links or source imports are needed.
`server.mjs` is an application entry importing only public package names.

Configure `APP_ORIGIN`, `IAM_ISSUER`, `IAM_RESOURCE_AUDIENCE`,
`IAM_WEB_CLIENT_ID`, `IAM_WEB_CLIENT_SECRET` on the backend. Register an active WEB
client, exact `${APP_ORIGIN}/auth/callback` and permitted origin in IAM. Build your
frontend into `public/`, using `ConnectedApp.tsx` with public client ID and issuer.
Start with `node server.mjs`. Secrets stay in backend configuration.
The protected POST `/api/private/action` demonstrates the business-write guard.
`ConnectedApp.tsx` sends the current safe session view's `csrfToken` as
`X-CSRF-Token`; the browser supplies canonical Origin. POST/PATCH/DELETE and other
unsafe methods require both, even when identity was already validated in that
request. Add application permissions/resource authorization before the mutation.
Local loopback HTTP additionally requires `BFF_LOOPBACK_HTTP=true`; production
uses HTTPS and Secure host-only Cookie. Set proxy trust in your host deliberately.

The example explicitly selects one shared, bounded `MemorySessionProvider` per
backend process. Restart loses local authentication; RAM is not shared between
workers. Close on shutdown. For native Express/Nest session reuse, select
`expressSessionBinding()` and a suitable provider as documented in the packages.
No database driver, schema, migration or encryption key is required for RAM.

Hosted calls bootstrap before GET login. Embedded and Dialog use the existing UI;
Headless uses `useAuthFlow` state/actions (replace the illustrative identifier
control with your own fields). Successful callbacks land on `/signed-in`; serve
that frontend path. Bind email proof landing to your allowed same-origin browser
page: `authenticateMagicLink` validates/clears the fragment and submits the finite
CSRF action. Do not move fragment proofs into query parameters.

`consumer.mjs`, `fixture.mjs`, `browser.jsx` and `consumer.ts` are the exclusive
package-verification fixture, driven from the repo entry by
`node scripts/verify-bff-consumers.mjs`. The runner builds adapters, packs all four
packages, scans archives, installs them in a clean consumer, checks ESM/CJS/types
and runs real loopback Express/Nest/native-session HTTP and Chrome flows. It
uses a controlled IAM protocol endpoint with signed ES256 ID Tokens. Its results
are not proof of a real IAM instance, real Provider, email/SMS delivery, or a
production shared session backend.
