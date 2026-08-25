import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))

import { TwoFactorSetupView } from '../../../src/components/twoFactor/TwoFactorSetupView.js'
import { TwoFactorSetupViewWrapper } from '../../../src/components/twoFactor/TwoFactorSetupViewWrapper.js'

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
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      password: 'hunter2222',
      method: 'totp',
    })
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

})

describe('TwoFactorSetupView passwordless account', () => {
  it('starts enablement on mount without asking for a password', async () => {
    fetchMock.mockImplementation(enableOk)
    render(<TwoFactorSetupView hasPassword={false} />)

    expect(await screen.findByText(/Scan the QR code/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/auth/two-factor/enable')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ method: 'totp' })
  })

  it('confirms copying and offers a download on the backup-codes step', async () => {
    fetchMock.mockImplementation(enableOk) // enable and verify both succeed
    const user = userEvent.setup() // installs a working clipboard stub
    render(<TwoFactorSetupView hasPassword={false} />)

    await user.type(await screen.findByLabelText('Verification Code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and Enable' }))
    expect(await screen.findByText('Save Your Backup Codes')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy to Clipboard' }))
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
    expect(await window.navigator.clipboard.readText()).toBe('AAAAA-BBBBB')
  })

  it('surfaces the error and offers a retry when enablement fails', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ message: 'Two factor cannot be enabled' }),
    })
    fetchMock.mockImplementation(enableOk)
    const user = userEvent.setup()
    render(<TwoFactorSetupView hasPassword={false} />)

    expect(await screen.findByText('Two factor cannot be enabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Scan the QR code/)).toBeInTheDocument()
  })
})

describe('TwoFactorSetupViewWrapper', () => {
  const makeInitPageResult = (accounts: { providerId: string }[] | Error) =>
    ({
      req: {
        headers: new Headers(),
        payload: {
          betterAuth: {
            api: {
              listUserAccounts: vi.fn(async () => {
                if (accounts instanceof Error) throw accounts
                return accounts
              }),
            },
          },
        },
      },
    }) as never

  it('renders the password step when the user holds a credential account', async () => {
    render(
      await TwoFactorSetupViewWrapper({
        initPageResult: makeInitPageResult([
          { providerId: 'google' },
          { providerId: 'credential' },
        ]),
      } as never)
    )
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starts enablement directly for a passwordless account', async () => {
    fetchMock.mockImplementation(enableOk)
    render(
      await TwoFactorSetupViewWrapper({
        initPageResult: makeInitPageResult([{ providerId: 'google' }]),
      } as never)
    )
    expect(await screen.findByText(/Scan the QR code/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('falls back to the password step when accounts cannot be read', async () => {
    render(
      await TwoFactorSetupViewWrapper({
        initPageResult: makeInitPageResult(new Error('no session')),
      } as never)
    )
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})
