import { RequirePerm } from '@axis-iam/vertex-nestjs'
import { PermissionGate, usePermission } from '@axis-iam/vertex-react'
import { AppPermissions } from './permissions.gen.js'

// The API route and React button consume the exact same generated PermissionKey object.
export const ordersReadApiGuard = RequirePerm(AppPermissions.ORDERS_READ)

export function OrdersButton() {
  const canReadOrders = usePermission(AppPermissions.ORDERS_READ)
  return (
    <PermissionGate permission={AppPermissions.ORDERS_READ}>
      <button type="button" disabled={!canReadOrders}>View orders</button>
    </PermissionGate>
  )
}
