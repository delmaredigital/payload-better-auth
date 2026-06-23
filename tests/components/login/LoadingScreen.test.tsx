import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingScreen } from '../../../src/components/login/LoadingScreen.js'

describe('LoadingScreen', () => {
  it('renders "Loading..." text in the document', () => {
    render(<LoadingScreen />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})
