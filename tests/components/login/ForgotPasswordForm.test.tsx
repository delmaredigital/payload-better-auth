import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ForgotPasswordForm } from '../../../src/components/login/ForgotPasswordForm.js'

const defaultProps = {
  email: '',
  onEmailChange: vi.fn(),
  onSubmit: vi.fn(),
  onBack: vi.fn(),
  loading: false,
  error: null,
}

describe('ForgotPasswordForm', () => {
  it('renders "Reset Password" heading', () => {
    render(<ForgotPasswordForm {...defaultProps} />)
    expect(screen.getByText('Reset Password')).toBeInTheDocument()
  })

  it('renders the email field', () => {
    render(<ForgotPasswordForm {...defaultProps} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<ForgotPasswordForm {...defaultProps} email="user@example.com" onSubmit={onSubmit} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Send Reset Link' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn()
    render(<ForgotPasswordForm {...defaultProps} onBack={onBack} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('← Back to login'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows "Sending..." label when loading', () => {
    render(<ForgotPasswordForm {...defaultProps} loading={true} />)
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeInTheDocument()
  })

  it('submit button is disabled when loading', () => {
    render(<ForgotPasswordForm {...defaultProps} loading={true} />)
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
  })

  it('shows error banner when error is set', () => {
    render(<ForgotPasswordForm {...defaultProps} error="Something went wrong" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('does not show error banner when error is null', () => {
    render(<ForgotPasswordForm {...defaultProps} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
