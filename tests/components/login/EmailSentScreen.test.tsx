import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmailSentScreen } from '../../../src/components/login/EmailSentScreen.js'

describe('EmailSentScreen', () => {
  it('renders the icon and "Check Your Email" heading', () => {
    render(
      <EmailSentScreen
        icon="✓"
        message={<>We've sent a link to <strong>test@example.com</strong></>}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText('Check Your Email')).toBeInTheDocument()
  })

  it('renders the message content', () => {
    render(
      <EmailSentScreen
        icon="✉"
        message={<>We've sent a sign-in link to <strong>user@example.com</strong></>}
        onBack={() => {}}
      />,
    )
    expect(screen.getByText('user@example.com')).toBeInTheDocument()
  })

  it('renders the note paragraph when provided', () => {
    render(
      <EmailSentScreen
        icon="✓"
        message="A message"
        note="Didn't receive the email? Check your spam folder or try again."
        onBack={() => {}}
      />,
    )
    expect(
      screen.getByText("Didn't receive the email? Check your spam folder or try again."),
    ).toBeInTheDocument()
  })

  it('omits the note paragraph when note is not provided', () => {
    render(
      <EmailSentScreen
        icon="✉"
        message="A message"
        onBack={() => {}}
      />,
    )
    expect(
      screen.queryByText(/spam folder/),
    ).toBeNull()
  })

  it('calls onBack when "Back to login" is clicked', async () => {
    const onBack = vi.fn()
    const user = userEvent.setup()
    render(
      <EmailSentScreen
        icon="✓"
        message="A message"
        onBack={onBack}
      />,
    )
    await user.click(screen.getByText('Back to login'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
