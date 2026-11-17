import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SessionInvalidatedError } from '@axis-iam/vertex'
import { useIamContext } from '../provider/IamProvider'

interface AccountRequest {
  isCurrent: () => boolean
  assertCurrent: () => void
  assertAttached: () => void
}

/** Local request ordering layered over the client's existing session generation. */
export function useAccountRequestState<T>(initialValue: T) {
  const { client, isAuthenticated, isLoaded } = useIamContext()
  const generation = client.state.generation
  const initial = useRef(initialValue)
  const owner = useMemo(() => ({ active: false, lifetime: 0, requests: new Map<string, number>() }), [client, generation, isAuthenticated])
  const latest = useRef(owner)
  latest.current = owner
  // A successful logout intentionally changes generation, but still belongs to
  // this mounted client. This lifetime is independent of session replacement.
  const attachment = useMemo(() => ({ active: false, lifetime: 0 }), [client])
  const latestAttachment = useRef(attachment)
  latestAttachment.current = attachment
  const [result, setResult] = useState({ owner, value: initialValue })

  useEffect(() => {
    owner.active = true
    return () => { owner.active = false; owner.lifetime += 1 }
  }, [owner])
  useEffect(() => {
    attachment.active = true
    return () => { attachment.active = false; attachment.lifetime += 1 }
  }, [attachment])

  const begin = useCallback((operation: string): AccountRequest => {
    const sequence = (owner.requests.get(operation) ?? 0) + 1
    owner.requests.set(operation, sequence)
    const lifetime = owner.lifetime
    const attachedLifetime = attachment.lifetime
    const isCurrent = () => latest.current === owner && owner.active && owner.lifetime === lifetime &&
      client.state.generation === generation && owner.requests.get(operation) === sequence
    return {
      isCurrent,
      assertCurrent: () => { if (!isCurrent()) throw new SessionInvalidatedError() },
      assertAttached: () => {
        if (latestAttachment.current !== attachment || !attachment.active || attachment.lifetime !== attachedLifetime)
          throw new SessionInvalidatedError()
      },
    }
  }, [client, generation, owner, attachment])

  const patch = useCallback((request: AccountRequest, changes: Partial<T> | ((value: T) => Partial<T>)) => {
    if (!request.isCurrent()) return
    setResult(previous => {
      if (!request.isCurrent()) return previous
      const value = previous.owner === owner ? previous.value : initial.current
      return { owner, value: { ...value, ...(typeof changes === 'function' ? changes(value) : changes) } }
    })
  }, [owner])

  return { client, isAuthenticated, isLoaded, begin, patch, value: result.owner === owner ? result.value : initial.current }
}
