import type { ReactNode } from 'react'
import { usePermission } from './usePermission'
import type { PermissionKey } from '@axis-iam/vertex'

export interface PermissionGateProps {
  /** Required permission in resource:action format */
  permission: string | PermissionKey
  /** Content to render when user has the permission */
  children: ReactNode
  /** Content to render when user lacks the permission */
  fallback?: ReactNode
}

/**
 * Conditionally render children based on permission check.
 *
 * @example
 * ```tsx
 * <PermissionGate permission="orders:read" fallback={<p>No access</p>}>
 *   <OrderList />
 * </PermissionGate>
 * ```
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const allowed = usePermission(permission)
  return <>{allowed ? children : fallback}</>
}

/**
 * Shorthand for PermissionGate without fallback.
 *
 * @example
 * ```tsx
 * <Protect permission="orders:create">
 *   <button>Create Order</button>
 * </Protect>
 * ```
 */
export function Protect({ permission, children }: { permission: string | PermissionKey; children: ReactNode }) {
  return <PermissionGate permission={permission}>{children}</PermissionGate>
}
