/**
 * Utility to apply sensible defaults to Better Auth options.
 *
 * @packageDocumentation
 */

import type { BetterAuthOptions } from 'better-auth'
import { apiKey as betterAuthApiKey } from '@better-auth/api-key'

type ApiKeyPluginOptions = Parameters<typeof betterAuthApiKey>[0]

/**
 * API Key plugin with sensible defaults for use with this package.
 *
 * Enables metadata storage by default so that scopes can be displayed
 * in the admin UI after key creation.
 *
 * @example
 * ```ts
 * import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'
 *
 * export const betterAuthOptions = {
 *   plugins: [
 *     apiKeyWithDefaults(),  // metadata enabled by default
 *   ],
 * }
 * ```
 *
 * @example With custom options
 * ```ts
 * apiKeyWithDefaults({
 *   rateLimit: { max: 100, window: 60 },
 *   // enableMetadata is already true
 * })
 * ```
 */
export function apiKeyWithDefaults(options?: ApiKeyPluginOptions): ReturnType<typeof betterAuthApiKey> {
  return betterAuthApiKey({
    enableMetadata: true,
    ...options,
  })
}

/**
 * Applies sensible defaults to Better Auth options.
 *
 * Currently applies the following defaults:
 * - `trustedOrigins`: If not explicitly provided but `baseURL` is set,
 *   defaults to `[baseURL]`. This handles the common single-domain case
 *   where the app's origin should be trusted for auth requests.
 *
 * Multi-domain setups can still explicitly set `trustedOrigins` to include
 * multiple origins.
 *
 * @example Simple case - trustedOrigins defaults to [baseURL]
 * ```ts
 * import { withBetterAuthDefaults } from '@delmaredigital/payload-better-auth'
 *
 * const auth = betterAuth(withBetterAuthDefaults({
 *   baseURL: 'https://myapp.com',
 *   // trustedOrigins automatically becomes ['https://myapp.com']
 * }))
 * ```
 *
 * @example Multi-domain case - explicit trustedOrigins respected
 * ```ts
 * const auth = betterAuth(withBetterAuthDefaults({
 *   baseURL: 'https://myapp.com',
 *   trustedOrigins: ['https://myapp.com', 'https://other-domain.com'],
 *   // trustedOrigins stays as explicitly provided
 * }))
 * ```
 *
 * @example With createBetterAuthPlugin
 * ```ts
 * createBetterAuthPlugin({
 *   createAuth: (payload) => betterAuth(withBetterAuthDefaults({
 *     database: payloadAdapter({ payloadClient: payload }),
 *     baseURL: process.env.BETTER_AUTH_URL,
 *   })),
 * })
 * ```
 */
export function withBetterAuthDefaults<T extends BetterAuthOptions>(
  options: T
): T {
  // If trustedOrigins is explicitly provided, use it as-is
  if (options.trustedOrigins !== undefined) {
    return options
  }

  // If baseURL is set, default trustedOrigins to [baseURL]
  if (options.baseURL) {
    return {
      ...options,
      trustedOrigins: [options.baseURL],
    }
  }

  // No defaults to apply
  return options
}
