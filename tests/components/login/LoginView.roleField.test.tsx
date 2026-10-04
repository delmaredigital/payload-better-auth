/**
 * The login role gate reads the configured `roleField` (issue #41).
 */
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderLogin } from './_harness.js'

describe('LoginView — roleField', () => {
  it('admits a session user whose `roles` array holds the required role', async () => {
    const { router } = renderLogin(
      { enablePassword: true, requiredRole: 'admin', roleField: 'roles' },
      { roles: ['editor', 'admin'] }
    )
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin'))
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument()
  })

  it('denies a user whose admin role sits only in `role`', async () => {
    const { router } = renderLogin(
      { enablePassword: true, requiredRole: 'admin', roleField: 'roles' },
      { role: 'admin', roles: ['editor'] }
    )
    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('applies requireAllRoles against the configured field', async () => {
    renderLogin(
      { enablePassword: true, requiredRole: ['admin', 'editor'], requireAllRoles: true, roleField: 'roles' },
      { roles: ['admin'] }
    )
    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
  })

  it('gates the post-sign-in session on the configured field', async () => {
    const { client, router, user } = renderLogin({
      enablePassword: true,
      requiredRole: 'admin',
      roleField: 'roles',
    })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    client.getSession.mockResolvedValue({ data: { user: { roles: ['admin'] } } })
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin'))
  })
})
