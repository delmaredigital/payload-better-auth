/**
 * Client-side auth utilities
 * Re-exports createAuthClient from better-auth/react and common plugins
 */

import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'
import { apiKeyClient } from '@better-auth/api-key/client'
import { passkeyClient } from '@better-auth/passkey/client'

// Re-export createAuthClient and common plugins
export { createAuthClient } from 'better-auth/react'
export { twoFactorClient } from 'better-auth/client/plugins'
export { apiKeyClient } from '@better-auth/api-key/client'
export { passkeyClient } from '@better-auth/passkey/client'

/**
 * Default plugins included with Payload Better Auth.
 * Use this with createAuthClient when you need custom plugins with full type safety.
 *
 * @example With custom plugins (full type safety)
 * ```typescript
 * import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
 * import { stripeClient } from '@better-auth/stripe/client'
 *
 * export const authClient = createAuthClient({
 *   plugins: [...payloadAuthPlugins, stripeClient({ subscription: true })],
 * })
 *
 * // authClient.subscription is fully typed!
 * ```
 */
export const payloadAuthPlugins = [
  twoFactorClient(),
  apiKeyClient(),
  passkeyClient(),
] as const

export interface PayloadAuthClientOptions {
  /** Base URL for auth endpoints (defaults to window.location.origin) */
  baseURL?: string
}

/**
 * Create a pre-configured auth client with default plugins (twoFactor, apiKey, passkey).
 *
 * This is a convenience wrapper for simple setups. For custom plugins with full type
 * safety, use `createAuthClient` with `payloadAuthPlugins` instead.
 *
 * @param options - Optional configuration
 * @param options.baseURL - Base URL for auth endpoints (defaults to window.location.origin)
 *
 * @example Basic usage (no custom plugins)
 * ```typescript
 * import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'
 *
 * export const authClient = createPayloadAuthClient()
 * ```
 *
 * @example With custom plugins (use createAuthClient for full type safety)
 * ```typescript
 * import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
 * import { stripeClient } from '@better-auth/stripe/client'
 *
 * export const authClient = createAuthClient({
 *   plugins: [...payloadAuthPlugins, stripeClient({ subscription: true })],
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
