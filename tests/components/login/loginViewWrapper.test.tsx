/**
 * `resolveLoginViewProps` against a REAL Better Auth instance.
 *
 * Lives here (dom project) rather than beside the pure detection tests because it
 * imports the wrapper, which pulls in the Payload UI component tree.
 *
 * Covers the two things the resolver owes the login page: providers Better Auth
 * actually resolved (built-in AND genericOAuth — issue #32), and a login form that
 * still renders when the auth context fails to resolve at all.
 */
import { describe, it, expect, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import { resolveLoginViewProps } from '../../../src/components/LoginViewWrapper.js'
import { hasAnyRole } from '../../../src/utils/access.js'

// The wrapper imports LoginView, which pulls the Payload UI tree (and its CSS) into
// the module graph. The resolver never renders, so stub the leaves.
vi.mock('next/navigation.js', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
}))
vi.mock('better-auth/react', () => ({ createAuthClient: () => ({}) }))
vi.mock('better-auth/client/plugins', () => ({
  twoFactorClient: () => ({}),
  magicLinkClient: () => ({}),
  emailOTPClient: () => ({}),
}))

const base = {
  baseURL: 'http://localhost:3000',
  secret: 'test-secret-that-is-long-enough-000000',
  database: memoryAdapter({}),
} as const

const oauthCreds = { clientId: 'client-id', clientSecret: 'client-secret' }

describe('resolveLoginViewProps', () => {
  /** Minimal Payload stand-in: the resolver only reads config.custom, logger and betterAuth. */
  function fakePayload(
    betterAuth: unknown,
    login: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
  ) {
    return {
      config: { custom: { betterAuth: { login, authBasePath: '/auth', ...extra } } },
      logger: { error: vi.fn() },
      betterAuth,
    }
  }

  it('surfaces built-in and generic providers together when enableSocial is true', async () => {
    const auth = betterAuth({
      ...base,
      emailAndPassword: { enabled: true },
      socialProviders: { github: oauthCreds },
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: 'zitadel',
              name: 'Company SSO',
              ...oauthCreds,
              authorizationUrl: 'https://idp.example.com/oauth/v2/authorize',
              tokenUrl: 'https://idp.example.com/oauth/v2/token',
              accountIssuer: 'https://idp.example.com',
            },
          ],
        }),
      ],
    } as Parameters<typeof betterAuth>[0])

    const payload = fakePayload(auth, { enableSocial: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = await resolveLoginViewProps(payload as any)
    expect(props.socialProviders).toEqual([
      { id: 'zitadel', label: 'Company SSO' },
      { id: 'github', label: 'GitHub' },
    ])
    expect(props.enablePassword).toBe(true)
  })

  it('keeps rendering password sign-in, without social buttons, when $context rejects', async () => {
    const broken = {
      options: { emailAndPassword: { enabled: true } },
      $context: Promise.reject(new Error('discovery failed for "zitadel"')),
    }
    const payload = fakePayload(broken, { enableSocial: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = await resolveLoginViewProps(payload as any)
    expect(props.enablePassword).toBe(true)
    expect(props.socialProviders).toEqual([])
    expect(payload.logger.error).toHaveBeenCalledTimes(1)
  })

  it('passes the configured roleField to the login view', async () => {
    const auth = betterAuth({ ...base, emailAndPassword: { enabled: true } })
    const payload = fakePayload(auth, {}, { roleField: 'roles' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = await resolveLoginViewProps(payload as any)
    expect(props.roleField).toBe('roles')
  })

  it("passes 'role' when no roleField is configured", async () => {
    const auth = betterAuth({ ...base, emailAndPassword: { enabled: true } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = await resolveLoginViewProps(fakePayload(auth) as any)
    expect(props.roleField).toBe('role')
  })

  it('maps roleField to the session key when fieldName renames it (real session)', async () => {
    // The stored/Payload field is `roles`, but the session user keys the field
    // by its Better Auth schema key, `role`. A hand-built session object hides
    // this — so sign in against a real betterAuth() and read its session.
    const auth = betterAuth({
      ...base,
      // The memory adapter creates tables lazily on insert but throws reading
      // an absent one, and sign-up reads `user` first — seed the tables.
      database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      emailAndPassword: { enabled: true },
      user: {
        additionalFields: {
          role: { type: 'string', fieldName: 'roles' },
        },
      },
    } as Parameters<typeof betterAuth>[0])
    const payload = fakePayload(auth, {}, { roleField: 'roles' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = await resolveLoginViewProps(payload as any)
    expect(props.roleField).toBe('role')

    const { headers } = await auth.api.signUpEmail({
      body: {
        name: 'Admin',
        email: 'admin@example.com',
        password: 'pw12345678',
        role: 'admin',
      },
      returnHeaders: true,
    })
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: headers.get('set-cookie') ?? '' }),
    })
    const sessionUser = session?.user as Record<string, unknown>
    // Real session output: the role sits on `role`, never on `roles`.
    expect(sessionUser.role).toBe('admin')
    expect(sessionUser.roles).toBeUndefined()
    // The gate LoginView runs must pass a real admin with this prop value.
    expect(hasAnyRole(sessionUser, ['admin'], props.roleField!)).toBe(true)
  })
})
