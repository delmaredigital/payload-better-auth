import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthButton } from '../../../src/components/login/AuthButton.js'

describe('AuthButton — primary (default)', () => {
  it('renders with its label and button role', () => {
    render(<AuthButton type="submit">Sign In</AuthButton>)
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<AuthButton onClick={onClick}>Click me</AuthButton>)
    await user.click(screen.getByRole('button', { name: 'Click me' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<AuthButton disabled onClick={onClick}>Disabled</AuthButton>)
    await user.click(screen.getByRole('button', { name: 'Disabled' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not render an icon span when no icon prop is given', () => {
    render(<AuthButton>No Icon</AuthButton>)
    const btn = screen.getByRole('button', { name: 'No Icon' })
    expect(btn.querySelector('span')).toBeNull()
  })
})

describe('AuthButton — secondary', () => {
  it('renders with button role and accessible name that includes the icon', () => {
    render(<AuthButton variant="secondary" icon="🔐">Sign in with Passkey</AuthButton>)
    // The icon is rendered inside a <span> within the button; the accessible name
    // includes both the icon text and the children text.
    expect(screen.getByRole('button', { name: /Sign in with Passkey/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /🔐/ })).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<AuthButton variant="secondary" icon="✉" onClick={onClick}>Email me a link</AuthButton>)
    await user.click(screen.getByRole('button', { name: /Email me a link/ }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<AuthButton variant="secondary" icon="✉" disabled onClick={onClick}>Disabled</AuthButton>)
    await user.click(screen.getByRole('button', { name: /Disabled/ }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the icon in a span when icon is provided', () => {
    render(<AuthButton variant="secondary" icon="🔐">With Icon</AuthButton>)
    const btn = screen.getByRole('button', { name: /With Icon/ })
    expect(btn.querySelector('span')).not.toBeNull()
  })
})
