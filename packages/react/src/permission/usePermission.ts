import { useMemo } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { hasPermission } from '@axis-iam/vertex'
import { toAuthority, type PermissionKey } from '@axis-iam/vertex'

/**
 * Check if the current user has a specific permission.
 *
 * @example
 * ```tsx
 * function CreateButton() {
 *   const allowed = usePermission('orders:create')
 *   if (!allowed) return null
 *   return <button>Create Order</button>
 * }
 * ```
 */
export function usePermission(permission: string | PermissionKey): boolean {
  const { user } = useIamContext()
  const authority = typeof permission === 'string' ? permission : toAuthority(permission)
  return useMemo(
    () => hasPermission(user?.permissions ?? [], authority),
    [user?.permissions, authority],
  )
}
