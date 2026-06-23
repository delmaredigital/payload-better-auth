import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

function Hello({ name }: { name: string }) {
  return <p>Hello {name}</p>
}

describe('dom test environment', () => {
  it('renders a React component into jsdom', () => {
    render(<Hello name="world" />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })
})
