import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import { IamProvider } from '../provider/IamProvider'
import { UserButton } from './UserButton'
import { setupMockFetch, storeTestTokens, testProviderProps } from '../test-utils'

function renderWithProvider(ui: React.ReactElement) {
  return render(createElement(IamProvider, testProviderProps(), ui))
}

describe('UserButton', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.useFakeTimers()
    setupMockFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders nothing when not authenticated', async () => {
    const { container } = renderWithProvider(createElement(UserButton))
    await vi.advanceTimersByTimeAsync(10)

    expect(container.innerHTML).toBe('')
  })

  it('renders avatar button when authenticated', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserButton))
    await vi.advanceTimersByTimeAsync(10)

    const button = screen.getByLabelText('User menu')
    expect(button).toBeTruthy()
    // Should show initials "TU" for "Test User"
    expect(button.textContent).toBe('TU')
  })

  it('opens dropdown on click', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserButton))
    await vi.advanceTimersByTimeAsync(10)

    const button = screen.getByLabelText('User menu')
    fireEvent.click(button)

    expect(screen.getByText('Test User')).toBeTruthy()
    expect(screen.getByText('test@example.com')).toBeTruthy()
    expect(screen.getByText('Sign out')).toBeTruthy()
  })

  it('shows org info in dropdown', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserButton))
    await vi.advanceTimersByTimeAsync(10)

    fireEvent.click(screen.getByLabelText('User menu'))
    expect(screen.getByText('Org: acme')).toBeTruthy()
  })

  it('toggles dropdown on repeated clicks', async () => {
    storeTestTokens()
    renderWithProvider(createElement(UserButton))
    await vi.advanceTimersByTimeAsync(10)

    const button = screen.getByLabelText('User menu')
    fireEvent.click(button) // open
    expect(screen.getByText('Sign out')).toBeTruthy()

    fireEvent.click(button) // close
    expect(screen.queryByText('Sign out')).toBeNull()
  })
})
