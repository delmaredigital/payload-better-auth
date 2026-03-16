/**
 * Utility to detect which Better Auth plugins are enabled
 */

import type { BetterAuthOptions } from 'better-auth'

export type EnabledPluginsResult = {
  hasAdmin: boolean
  hasApiKey: boolean
  hasTwoFactor: boolean
  hasPasskey: boolean
  hasMagicLink: boolean
  hasMultiSession: boolean
  hasOrganization: boolean
  hasNextCookies: boolean
}

/**
 * Detects which Better Auth plugins are enabled from the options.
 * Inspects the plugins array by checking plugin identifiers.
 *
 * @param options - Better Auth options containing plugins array
 * @returns Object with boolean flags for each supported plugin
 */
export function detectEnabledPlugins(
  options?: Partial<BetterAuthOptions>
): EnabledPluginsResult {
  const plugins = options?.plugins ?? []

  const result: EnabledPluginsResult = {
    hasAdmin: false,
    hasApiKey: false,
    hasTwoFactor: false,
    hasPasskey: false,
    hasMagicLink: false,
    hasMultiSession: false,
    hasOrganization: false,
    hasNextCookies: false,
  }

  for (const plugin of plugins) {
    // Better Auth plugins have an id property
    const id = (plugin as { id?: string }).id

    switch (id) {
      case 'admin':
        result.hasAdmin = true
        break
      case 'api-key':
        result.hasApiKey = true
        break
      case 'two-factor':
        result.hasTwoFactor = true
        break
      case 'passkey':
        result.hasPasskey = true
        break
      case 'magic-link':
        result.hasMagicLink = true
        break
      case 'multi-session':
        result.hasMultiSession = true
        break
      case 'organization':
        result.hasOrganization = true
        break
      case 'next-cookies':
        result.hasNextCookies = true
        break
    }
  }

  return result
}
