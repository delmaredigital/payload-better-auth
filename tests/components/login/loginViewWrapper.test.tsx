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
  function fakePayload(betterAuth: unknown, login: Record<string, unknown> = {}) {
    return {
      config: { custom: { betterAuth: { login, authBasePath: '/auth' } } },
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
})
