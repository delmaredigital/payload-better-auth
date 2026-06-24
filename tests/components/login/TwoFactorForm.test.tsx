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
})
