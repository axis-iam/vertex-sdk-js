import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { PermissionGate, Protect } from './PermissionGate'
import { setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('PermissionGate', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders children when user has permission', async () => {
    storeTestTokens() // permissions: ['orders:read', 'orders:create', 'users:*']
    renderWithProvider(
      createElement(PermissionGate, { permission: 'orders:read' },
        createElement('div', null, 'Allowed Content'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Allowed Content')).toBeTruthy()
  })

  it('renders children for wildcard match', async () => {
    storeTestTokens()
    renderWithProvider(
      createElement(PermissionGate, { permission: 'users:delete' },
        createElement('div', null, 'Wildcard Match'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Wildcard Match')).toBeTruthy()
  })

  it('hides children when user lacks permission', async () => {
    storeTestTokens()
    renderWithProvider(
      createElement(PermissionGate, { permission: 'admin:access' },
        createElement('div', null, 'Secret Content'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.queryByText('Secret Content')).toBeNull()
  })

  it('renders fallback when user lacks permission', async () => {
    storeTestTokens()
    renderWithProvider(
      createElement(PermissionGate, {
        permission: 'admin:access',
        fallback: createElement('div', null, 'No Access'),
      },
        createElement('div', null, 'Secret Content'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.queryByText('Secret Content')).toBeNull()
    expect(screen.getByText('No Access')).toBeTruthy()
  })

  it('hides children when unauthenticated', async () => {
    renderWithProvider(
      createElement(PermissionGate, { permission: 'orders:read' },
        createElement('div', null, 'Should Not Show'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.queryByText('Should Not Show')).toBeNull()
  })
})

describe('Protect', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders children when permitted', async () => {
    storeTestTokens()
    renderWithProvider(
      createElement(Protect, { permission: 'orders:read' },
        createElement('button', null, 'Create Order'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.getByText('Create Order')).toBeTruthy()
  })

  it('renders nothing when not permitted', async () => {
    storeTestTokens()
    renderWithProvider(
      createElement(Protect, { permission: 'reports:read' },
        createElement('button', null, 'View Reports'),
      ),
    )
    await vi.advanceTimersByTimeAsync(10)

    expect(screen.queryByText('View Reports')).toBeNull()
  })
})
