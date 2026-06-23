import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderLogin } from './_harness.js'

describe('login harness', () => {
  it('renders the login form email field once the session check resolves', async () => {
    renderLogin({ enablePassword: true })
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
  })
})
