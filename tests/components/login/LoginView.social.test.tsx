import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderLogin } from './_harness.js'

const google = [{ id: 'google', label: 'Google' }]

afterEach(() => {
  // reset jsdom URL between tests (the error-on-return test mutates it)
  window.history.replaceState(null, '', '/')
})

describe('LoginView — social sign-in', () => {
  it('renders a "Continue with {label}" button per resolved provider', async () => {
    renderLogin({ socialProviders: google })
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
  })

  it('renders no social buttons by default (socialProviders defaults to [])', async () => {
    renderLogin({})
    await screen.findByLabelText('Email') // wait for the form to mount
    expect(screen.queryByRole('button', { name: /Continue with/ })).not.toBeInTheDocument()
  })

  it('calls signIn.social with provider, callbackURL and a matching errorCallbackURL', async () => {
    const { client, user } = renderLogin({ socialProviders: google })
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(client.signIn.social).toHaveBeenCalledTimes(1)
    const arg = client.signIn.social.mock.calls[0][0]
    expect(arg.provider).toBe('google')
    expect(typeof arg.callbackURL).toBe('string')
    expect(arg.callbackURL.length).toBeGreaterThan(0)
    // default callbackURL is the login page, and errors return to the same page
    expect(arg.errorCallbackURL).toBe(arg.callbackURL)
  })

  it('uses socialCallbackURL for success but keeps errors on the login page', async () => {
    const { client, user } = renderLogin({
      socialProviders: google,
      socialCallbackURL: 'https://example.com/welcome',
    })
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    const arg = client.signIn.social.mock.calls[0][0]
    const loginUrl = window.location.href.split('?')[0].split('#')[0]
    expect(arg.callbackURL).toBe('https://example.com/welcome')
    expect(arg.errorCallbackURL).toBe(loginUrl)
  })

  it('shows a pending label and disables the button while the request is in flight', async () => {
    const { client, user } = renderLogin({ socialProviders: google })
    let release: (v: unknown) => void = () => {}
    client.signIn.social.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }),
    )
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    const pending = await screen.findByRole('button', { name: 'Connecting to Google…' })
    expect(pending).toBeDisabled()
    release({ data: {}, error: null }) // cleanup
  })

  it('surfaces an error and re-enables the button when the pre-redirect request fails', async () => {
    const { client, user } = renderLogin({ socialProviders: google })
    client.signIn.social.mockResolvedValueOnce({ data: null, error: { message: 'Provider down' } })
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider down')
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled()
  })

  it('reads an ?error= return param into a banner and strips it from the URL', async () => {
    window.history.replaceState(null, '', '/admin/login?error=access_denied')
    renderLogin({ socialProviders: google })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await waitFor(() => expect(window.location.search).toBe(''))
  })

  it('surfaces a generic error and re-enables the button when signIn.social throws', async () => {
    const { client, user } = renderLogin({ socialProviders: google })
    client.signIn.social.mockRejectedValueOnce(new Error('network'))
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled()
  })

  it('renders multiple providers, routes each to its provider id, and cross-locks while one is in flight', async () => {
    const providers = [{ id: 'google', label: 'Google' }, { id: 'github', label: 'GitHub' }]
    const { client, user } = renderLogin({ socialProviders: providers })
    // both render
    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeInTheDocument()
    // make Google hang to assert cross-lock
    let release: (v: unknown) => void = () => {}
    client.signIn.social.mockImplementationOnce(() => new Promise((r) => { release = r }))
    await user.click(screen.getByRole('button', { name: 'Continue with Google' }))
    expect(client.signIn.social.mock.calls[0][0].provider).toBe('google')
    // GitHub button is disabled while Google is in flight (actionsDisabled uses socialLoading !== null)
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeDisabled()
    release({ data: {}, error: null }) // cleanup; with Fix 4 the buttons re-enable
    // after release, GitHub routes to its own id
    await screen.findByRole('button', { name: 'Continue with GitHub' })
    await user.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
    expect(client.signIn.social.mock.calls.at(-1)?.[0].provider).toBe('github')
  })

  it('navigates to data.url when the client returns a URL without auto-redirecting', async () => {
    const realLocation = window.location
    const stub = {
      _href: 'http://localhost:3000/admin/login',
      search: '',
      hash: '',
      get href() { return this._href },
      set href(v: string) { this._href = v },
    }
    Object.defineProperty(window, 'location', { configurable: true, value: stub })
    try {
      const { client, user } = renderLogin({ socialProviders: google })
      client.signIn.social.mockResolvedValueOnce({ data: { url: 'https://provider.example/auth' }, error: null })
      await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))
      await waitFor(() => expect(window.location.href).toBe('https://provider.example/auth'))
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
    }
  })
})
