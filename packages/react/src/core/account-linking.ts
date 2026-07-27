import type { LinkableIdentityProvider } from './types'

export const ACCOUNT_LINK_STATE_KEY = 'iam_account_link_state'

const DEFAULT_ACCOUNT_LINK_TTL_MS = 10 * 60 * 1000

export interface PendingAccountLinkProvider {
  id: string
  displayName?: string
  providerType?: string
}

export interface PendingAccountLinkState {
  state: string
  createdAt: number
  expiresAt: number
  provider?: PendingAccountLinkProvider
}

export interface StorePendingAccountLinkOptions {
  expiresAt?: string | number | Date
  provider?: PendingAccountLinkProvider
}

export function generateAccountLinkState(): string {
  const bytes = new Uint8Array(16)
  const cryptoApi = getCrypto()
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, toHex).join('')
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`
}

export function storePendingAccountLink(
  state: string,
  options: StorePendingAccountLinkOptions = {},
): PendingAccountLinkState | null {
  const storage = getSessionStorage()
  if (!storage) return null

  const createdAt = Date.now()
  const pending: PendingAccountLinkState = {
    state,
    createdAt,
    expiresAt: resolveExpiresAt(options.expiresAt, createdAt),
  }

  if (options.provider) {
    pending.provider = {
      id: options.provider.id,
      displayName: options.provider.displayName,
      providerType: options.provider.providerType,
    }
  }

  storage.setItem(ACCOUNT_LINK_STATE_KEY, JSON.stringify(pending))
  return pending
}

export function getPendingAccountLink(): PendingAccountLinkState | null {
  const storage = getSessionStorage()
  if (!storage) return null

  const stored = storage.getItem(ACCOUNT_LINK_STATE_KEY)
  if (!stored) return null

  try {
    const parsed = JSON.parse(stored) as Partial<PendingAccountLinkState>
    if (
      typeof parsed.state !== 'string'
      || typeof parsed.createdAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
    ) {
      clearPendingAccountLink()
      return null
    }
    if (parsed.expiresAt <= Date.now()) {
      clearPendingAccountLink()
      return null
    }

    return {
      state: parsed.state,
      createdAt: parsed.createdAt,
      expiresAt: parsed.expiresAt,
      provider: normalizePendingProvider(parsed.provider),
    }
  } catch {
    clearPendingAccountLink()
    return null
  }
}

export function clearPendingAccountLink(): void {
  const storage = getSessionStorage()
  storage?.removeItem(ACCOUNT_LINK_STATE_KEY)
}

export function isActionableLinkProvider(provider: LinkableIdentityProvider): boolean {
  return provider.enabled
    && !provider.linked
    && provider.supportsAccountLinking
    && (provider.protocol === 'OIDC' || provider.protocol === 'OAUTH2')
}

function resolveExpiresAt(expiresAt: string | number | Date | undefined, now: number): number {
  if (expiresAt instanceof Date) {
    return expiresAt.getTime()
  }
  if (typeof expiresAt === 'string') {
    const parsed = Date.parse(expiresAt)
    if (Number.isFinite(parsed)) return parsed
  }
  if (typeof expiresAt === 'number' && Number.isFinite(expiresAt)) {
    return expiresAt
  }
  return now + DEFAULT_ACCOUNT_LINK_TTL_MS
}

function normalizePendingProvider(value: unknown): PendingAccountLinkProvider | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return undefined
  }
  return {
    id: value.id,
    displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
    providerType: typeof value.providerType === 'string' ? value.providerType : undefined,
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function getCrypto(): Crypto | undefined {
  if (typeof crypto !== 'undefined') return crypto
  if (typeof globalThis.crypto !== 'undefined') return globalThis.crypto
  return undefined
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
