import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ForgotPasswordView } from '../../src/components/auth/ForgotPasswordView.js'

// The view used to POST `${routes.api}/auth/forget-password` — an endpoint
// Better Auth 1.6 renamed to `/request-password-reset` — and masked the
// resulting 404 as "check your email" (the non-ok branch also set success, to
// avoid enumeration). It now goes through the client's requestPasswordReset,
// and only claims success when the request actually succeeded: Better Auth
// itself answers unknown emails with a success, so the anti-enumeration
// vagueness is preserved server-side while real failures surface.

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))
vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({ requestPasswordReset: vi.fn(async () => ({ data: {}, error: null })) }),
}))

function makeClient(result: { data?: unknown; error?: { message?: string } | null }) {
  return { requestPasswordReset: vi.fn(async () => result) }
}

async function submitEmail(client: ReturnType<typeof makeClient>, email = 'user@example.com') {
  const user = userEvent.setup()
  render(<ForgotPasswordView authClient={client} />)
  await user.type(screen.getByLabelText(/email/i), email)
  await user.click(screen.getByRole('button', { name: /send reset link/i }))
  return client
}

describe('ForgotPasswordView', () => {
  it('requests the reset through the auth client with the admin redirect', async () => {
    const client = makeClient({ data: {}, error: null })
    await submitEmail(client)

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })
    expect(client.requestPasswordReset).toHaveBeenCalledWith({
      email: 'user@example.com',
      redirectTo: `${window.location.origin}/admin/reset-password`,
    })
  })

  it('surfaces a genuine failure instead of pretending an email was sent', async () => {
    const client = makeClient({ error: { message: 'Too many requests' } })
    await submitEmail(client)

    await waitFor(() => {
      expect(screen.getByText('Too many requests')).toBeInTheDocument()
    })
    expect(screen.queryByText(/check your email/i)).toBeNull()
  })
})
