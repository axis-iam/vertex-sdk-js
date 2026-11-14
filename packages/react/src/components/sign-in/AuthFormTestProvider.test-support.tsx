import type { ReactNode } from 'react'
import { IamProvider } from '../../provider/IamProvider'
import { testProviderProps } from '../../test-utils'

/** Real client/UI boundary, memory-only; tests supply discovery with setupMockFetch. */
export function AuthFormTestProvider({ children }: { children: ReactNode }) {
  return <IamProvider {...testProviderProps()} tokenStorage="memory">{children}</IamProvider>
}
