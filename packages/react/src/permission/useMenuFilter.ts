import { useMemo } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { hasPermission } from '@axis-iam/vertex'

export interface MenuItem {
  path: string
  permission?: string
  children?: MenuItem[]
  [key: string]: unknown
}

/**
 * Filter menu items based on the current user's permissions.
 * Items without a `permission` field are always included.
 * Recursively filters `children`.
 *
 * @example
 * ```tsx
 * const menu = [
 *   { path: '/dashboard', label: 'Dashboard' },
 *   { path: '/orders', label: 'Orders', permission: 'orders:read' },
 *   { path: '/admin', label: 'Admin', permission: 'admin:access' },
 * ]
 * const filtered = useMenuFilter(menu)
 * // If user has ["orders:read"], filtered = [dashboard, orders]
 * ```
 */
export function useMenuFilter<T extends MenuItem>(items: T[]): T[] {
  const { user } = useIamContext()
  const permissions = user?.permissions ?? []

  return useMemo(() => filterItems(items, permissions), [items, permissions])
}

function filterItems<T extends MenuItem>(items: T[], permissions: string[]): T[] {
  return items
    .filter((item) => {
      if (!item.permission) return true
      return hasPermission(permissions, item.permission)
    })
    .map((item) => {
      if (!item.children?.length) return item
      return { ...item, children: filterItems(item.children, permissions) }
    })
}
