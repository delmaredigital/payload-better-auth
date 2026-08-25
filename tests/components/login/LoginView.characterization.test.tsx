import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderLogin } from './_harness.js'

const ADMIN = { data: { user: { role: 'admin' } } }

describe('LoginView — login screen', () => {
  it('shows the password field when enablePassword is true', async () => {
    renderLogin({ enablePassword: true })
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('hides the password field and forgot link when enablePassword is false', async () => {
    renderLogin({ enablePassword: false, enableMagicLink: true })
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByText('Forgot password?')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument()
  })

  it('renders passkey / magic-link / email-OTP secondary buttons per props', async () => {
    renderLogin({ enablePassword: true, enablePasskey: true, enableMagicLink: true, enableEmailOtp: true })
    expect(await screen.findByRole('button', { name: /Sign in with Passkey/ })).toBeInTheDocument()
    // Secondary buttons render as "<icon><label>" — match by text content (label portion)
    expect(screen.getByRole('button', { name: /Email me a link/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Email me a code/ })).toBeInTheDocument()
  })

  it('shows Create account and Forgot password when enabled', async () => {
    renderLogin({ enablePassword: true, enableSignUp: true, enableForgotPassword: true })
    expect(await screen.findByText('Create account')).toBeInTheDocument()
    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
  })

  it('renders the empty-state when no method is available', async () => {
    renderLogin({ enablePassword: false, enableMagicLink: false, enableEmailOtp: false, enablePasskey: false, enableSignUp: false })
    expect(await screen.findByText(/No sign-in methods are currently enabled/)).toBeInTheDocument()
  })
})

describe('LoginView — flows', () => {
  it('calls signIn.email and redirects an admin to afterLoginPath', async () => {
    // sessionUser=null → mount shows the form (getSession resolves null first).
    const { client, router, user } = renderLogin({ enablePassword: true })
    client.signIn.email.mockResolvedValue(ADMIN)
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    // Now that the mount getSession has resolved (form is shown), make the
    // post-sign-in completeSignIn() getSession return an admin.
    client.getSession.mockResolvedValue(ADMIN)
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(client.signIn.email).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw12345678' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin'))
  })

  it('switches to the TOTP view on twoFactorRedirect', async () => {
    const { client, user } = renderLogin({ enablePassword: true })
    client.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true } })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByText('Two-Factor Authentication')).toBeInTheDocument()
  })

  it('verifies a backup code from the 2FA step', async () => {
    const { client, user } = renderLogin({ enablePassword: true })
    client.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true } })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await screen.findByText('Two-Factor Authentication')
    client.getSession.mockResolvedValue({ data: { user: { role: 'admin' } } })

    await user.click(screen.getByText('Use a backup code'))
    await user.type(screen.getByLabelText('Backup Code'), 'A1B2C-D3E4F')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() =>
      expect(client.twoFactor.verifyBackupCode).toHaveBeenCalledWith({ code: 'A1B2C-D3E4F' }),
    )
    expect(client.twoFactor.verifyTotp).not.toHaveBeenCalled()
  })

  it('sends and verifies an emailed second-factor code when enabled', async () => {
    const { client, user } = renderLogin({
      enablePassword: true,
      enableTwoFactorEmailOtp: true,
    })
    client.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true } })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await screen.findByText('Two-Factor Authentication')
    client.getSession.mockResolvedValue({ data: { user: { role: 'admin' } } })

    await user.click(screen.getByText('Email me a code'))
    await waitFor(() => expect(client.twoFactor.sendOtp).toHaveBeenCalled())
    await user.type(screen.getByLabelText('Emailed Code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() =>
      expect(client.twoFactor.verifyOtp).toHaveBeenCalledWith({ code: '123456' }),
    )
  })

  it('hides the emailed-code option on the 2FA step by default', async () => {
    const { client, user } = renderLogin({ enablePassword: true })
    client.signIn.email.mockResolvedValue({ data: { twoFactorRedirect: true } })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'pw12345678')
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    await screen.findByText('Two-Factor Authentication')
    expect(screen.queryByText('Email me a code')).not.toBeInTheDocument()
  })

  it('sends an email OTP and shows the code entry view', async () => {
    const { client, user } = renderLogin({ enablePassword: false, enableEmailOtp: true })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'Email me a code' }))
    await waitFor(() => expect(client.emailOtp.sendVerificationOtp).toHaveBeenCalledWith({ email: 'a@b.com', type: 'sign-in' }))
    expect(await screen.findByText('Enter Your Code')).toBeInTheDocument()
  })

  it('sends a magic link and shows the sent confirmation', async () => {
    const { client, user } = renderLogin({ enablePassword: false, enableMagicLink: true })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'Email me a link' }))
    await waitFor(() => expect(client.signIn.magicLink).toHaveBeenCalled())
    expect(await screen.findByText('Check Your Email')).toBeInTheDocument()
  })

  it('shows Access Denied when the session user lacks the required role', async () => {
    // sessionUser has a non-admin role → the on-mount role-gate denies access.
    renderLogin({ enablePassword: true, requiredRole: 'admin' }, { role: 'editor' })
    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
  })

  it('does not render the logo on the Access Denied screen', async () => {
    renderLogin({ enablePassword: true, requiredRole: 'admin', logo: <span>BRANDLOGO</span> }, { role: 'editor' })
    expect(await screen.findByText('Access Denied')).toBeInTheDocument()
    expect(screen.queryByText('BRANDLOGO')).not.toBeInTheDocument()
  })
})
