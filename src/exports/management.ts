/**
 * Management UI Components Export
 *
 * Client components for managing security features in the Payload admin panel.
 * For server component views, use the './rsc' export.
 *
 * Passkey management: '@delmaredigital/payload-better-auth/components/passkey'
 * API key management: '@delmaredigital/payload-better-auth/components/api-key'
 */

// Client components (core only — no optional peer deps)
export {
  SecurityNavLinks,
  TwoFactorManagementClient,
} from '../components/management/index.js'

export type {
  SecurityNavLinksProps,
  TwoFactorManagementClientProps,
} from '../components/management/index.js'

// Re-export plugin detection utility
export { detectEnabledPlugins } from '../utils/detectEnabledPlugins.js'
export type { EnabledPluginsResult } from '../utils/detectEnabledPlugins.js'
