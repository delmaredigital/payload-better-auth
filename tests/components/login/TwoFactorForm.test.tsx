import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TwoFactorForm } from '../../../src/components/login/TwoFactorForm.js'

const defaultProps = {
  code: '',
  onCodeChange: vi.fn(),
  onSubmit: vi.fn(),
  onBack: vi.fn(),
  loading: false,
  error: null,
}

describe('TwoFactorForm', () => {
  it('renders the Two-Factor Authentication heading', () => {
    render(<TwoFactorForm {...defaultProps} />)
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument()
  })

  it('submit button is enabled when code is 6 characters', () => {
    render(<TwoFactorForm {...defaultProps} code="123456" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).not.toBeDisabled()
  })

  it('submit button is disabled when code is fewer than 6 characters', () => {
    render(<TwoFactorForm {...defaultProps} code="12" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).toBeDisabled()
  })

  it('submit button is disabled when code is empty', () => {
    render(<TwoFactorForm {...defaultProps} code="" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).toBeDisabled()
  })

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<TwoFactorForm {...defaultProps} code="123456" onSubmit={onSubmit} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onBack when Back to login button is clicked', async () => {
    const onBack = vi.fn()
    render(<TwoFactorForm {...defaultProps} onBack={onBack} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('← Back to login'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows error banner when error is set', () => {
    render(<TwoFactorForm {...defaultProps} error="Invalid code" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Invalid code')).toBeInTheDocument()
  })

  it('does not show error banner when error is null', () => {
    render(<TwoFactorForm {...defaultProps} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows Verifying... label when loading', () => {
    render(<TwoFactorForm {...defaultProps} code="123456" loading={true} />)
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeInTheDocument()
  })

  it('submit button is disabled when loading', () => {
    render(<TwoFactorForm {...defaultProps} code="123456" loading={true} />)
    const button = screen.getByRole('button', { name: 'Verifying...' })
    expect(button).toBeDisabled()
  })

  it('offers no alternate methods by default', () => {
    render(<TwoFactorForm {...defaultProps} />)
    expect(screen.queryByText('Use a backup code')).not.toBeInTheDocument()
    expect(screen.queryByText('Email me a code')).not.toBeInTheDocument()
  })

  it('offers enabled alternates and reports the picked method', async () => {
    const onMethodChange = vi.fn()
    render(
      <TwoFactorForm
        {...defaultProps}
        enableBackupCode
        enableEmailOtp
        onMethodChange={onMethodChange}
      />,
    )
    const user = userEvent.setup()
    await user.click(screen.getByText('Use a backup code'))
    expect(onMethodChange).toHaveBeenCalledWith('backup')
    await user.click(screen.getByText('Email me a code'))
    expect(onMethodChange).toHaveBeenCalledWith('emailOtp')
  })

  it('backup mode accepts free text and offers the way back to TOTP', async () => {
    const onMethodChange = vi.fn()
    render(
      <TwoFactorForm
        {...defaultProps}
        method="backup"
        code="A1B2C-D3E4F"
        enableBackupCode
        onMethodChange={onMethodChange}
      />,
    )
    // 11-char backup code enables submit (a 6-digit rule would block it).
    expect(screen.getByRole('button', { name: 'Verify' })).not.toBeDisabled()
    expect(screen.getByText(/backup codes you saved/i)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByText('Use your authenticator app'))
    expect(onMethodChange).toHaveBeenCalledWith('totp')
  })

  it('backup mode submit is disabled on an empty code', () => {
    render(<TwoFactorForm {...defaultProps} method="backup" code="  " enableBackupCode />)
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
  })

  it('emailOtp mode shows the resend action', async () => {
    const onResendEmailOtp = vi.fn()
    render(
      <TwoFactorForm
        {...defaultProps}
        method="emailOtp"
        enableEmailOtp
        onResendEmailOtp={onResendEmailOtp}
      />,
    )
    expect(screen.getByText(/emailed you a verification code/i)).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByText('Resend the code'))
    expect(onResendEmailOtp).toHaveBeenCalledTimes(1)
  })
})
