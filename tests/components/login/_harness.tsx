import { vi } from 'vitest'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginView, type LoginViewProps } from '../../../src/components/LoginView.js'

const push = vi.fn()
const refresh = vi.fn()

vi.mock('next/navigation.js', () => ({
  useRouter: () => ({ push, refresh }),
}))
vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))
// Defensive: code paths that build a client shouldn't pull real better-auth internals.
vi.mock('better-auth/react', () => ({ createAuthClient: () => makeClient() }))
vi.mock('better-auth/client/plugins', () => ({
  twoFactorClient: () => ({}),
  magicLinkClient: () => ({}),
  emailOTPClient: () => ({}),
}))
vi.mock('@better-auth/passkey/client', () => ({ passkeyClient: () => ({}) }))

export type FakeClient = ReturnType<typeof makeClient>

export function makeClient(overrides: Record<string, unknown> = {}) {
  const ok = async () => ({ data: {}, error: null })
  const client = {
    getSession: vi.fn(async () => ({ data: null as null | { user: unknown } })),
    signIn: {
      email: vi.fn(ok),
      magicLink: vi.fn(ok),
      passkey: vi.fn(ok),
      emailOtp: vi.fn(ok),
      social: vi.fn(ok),
    },
    signUp: { email: vi.fn(ok) },
    emailOtp: { sendVerificationOtp: vi.fn(ok) },
    twoFactor: { verifyTotp: vi.fn(ok) },
    requestPasswordReset: vi.fn(ok),
    signOut: vi.fn(async () => ({})),
  }
  return Object.assign(client, overrides)
}

// `sessionUser` seeds what getSession returns ON MOUNT: null (default) → form shows;
// an object → the mount role-gate runs (used for the access-denied case).
export function renderLogin(
  props: Partial<LoginViewProps> = {},
  sessionUser: { role?: unknown } | null = null,
  clientOverrides: Record<string, unknown> = {},
) {
  push.mockClear()
  refresh.mockClear()
  const client = makeClient(clientOverrides)
  client.getSession.mockResolvedValue({ data: sessionUser ? { user: sessionUser } : null })
  const user = userEvent.setup()
  const utils = render(<LoginView authClient={client} {...props} />)
  return { client, router: { push, refresh }, user, ...utils }
}
