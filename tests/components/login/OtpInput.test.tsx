import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { OtpInput } from '../../../src/components/login/OtpInput.js'

function StatefulOtpInput({ onChange, length }: { onChange: (v: string) => void; length?: number }) {
  const [value, setValue] = useState('')
  return (
    <OtpInput
      id="test-otp"
      value={value}
      onChange={(v) => { setValue(v); onChange(v) }}
      length={length}
    />
  )
}

describe('OtpInput', () => {
  it('strips non-digits: typing "12ab34" yields last onChange call value "1234"', async () => {
    const onChange = vi.fn()
    render(<StatefulOtpInput onChange={onChange} />)
    const input = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(input, '12ab34')
    const lastValue = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastValue).toBe('1234')
  })

  it('caps at 6 digits when 8 digits are typed', async () => {
    const onChange = vi.fn()
    render(<StatefulOtpInput onChange={onChange} />)
    const input = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(input, '12345678')
    const lastValue = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastValue).toBe('123456')
  })

  it('uses custom length to cap digits', async () => {
    const onChange = vi.fn()
    render(<StatefulOtpInput onChange={onChange} length={4} />)
    const input = screen.getByRole('textbox')
    const user = userEvent.setup()
    await user.type(input, '123456')
    const lastValue = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastValue).toBe('1234')
  })

  it('renders with placeholder matching length', () => {
    render(<OtpInput id="test-otp" value="" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('placeholder', '000000')
  })

  it('renders with correct attributes', () => {
    render(<OtpInput id="my-otp" value="123" onChange={vi.fn()} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAttribute('id', 'my-otp')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('required')
  })

  it('focuses the input when autoFocus is true', () => {
    render(<OtpInput id="focus-otp" value="" onChange={vi.fn()} autoFocus />)
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('does not focus the input when autoFocus is omitted', () => {
    render(<OtpInput id="no-focus-otp" value="" onChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })
})
