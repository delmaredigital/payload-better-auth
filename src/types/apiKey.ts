/**
 * API Key Permission Types
 *
 * Uses Better Auth's native permission format: Record<string, string[]>
 * where keys are resource names (collection slugs) and values are action arrays.
 *
 * Convention: two actions per collection — 'read' and 'write'.
 * - read: view records
 * - write: full access (create, update, delete) — implies read
 */

/**
 * A permission definition for the admin UI.
 * Describes a collection's available permission levels.
 */
export type PermissionDefinition = {
  /** Collection slug (e.g., 'posts') */
  slug: string
  /** Human-readable label (e.g., 'Posts') */
  label: string
  /** Available actions — always ['read', 'write'] for auto-generated */
  actions: string[]
}

/**
 * Configuration options for API key permissions.
 */
export type ApiKeyPermissionsConfig = {
  /**
   * Collections to exclude from the permissions UI.
   * @default ['sessions', 'verifications', 'accounts', 'twoFactors', 'apiKeys']
   */
  excludeCollections?: string[]
  /**
   * Role(s) required to create, update, and delete API keys.
   * - string: Single role required (e.g., 'admin')
   * - string[]: Any matching role grants access
   * - null: Allow any authenticated user (not recommended)
   * @default Inherits from admin.login.requiredRole, or 'admin' if unset
   */
  requiredRole?: string | string[] | null
}
