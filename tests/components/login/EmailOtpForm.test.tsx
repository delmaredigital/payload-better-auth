import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailOtpForm } from '../../../src/components/login/EmailOtpForm.js'

const defaultProps = {
  email: 'user@example.com',
  code: '',
  onCodeChange: vi.fn(),
  onSubmit: vi.fn(),
  onBack: vi.fn(),
  loading: false,
  error: null,
}

describe('EmailOtpForm', () => {
  it('renders the Enter Your Code heading', () => {
    render(<EmailOtpForm {...defaultProps} />)
    expect(screen.getByText('Enter Your Code')).toBeInTheDocument()
  })

  it('renders the email in the subtitle', () => {
    render(<EmailOtpForm {...defaultProps} email="test@example.com" />)
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
  })

  it('submit button is disabled when code is fewer than 6 characters', () => {
    render(<EmailOtpForm {...defaultProps} code="12" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).toBeDisabled()
  })

  it('submit button is disabled when code is empty', () => {
    render(<EmailOtpForm {...defaultProps} code="" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).toBeDisabled()
  })

  it('submit button is enabled when code is 6 characters', () => {
    render(<EmailOtpForm {...defaultProps} code="123456" />)
    const button = screen.getByRole('button', { name: 'Verify' })
    expect(button).not.toBeDisabled()
  })

  it('calls onSubmit when form is submitted', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<EmailOtpForm {...defaultProps} code="123456" onSubmit={onSubmit} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('calls onBack when Back to login button is clicked', async () => {
    const onBack = vi.fn()
    render(<EmailOtpForm {...defaultProps} onBack={onBack} />)
    const user = userEvent.setup()
    await user.click(screen.getByText('← Back to login'))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('shows error banner when error is set', () => {
    render(<EmailOtpForm {...defaultProps} error="Invalid code" />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Invalid code')).toBeInTheDocument()
  })

  it('does not show error banner when error is null', () => {
    render(<EmailOtpForm {...defaultProps} error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows Verifying... label when loading', () => {
    render(<EmailOtpForm {...defaultProps} code="123456" loading={true} />)
    expect(screen.getByRole('button', { name: 'Verifying...' })).toBeInTheDocument()
  })

  it('submit button is disabled when loading', () => {
    render(<EmailOtpForm {...defaultProps} code="123456" loading={true} />)
    const button = screen.getByRole('button', { name: 'Verifying...' })
    expect(button).toBeDisabled()
  })
})
