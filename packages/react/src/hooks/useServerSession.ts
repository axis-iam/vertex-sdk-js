import { UnsupportedOperationError } from '@axis-iam/vertex'
import { useIamContext } from '../provider/IamProvider'

/** Explicit server-session actions; one-time enrollment/recovery material stays caller-owned. */
export function useServerSession() {
  const { client } = useIamContext()
  if (client.mode !== 'server_session') throw new UnsupportedOperationError()
  return { view: client.session.getSnapshot(), actions: client }
}
