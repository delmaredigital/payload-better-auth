import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthField } from '../../../src/components/login/AuthField.js'

describe('AuthField', () => {
  it('renders a labeled input that resolves via getByLabelText', () => {
    render(
      <AuthField
        id="email"
        label="Email"
        type="email"
        value=""
        onChange={() => {}}
        autoComplete="email"
      />
    )
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('associates label with input via htmlFor/id', () => {
    render(
      <AuthField
        id="password"
        label="Password"
        type="password"
        value=""
        onChange={() => {}}
        autoComplete="current-password"
      />
    )
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('id', 'password')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
  })

  it('calls onChange when the user types into the field', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <AuthField
        id="test-field"
        label="Name"
        type="text"
        value=""
        onChange={onChange}
        autoComplete="name"
      />
    )
    await user.type(screen.getByLabelText('Name'), 'Alice')
    expect(onChange).toHaveBeenCalled()
  })

  it('forwards the inputRef to the underlying input element', () => {
    let capturedRef: HTMLInputElement | null = null
    render(
      <AuthField
        id="ref-field"
        label="Ref Field"
        type="text"
        value=""
        onChange={() => {}}
        inputRef={(el) => { capturedRef = el }}
      />
    )
    expect(capturedRef).not.toBeNull()
    expect((capturedRef as HTMLInputElement | null)?.id).toBe('ref-field')
  })
})
