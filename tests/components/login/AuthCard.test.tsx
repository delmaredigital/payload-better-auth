import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthCard } from '../../../src/components/login/AuthCard.js'

describe('AuthCard', () => {
  it('renders children and an optional logo', () => {
    render(<AuthCard logo={<span>LOGO</span>}><p>body</p></AuthCard>)
    expect(screen.getByText('LOGO')).toBeInTheDocument()
    expect(screen.getByText('body')).toBeInTheDocument()
  })
})
