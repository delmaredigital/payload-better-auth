import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OrDivider } from '../../../src/components/login/OrDivider.js'

describe('OrDivider', () => {
  it('renders the "or" label', () => {
    render(<OrDivider />)
    expect(screen.getByText('or')).toBeInTheDocument()
  })
})
