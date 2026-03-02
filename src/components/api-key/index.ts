/**
 * API Key Components
 *
 * Requires @better-auth/api-key peer dependency.
 * These are separated from the main /management barrel to avoid
 * webpack resolution errors for consumers without @better-auth/api-key.
 */

export type { ApiKeysManagementClientProps } from '../management/ApiKeysManagementClient.js'
export { ApiKeysManagementClient } from '../management/ApiKeysManagementClient.js'
