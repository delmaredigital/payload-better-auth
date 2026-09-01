/**
 * Detection against a REAL Better Auth instance.
 *
 * The unit tests around `detectSocialProviders` feed it hand-shaped objects, and
 * that is exactly how a login page shipped buttons Better Auth would refuse: the
 * old detector read `options.socialProviders` (raw config), which disagrees with
 * what `/sign-in/social` accepts in three separate ways — a `genericOAuth`
 * provider is merged into the context during plugin `init()` and never appears in
 * options at all (issue #32), an `enabled: false` provider is dropped, and a thunk
 * config resolving to `null` is dropped.
 *
 * So these tests assert the invariant end to end against `betterAuth()` itself:
 * a provider is detected if and only if sign-in accepts it.
 */
import { describe, it, expect } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { genericOAuth } from 'better-auth/plugins/generic-oauth'
import {
  detectEnabledMethods,
  detectSocialProviders,
  resolveSocialProviders,
  type AuthContextLike,
} from '../../src/utils/loginMethods.js'

const base = {
  baseURL: 'http://localhost:3000',
  secret: 'test-secret-that-is-long-enough-000000',
  database: memoryAdapter({}),
} as const

const oauthCreds = { clientId: 'client-id', clientSecret: 'client-secret' }

/** Does `/sign-in/social` accept this provider id? */
async function signInAccepts(auth: ReturnType<typeof betterAuth>, provider: string) {
  try {
    const res = await auth.api.signInSocial({ body: { provider, callbackURL: '/admin' } })
    return typeof (res as { url?: string })?.url === 'string'
  } catch {
    return false
  }
}

describe('social provider detection against a real Better Auth instance', () => {
  const auth = betterAuth({
    ...base,
    socialProviders: {
      github: oauthCreds,
      // configured but switched off
      google: { ...oauthCreds, enabled: false },
      // lazy config that resolves to nothing
      apple: async () => null,
    },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: 'zitadel',
            name: 'Company SSO',
            ...oauthCreds,
            authorizationUrl: 'https://idp.example.com/oauth/v2/authorize',
            tokenUrl: 'https://idp.example.com/oauth/v2/token',
            userInfoUrl: 'https://idp.example.com/oidc/v1/userinfo',
            accountIssuer: 'https://idp.example.com',
          },
        ],
      }),
    ],
  } as Parameters<typeof betterAuth>[0])

  it('detects a genericOAuth provider, which lives only on the context (issue #32)', async () => {
    const detected = await detectSocialProviders((await auth.$context) as AuthContextLike)
    expect(detected).toContainEqual({ id: 'zitadel', name: 'Company SSO' })
    // ...and it is genuinely absent from the raw options the old detector read.
    expect(Object.keys(auth.options.socialProviders ?? {})).not.toContain('zitadel')
  })

  it('omits providers sign-in would reject (enabled: false, or a config resolving to null)', async () => {
    const ids = (await detectSocialProviders((await auth.$context) as AuthContextLike)).map(
      (p) => p.id
    )
    expect(ids).not.toContain('google')
    expect(ids).not.toContain('apple')
    expect(ids).toContain('github')
  })

  it('detects a provider if and only if /sign-in/social accepts it', async () => {
    const detected = (await detectSocialProviders((await auth.$context) as AuthContextLike)).map(
      (p) => p.id
    )
    const configured = ['github', 'google', 'apple', 'zitadel']
    const accepted: string[] = []
    for (const id of configured) if (await signInAccepts(auth, id)) accepted.push(id)
    expect([...detected].sort()).toEqual([...accepted].sort())
  })

  it('renders a generic provider under its configured display name', async () => {
    const detected = await detectSocialProviders((await auth.$context) as AuthContextLike)
    expect(resolveSocialProviders(true, detected)).toContainEqual({
      id: 'zitadel',
      label: 'Company SSO',
    })
  })
})

describe('options detection against a real Better Auth instance', () => {
  it('sees options a plugin contributed from init(), which auth.options does not carry', async () => {
    const enablesPassword = () => ({
      id: 'enables-password',
      init: () => ({ options: { emailAndPassword: { enabled: true } } }),
    })
    const auth = betterAuth({
      ...base,
      plugins: [enablesPassword()],
    } as Parameters<typeof betterAuth>[0])

    const ctx = (await auth.$context) as AuthContextLike
    expect(detectEnabledMethods(ctx.options).password).toBe(true)
    // The raw options object never learns about it.
    expect(detectEnabledMethods(auth.options).password).toBe(false)
  })
})
