/**
 * Client-side auth utilities
 * Re-exports createAuthClient from better-auth/react and core plugins
 *
 * NOTE: Only plugins from the core `better-auth` package are statically imported here.
 * Optional peer dep plugins (passkey, apiKey, etc.) must NOT be statically imported
 * because webpack resolves all static imports at build time, breaking consumers
 * who don't have those packages installed.
 */

import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'

// Re-export createAuthClient and core plugins
export { createAuthClient } from 'better-auth/react'
export { twoFactorClient } from 'better-auth/client/plugins'

/**
 * Default plugins included with Payload Better Auth (core only).
 * Add optional plugins (passkeyClient, apiKeyClient) from their own packages.
 *
 * @example
 * ```typescript
 * import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
 * import { passkeyClient } from '@better-auth/passkey/client'
 * import { apiKeyClient } from '@better-auth/api-key/client'
 *
 * export const authClient = createAuthClient({
 *   plugins: [...payloadAuthPlugins, passkeyClient(), apiKeyClient()],
 * })
 * ```
 */
export const payloadAuthPlugins = [
  twoFactorClient(),
] as const

export interface PayloadAuthClientOptions {
  /** Base URL for auth endpoints (defaults to window.location.origin) */
  baseURL?: string
}

/**
 * Create a pre-configured auth client with default core plugins (twoFactor).
 *
 * For passkeys, API keys, or other optional plugins, use `createAuthClient` directly:
 *
 * @example Basic usage
 * ```typescript
 * import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'
 * export const authClient = createPayloadAuthClient()
 * ```
 *
 * @example With optional plugins
 * ```typescript
 * import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
 * import { passkeyClient } from '@better-auth/passkey/client'
 *
 * export const authClient = createAuthClient({
 *   plugins: [...payloadAuthPlugins, passkeyClient()],
 * })
 * ```
 */
export function createPayloadAuthClient(options?: PayloadAuthClientOptions) {
  return createAuthClient({
    baseURL:
      options?.baseURL ??
      (typeof window !== 'undefined' ? window.location.origin : ''),
    plugins: [...payloadAuthPlugins],
  })
}

export type PayloadAuthClient = ReturnType<typeof createPayloadAuthClient>
