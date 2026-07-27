import { useCallback, useEffect, useState } from 'react'
import { useIamContext } from '../provider/IamProvider'
import { requestJson, requestNoContent } from '../core/http-client'

export interface Device {
  id: string
  name: string
  lastIp: string
  lastSeen: string
  trusted: boolean
}

/**
 * Manage user's trusted devices.
 *
 * @example
 * ```tsx
 * const { devices, revokeDevice, trustDevice } = useDevices()
 * ```
 */
export function useDevices() {
  const { client } = useIamContext()
  const [devices, setDevices] = useState<Device[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchDevices = useCallback(async () => {
    const token = client.getAccessToken()
    if (!token) return

    setIsLoading(true)
    try {
      const config = await client.discover()
      const next = await requestJson<Device[]>(`${config.issuer}/api/v1/auth/devices`, {
        bearerToken: token,
      })
      setDevices(next)
    } finally {
      setIsLoading(false)
    }
  }, [client])

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

  const revokeDevice = useCallback(async (deviceId: string) => {
    const token = client.getAccessToken()
    if (!token) return

    const config = await client.discover()
    await requestNoContent(`${config.issuer}/api/v1/auth/devices/${deviceId}`, {
      method: 'DELETE',
      bearerToken: token,
    })
    await fetchDevices()
  }, [client, fetchDevices])

  const trustDevice = useCallback(async (deviceId: string) => {
    const token = client.getAccessToken()
    if (!token) return

    const config = await client.discover()
    await requestNoContent(`${config.issuer}/api/v1/auth/devices/${deviceId}/trust`, {
      method: 'POST',
      bearerToken: token,
    })
    await fetchDevices()
  }, [client, fetchDevices])

  return { devices, isLoading, revokeDevice, trustDevice, refresh: fetchDevices }
}
