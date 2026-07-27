import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_LINK_STATE_KEY,
  clearPendingAccountLink,
  generateAccountLinkState,
  getPendingAccountLink,
  isActionableLinkProvider,
  storePendingAccountLink,
} from './account-linking'
import type { LinkableIdentityProvider } from './types'

const linkableProvider: LinkableIdentityProvider = {
  id: 'idp-google',
  providerType: 'GOOGLE',
  protocol: 'OIDC',
  displayName: 'Google',
  enabled: true,
  linked: false,
  linkedAt: null,
  supportsAccountLinking: true,
}

describe('account-linking state helpers', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T10:00:00Z'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('generates a URL-safe client state', () => {
    const state = generateAccountLinkState()
    expect(state).toMatch(/^[a-zA-Z0-9_-]+$/)
    expect(state.length).toBeGreaterThanOrEqual(24)
  })

  it('stores only pending client state and optional provider metadata', () => {
    storePendingAccountLink('client-state', {
      expiresAt: '2026-06-27T10:05:00Z',
      provider: {
        id: 'idp-google',
        displayName: 'Google',
        providerType: 'GOOGLE',
      },
    })

    expect(sessionStorage.getItem('iam_oauth_state')).toBeNull()
    expect(sessionStorage.getItem('iam_pkce_verifier')).toBeNull()

    const raw = sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)
    expect(raw).toBeTruthy()
    expect(raw).not.toContain('link_ticket')
    expect(raw).not.toContain('linkTicket')
    expect(JSON.parse(raw!)).toMatchObject({
      state: 'client-state',
      createdAt: Date.parse('2026-06-27T10:00:00Z'),
      expiresAt: Date.parse('2026-06-27T10:05:00Z'),
      provider: {
        id: 'idp-google',
        displayName: 'Google',
        providerType: 'GOOGLE',
      },
    })
  })

  it('reads and clears pending state', () => {
    storePendingAccountLink('client-state')
    expect(getPendingAccountLink()?.state).toBe('client-state')

    clearPendingAccountLink()
    expect(getPendingAccountLink()).toBeNull()
  })

  it('clears expired or malformed pending state', () => {
    storePendingAccountLink('client-state', {
      expiresAt: '2026-06-27T09:59:59Z',
    })
    expect(getPendingAccountLink()).toBeNull()
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()

    sessionStorage.setItem(ACCOUNT_LINK_STATE_KEY, JSON.stringify({ state: 123 }))
    expect(getPendingAccountLink()).toBeNull()
    expect(sessionStorage.getItem(ACCOUNT_LINK_STATE_KEY)).toBeNull()
  })

  it('identifies only enabled supported unlinked OIDC/OAuth2 providers as actionable', () => {
    expect(isActionableLinkProvider(linkableProvider)).toBe(true)
    expect(isActionableLinkProvider({ ...linkableProvider, enabled: false })).toBe(false)
    expect(isActionableLinkProvider({ ...linkableProvider, linked: true })).toBe(false)
    expect(isActionableLinkProvider({ ...linkableProvider, supportsAccountLinking: false })).toBe(false)
    expect(isActionableLinkProvider({ ...linkableProvider, protocol: 'SAML' })).toBe(false)
  })

  it('is SSR-safe when browser storage is unavailable', () => {
    vi.stubGlobal('window', undefined)

    expect(getPendingAccountLink()).toBeNull()
    expect(storePendingAccountLink('client-state')).toBeNull()
    expect(() => clearPendingAccountLink()).not.toThrow()
  })
})
