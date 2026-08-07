import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResetPasswordView } from '../../src/components/auth/ResetPasswordView.js'

// Regression: the view used to re-derive the token from useSearchParams() in
// the same effect that strips it from the URL. Next mirrors replaceState into
// its router state, useSearchParams() re-renders empty, the effect re-runs and
// flags a VALID link as invalid. The token must be captured once, before the
// strip, and never re-derived.

const push = vi.fn()
const refresh = vi.fn()
const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams() },
}))

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => searchParamsRef.current,
}))
vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))

const INVALID_TOKEN_MESSAGE = /invalid or missing reset token/i

function setUrl(path: string) {
  window.history.replaceState(null, '', path)
}

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
})

afterEach(() => {
  setUrl('/')
})

describe('ResetPasswordView token handling', () => {
  it('keeps the captured token when searchParams empties after the URL strip', async () => {
    searchParamsRef.current = new URLSearchParams('token=abc123')
    setUrl('/admin/reset-password?token=abc123')

    const { rerender } = render(<ResetPasswordView />)

    // The strip ran on mount...
    await waitFor(() => {
      expect(window.location.search).not.toContain('token')
    })

    // ...and Next mirrors it into router state: the component re-renders with
    // empty searchParams. That re-render must NOT produce the error.
    searchParamsRef.current = new URLSearchParams()
    rerender(<ResetPasswordView />)

    expect(screen.queryByText(INVALID_TOKEN_MESSAGE)).toBeNull()
    expect(screen.getByRole('button', { name: /reset password/i })).toBeEnabled()
  })

  it('preserves the rest of the query string when stripping the token', async () => {
    searchParamsRef.current = new URLSearchParams('token=abc123&callbackURL=/admin')
    setUrl('/admin/reset-password?token=abc123&callbackURL=/admin')

    render(<ResetPasswordView />)

    await waitFor(() => {
      expect(window.location.search).not.toContain('token=')
    })
    expect(window.location.search).toContain('callbackURL=')
  })

  it('shows the error when the link really has no token', () => {
    searchParamsRef.current = new URLSearchParams()
    setUrl('/admin/reset-password')

    render(<ResetPasswordView />)

    expect(screen.getByText(INVALID_TOKEN_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset password/i })).toBeDisabled()
  })

  it('submits the captured token even after the URL was cleaned', async () => {
    searchParamsRef.current = new URLSearchParams('token=abc123')
    setUrl('/admin/reset-password?token=abc123')
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render(<ResetPasswordView />)

    await user.type(screen.getByLabelText(/new password/i), 'longenoughpw')
    await user.type(screen.getByLabelText(/confirm password/i), 'longenoughpw')
    await user.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByText(/password reset!/i)).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'abc123', newPassword: 'longenoughpw' }),
      })
    )

    vi.unstubAllGlobals()
  })
})
