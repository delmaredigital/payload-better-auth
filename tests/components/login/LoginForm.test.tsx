import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from '../../../src/components/login/LoginForm.js'

const defaultProps = {
  logo: undefined,
  title: 'Login',
  successMessage: null,
  error: null,
  email: '',
  onEmailChange: vi.fn(),
  passwordAvailable: false,
  password: '',
  onPasswordChange: vi.fn(),
  forgotPasswordAvailable: false,
  onForgotPassword: vi.fn(),
  onSubmit: vi.fn(),
  primaryLabel: 'Sign In',
  actionsDisabled: false,
  secondaryMethods: [],
  showEmptyState: false,
  signUpAvailable: false,
  onCreateAccount: vi.fn(),
}

describe('LoginForm', () => {
  it('always renders the email field', () => {
    render(<LoginForm {...defaultProps} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('focuses the email field on render', () => {
    render(<LoginForm {...defaultProps} />)
    expect(screen.getByLabelText('Email')).toHaveFocus()
  })

  it('shows password field when passwordAvailable is true', () => {
    render(<LoginForm {...defaultProps} passwordAvailable={true} />)
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('hides password field when passwordAvailable is false', () => {
    render(<LoginForm {...defaultProps} passwordAvailable={false} />)
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('shows "Forgot password?" when both passwordAvailable and forgotPasswordAvailable are true', () => {
    render(<LoginForm {...defaultProps} passwordAvailable={true} forgotPasswordAvailable={true} />)
    expect(screen.getByText('Forgot password?')).toBeInTheDocument()
  })

  it('hides "Forgot password?" when passwordAvailable is false', () => {
    render(<LoginForm {...defaultProps} passwordAvailable={false} forgotPasswordAvailable={true} />)
    expect(screen.queryByText('Forgot password?')).not.toBeInTheDocument()
  })

  it('hides "Forgot password?" when forgotPasswordAvailable is false', () => {
    render(<LoginForm {...defaultProps} passwordAvailable={true} forgotPasswordAvailable={false} />)
    expect(screen.queryByText('Forgot password?')).not.toBeInTheDocument()
  })

  it('calls onForgotPassword when "Forgot password?" is clicked', async () => {
    const onForgotPassword = vi.fn()
    render(<LoginForm {...defaultProps} passwordAvailable={true} forgotPasswordAvailable={true} onForgotPassword={onForgotPassword} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Forgot password?'))
    expect(onForgotPassword).toHaveBeenCalledTimes(1)
  })

  it('renders the primaryLabel on the submit button', () => {
    render(<LoginForm {...defaultProps} primaryLabel="Send Magic Link" />)
    expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument()
  })

  it('disables the primary button when actionsDisabled is true', () => {
    render(<LoginForm {...defaultProps} actionsDisabled={true} />)
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled()
  })

  it('enables the primary button when actionsDisabled is false', () => {
    render(<LoginForm {...defaultProps} actionsDisabled={false} />)
    expect(screen.getByRole('button', { name: 'Sign In' })).not.toBeDisabled()
  })

  it('renders one secondary button per secondaryMethods entry', () => {
    const secondaryMethods = [
      { key: 'passkey', icon: '🔐', label: 'Sign in with Passkey', onClick: vi.fn(), busy: false },
      { key: 'magicLink', icon: '✉', label: 'Email me a link', onClick: vi.fn(), busy: false },
    ]
    render(<LoginForm {...defaultProps} secondaryMethods={secondaryMethods} />)
    expect(screen.getByRole('button', { name: /Sign in with Passkey/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Email me a link/ })).toBeInTheDocument()
  })

  it('fires each secondary button onClick', async () => {
    const onClick1 = vi.fn()
    const onClick2 = vi.fn()
    const secondaryMethods = [
      { key: 'passkey', icon: '🔐', label: 'Sign in with Passkey', onClick: onClick1, busy: false },
      { key: 'magicLink', icon: '✉', label: 'Email me a link', onClick: onClick2, busy: false },
    ]
    render(<LoginForm {...defaultProps} secondaryMethods={secondaryMethods} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Sign in with Passkey/ }))
    expect(onClick1).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Email me a link/ }))
    expect(onClick2).toHaveBeenCalledTimes(1)
  })

  it('disables secondary buttons when actionsDisabled is true', () => {
    const secondaryMethods = [
      { key: 'passkey', icon: '🔐', label: 'Sign in with Passkey', onClick: vi.fn(), busy: false },
    ]
    render(<LoginForm {...defaultProps} actionsDisabled={true} secondaryMethods={secondaryMethods} />)
    expect(screen.getByRole('button', { name: /Sign in with Passkey/ })).toBeDisabled()
  })

  it('disables a secondary button when method.busy is true (even if actionsDisabled is false)', () => {
    const secondaryMethods = [
      { key: 'passkey', icon: '🔐', label: 'Sign in with Passkey', onClick: vi.fn(), busy: true },
    ]
    render(<LoginForm {...defaultProps} actionsDisabled={false} secondaryMethods={secondaryMethods} />)
    expect(screen.getByRole('button', { name: /Sign in with Passkey/ })).toBeDisabled()
  })

  it('shows the empty-state message when showEmptyState is true', () => {
    render(<LoginForm {...defaultProps} showEmptyState={true} />)
    expect(screen.getByText(/No sign-in methods are currently enabled/)).toBeInTheDocument()
  })

  it('hides the empty-state message when showEmptyState is false', () => {
    render(<LoginForm {...defaultProps} showEmptyState={false} />)
    expect(screen.queryByText(/No sign-in methods are currently enabled/)).not.toBeInTheDocument()
  })

  it('shows "Create account" link when signUpAvailable is true', () => {
    render(<LoginForm {...defaultProps} signUpAvailable={true} />)
    expect(screen.getByText('Create account')).toBeInTheDocument()
  })

  it('hides "Create account" link when signUpAvailable is false', () => {
    render(<LoginForm {...defaultProps} signUpAvailable={false} />)
    expect(screen.queryByText('Create account')).not.toBeInTheDocument()
  })

  it('calls onCreateAccount when "Create account" is clicked', async () => {
    const onCreateAccount = vi.fn()
    render(<LoginForm {...defaultProps} signUpAvailable={true} onCreateAccount={onCreateAccount} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('Create account'))
    expect(onCreateAccount).toHaveBeenCalledTimes(1)
  })

  it('renders successMessage banner when set', () => {
    render(<LoginForm {...defaultProps} successMessage="Check your email!" />)
    expect(screen.getByText('Check your email!')).toBeInTheDocument()
  })

  it('does not render successMessage banner when null', () => {
    render(<LoginForm {...defaultProps} successMessage={null} />)
    // No success banner content visible
    expect(screen.queryByText('Check your email!')).not.toBeInTheDocument()
  })

  it('renders error banner when error is set', () => {
    render(<LoginForm {...defaultProps} error="Invalid credentials" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Invalid credentials')).toBeInTheDocument()
  })

  it('does not render error banner when error is null', () => {
    render(<LoginForm {...defaultProps} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders the title', () => {
    render(<LoginForm {...defaultProps} title="Welcome Back" />)
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument()
  })

  it('renders an icon-less secondary button as text-only and fires its onClick', async () => {
    const onClick = vi.fn()
    const secondaryMethods = [
      { key: 'social:google', label: 'Continue with Google', onClick, busy: false },
    ]
    render(<LoginForm {...defaultProps} secondaryMethods={secondaryMethods} />)
    const button = screen.getByRole('button', { name: 'Continue with Google' })
    expect(button).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
