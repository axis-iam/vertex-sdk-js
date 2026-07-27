import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { useMenuFilter } from './useMenuFilter'
import type { MenuItem } from './useMenuFilter'
import { setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(IamProvider, testProviderProps(), children)
}

const menu: MenuItem[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/orders', label: 'Orders', permission: 'orders:read' },
  { path: '/users', label: 'Users', permission: 'users:read' },
  { path: '/reports', label: 'Reports', permission: 'reports:read' },
  { path: '/settings', label: 'Settings', permission: 'admin:access' },
]

describe('useMenuFilter', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('includes items without permission requirement', async () => {
    storeTestTokens() // permissions: ['orders:read', 'orders:create', 'users:*']
    const { result } = renderHook(() => useMenuFilter(menu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const paths = result.current.map((i) => i.path)
    expect(paths).toContain('/dashboard') // no permission required
  })

  it('includes items user has permission for', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useMenuFilter(menu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const paths = result.current.map((i) => i.path)
    expect(paths).toContain('/orders') // orders:read
    expect(paths).toContain('/users')  // users:* matches users:read
  })

  it('excludes items user lacks permission for', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useMenuFilter(menu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const paths = result.current.map((i) => i.path)
    expect(paths).not.toContain('/reports')  // no reports:read
    expect(paths).not.toContain('/settings') // no admin:access
  })

  it('preserves ordering', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useMenuFilter(menu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const paths = result.current.map((i) => i.path)
    expect(paths).toEqual(['/dashboard', '/orders', '/users'])
  })

  it('recursively filters children', async () => {
    const nestedMenu: MenuItem[] = [
      {
        path: '/admin',
        label: 'Admin',
        children: [
          { path: '/admin/users', label: 'Users', permission: 'users:read' },
          { path: '/admin/billing', label: 'Billing', permission: 'billing:read' },
        ],
      },
    ]

    storeTestTokens()
    const { result } = renderHook(() => useMenuFilter(nestedMenu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current[0].children).toHaveLength(1)
    expect(result.current[0].children![0].path).toBe('/admin/users')
  })

  it('returns only permissionless items when unauthenticated', async () => {
    const { result } = renderHook(() => useMenuFilter(menu), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    const paths = result.current.map((i) => i.path)
    expect(paths).toEqual(['/dashboard'])
  })

  it('returns all items with empty array input', async () => {
    storeTestTokens()
    const { result } = renderHook(() => useMenuFilter([]), { wrapper })
    await act(async () => { vi.advanceTimersByTime(10) })

    expect(result.current).toEqual([])
  })
})
