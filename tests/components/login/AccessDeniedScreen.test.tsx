import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccessDeniedScreen } from '../../../src/components/login/AccessDeniedScreen.js'

describe('AccessDeniedScreen', () => {
  it('renders "Access Denied" heading', () => {
    render(<AccessDeniedScreen onSignOut={() => {}} />)
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
  })

  it('calls onSignOut when "Sign out and try again" is clicked', async () => {
    const onSignOut = vi.fn()
    render(<AccessDeniedScreen onSignOut={onSignOut} />)
    await userEvent.click(screen.getByText('Sign out and try again'))
    expect(onSignOut).toHaveBeenCalledOnce()
  })

  it('does not render a logo', () => {
    render(<AccessDeniedScreen onSignOut={() => {}} />)
    // The component takes no logo prop; assert the heading is present
    // and no logo placeholder is rendered (AuthCard center variant, no logo slot)
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
