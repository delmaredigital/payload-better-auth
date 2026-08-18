import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))

import { TwoFactorSetupView } from '../../../src/components/twoFactor/TwoFactorSetupView.js'

const fetchMock = vi.fn()

const enableOk = async () => ({
  ok: true,
  json: async () => ({
    totpURI: 'otpauth://totp/Test?secret=ABC123',
    secret: 'ABC123',
    backupCodes: ['AAAAA-BBBBB'],
  }),
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('TwoFactorSetupView password step', () => {
  it('asks for the password first — no enable request on mount', () => {
    render(<TwoFactorSetupView />)
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enables with the entered password, then shows the QR step', async () => {
    fetchMock.mockImplementation(enableOk)
    const user = userEvent.setup()
    render(<TwoFactorSetupView />)

    await user.type(screen.getByLabelText('Password'), 'hunter2222')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText(/Scan the QR code/)).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/auth/two-factor/enable')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ password: 'hunter2222' })
  })

  it('stays on the password step and surfaces the error when enable fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Invalid password' }) })
    const user = userEvent.setup()
    render(<TwoFactorSetupView />)

    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('Invalid password')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('offers a passwordless path that enables without a password', async () => {
    fetchMock.mockImplementation(enableOk)
    const user = userEvent.setup()
    render(<TwoFactorSetupView />)

    await user.click(screen.getByRole('button', { name: 'My account has no password' }))

    expect(await screen.findByText(/Scan the QR code/)).toBeInTheDocument()
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({})
  })
})
