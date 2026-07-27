import { useIamContext } from '../provider/IamProvider'

/**
 * Access the full IAM user context — identity, roles, permissions, org.
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { user, roles, permissions, isAuthenticated } = useIam()
 *   if (!isAuthenticated) return <p>Please log in</p>
 *   return <p>Hello {user.email}, you have {permissions.length} permissions</p>
 * }
 * ```
 */
export function useIam() {
  const { user, isLoaded, isAuthenticated } = useIamContext()

  return {
    /** Current user object */
    user,
    /** SDK initialization complete */
    isLoaded,
    /** Whether user is authenticated */
    isAuthenticated,
    /** User's roles */
    roles: user?.roles ?? [],
    /** User's permissions (resource:action format) */
    permissions: user?.permissions ?? [],
    /** Current organization ID */
    orgId: user?.orgId,
    /** Current organization slug */
    orgSlug: user?.orgSlug,
    /** User's role in current organization */
    orgRole: user?.orgRole,
    /** Whether the session is an impersonation */
    isImpersonating: user?.isImpersonating ?? false,
    /** The impersonating admin's ID (if impersonation) */
    actorId: user?.actorId,
  }
}
