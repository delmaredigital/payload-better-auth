import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterForm } from '../../../src/components/login/RegisterForm.js'

const defaultProps = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  onNameChange: vi.fn(),
  onEmailChange: vi.fn(),
  onPasswordChange: vi.fn(),
  onConfirmPasswordChange: vi.fn(),
  onSubmit: vi.fn(),
  onBackToLogin: vi.fn(),
  loading: false,
  error: null,
}

describe('RegisterForm', () => {
  it('renders "Create Account" heading', () => {
    render(<RegisterForm {...defaultProps} />)
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument()
  })

  it('renders all four fields', () => {
    render(<RegisterForm {...defaultProps} />)
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument()
  })

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<RegisterForm {...defaultProps} name="Alice" email="alice@example.com" password="secret123" confirmPassword="secret123" onSubmit={onSubmit} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onBackToLogin when "Sign in" link is clicked', async () => {
    const onBackToLogin = vi.fn()
    render(<RegisterForm {...defaultProps} onBackToLogin={onBackToLogin} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onBackToLogin).toHaveBeenCalledTimes(1)
  })

  it('shows "Creating account..." label when loading', () => {
    render(<RegisterForm {...defaultProps} loading={true} />)
    expect(screen.getByRole('button', { name: 'Creating account...' })).toBeInTheDocument()
  })

  it('submit button is disabled when loading', () => {
    render(<RegisterForm {...defaultProps} loading={true} />)
    expect(screen.getByRole('button', { name: 'Creating account...' })).toBeDisabled()
  })

  it('shows error banner when error is set', () => {
    render(<RegisterForm {...defaultProps} error="Passwords do not match" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
  })

  it('does not show error banner when error is null', () => {
    render(<RegisterForm {...defaultProps} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
