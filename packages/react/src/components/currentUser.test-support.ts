import { makeTestUser } from '../test-utils'

export function currentUserFixture() {
  const user = makeTestUser({ metadata: { displayName: 'Test User' } })
  user.authenticationContext = { ...user.authenticationContext,
    organizationId: 'org-1', organizationSlug: 'acme', organizationRole: 'ADMIN' }
  return user
}
