import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthBanner } from '../../../src/components/login/AuthBanner.js'

describe('AuthBanner', () => {
  it('renders kind="error" with role="alert" containing the message', () => {
    render(<AuthBanner kind="error">Something went wrong</AuthBanner>)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Something went wrong')
  })

  it('renders kind="success" with role="alert" containing the message', () => {
    render(<AuthBanner kind="success">Account created!</AuthBanner>)
    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Account created!')
  })

  it('sets aria-live="polite" on the alert element', () => {
    render(<AuthBanner kind="error">Error</AuthBanner>)
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite')
  })
})
