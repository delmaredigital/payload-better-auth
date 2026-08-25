import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderLogin } from './_harness.js'

/**
 * Better Auth's sign-in response reports the second factors THIS user holds
 * (`twoFactorMethods`). The step follows that list rather than always opening
 * on the authenticator app.
 */
async function signInTo2FA(
  props: Record<string, unknown>,
  twoFactorMethods?: string[],
) {
  const { client, user } = renderLogin({ enablePassword: true, ...props })
  client.signIn.email.mockResolvedValue({
    data: twoFactorMethods ? { twoFactorRedirect: true, twoFactorMethods } : { twoFactorRedirect: true },
  })
  await user.type(await screen.findByLabelText('Email'), 'a@b.com')
  await user.type(screen.getByLabelText('Password'), 'pw12345678')
  await user.click(screen.getByRole('button', { name: 'Sign In' }))
  await screen.findByText('Two-Factor Authentication')
  return { client, user }
}

describe('LoginView — per-user two-factor methods', () => {
  it('opens on the emailed code when the user has no authenticator', async () => {
    const { client } = await signInTo2FA({ enableTwoFactorEmailOtp: true }, ['otp'])

    // The code is sent on arrival, not after a click the user can't discover.
    await waitFor(() => expect(client.twoFactor.sendOtp).toHaveBeenCalled())
    expect(await screen.findByLabelText('Emailed Code')).toBeInTheDocument()
    // No dead link back to an authenticator this user never set up.
    expect(screen.queryByText('Use your authenticator app')).not.toBeInTheDocument()
  })

  it('opens on the backup code when the server reports no factors at all', async () => {
    await signInTo2FA({ enableTwoFactorEmailOtp: true }, [])
    expect(await screen.findByLabelText('Backup Code')).toBeInTheDocument()
    expect(screen.queryByText('Use your authenticator app')).not.toBeInTheDocument()
    expect(screen.queryByText('Email me a code')).not.toBeInTheDocument()
  })

  it('hides the emailed code when the server did not report it for this user', async () => {
    const { client } = await signInTo2FA({ enableTwoFactorEmailOtp: true }, ['totp'])
    expect(await screen.findByLabelText('Verification Code')).toBeInTheDocument()
    expect(screen.queryByText('Email me a code')).not.toBeInTheDocument()
    expect(client.twoFactor.sendOtp).not.toHaveBeenCalled()
  })

  it('offers both when the user holds both', async () => {
    await signInTo2FA({ enableTwoFactorEmailOtp: true }, ['totp', 'otp'])
    expect(await screen.findByLabelText('Verification Code')).toBeInTheDocument()
    expect(screen.getByText('Email me a code')).toBeInTheDocument()
  })

  it('still honours enableTwoFactorEmailOtp: false as a ceiling', async () => {
    await signInTo2FA({ enableTwoFactorEmailOtp: false }, ['otp'])
    expect(screen.queryByText('Email me a code')).not.toBeInTheDocument()
    // Nothing else on offer, so the backup escape hatch owns the step.
    expect(await screen.findByLabelText('Backup Code')).toBeInTheDocument()
  })

  it('falls back to the configured behaviour when the server reports nothing', async () => {
    // A Better Auth build that omits twoFactorMethods: keep the old default.
    await signInTo2FA({ enableTwoFactorEmailOtp: true })
    expect(await screen.findByLabelText('Verification Code')).toBeInTheDocument()
    expect(screen.getByText('Email me a code')).toBeInTheDocument()
  })
})

describe('LoginView — configured code lengths', () => {
  it('gates the two-factor submit on the configured TOTP digits', async () => {
    const { user } = await signInTo2FA({ otpLengths: { twoFactorTotp: 8 } }, ['totp'])
    expect(screen.getByText(/Enter the 8-digit code/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Verification Code'), '123456')
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    await user.type(screen.getByLabelText('Verification Code'), '78')
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled()
  })

  it('gates the sign-in email-OTP submit on the configured otpLength', async () => {
    const { user } = renderLogin({
      enablePassword: false,
      enableEmailOtp: true,
      otpLengths: { emailOtp: 4 },
    })
    await user.type(await screen.findByLabelText('Email'), 'a@b.com')
    await user.click(screen.getByRole('button', { name: /Email me a code/ }))

    const input = await screen.findByLabelText('Verification Code')
    await user.type(input, '1234')
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled()
    // The input itself stops at the configured length.
    await user.type(input, '56')
    expect(input).toHaveValue('1234')
  })
})
