/**
 * API Key Scope Types
 *
 * Provides typed configuration for API key permission scopes.
 */

/**
 * A single permission scope definition.
 * Scopes are human-readable permission groups (like GitHub OAuth scopes).
 */
export type ScopeDefinition = {
  /** Human-readable label for the scope (e.g., "Read Content") */
  label: string
  /** Description of what this scope allows (e.g., "View posts, pages, and comments") */
  description: string
  /**
   * Permission mapping: { resourceType: ['action1', 'action2'] }
   * Maps to Better Auth's permission format.
   * Use '*' for resource to match all resources.
   * Use '*' in actions array to grant all actions on a resource.
   */
  permissions: Record<string, string[]>
  /** If true, only admin users can create keys with this scope */
  adminOnly?: boolean
}

/**
 * Configuration options for API key scopes.
 * Can be used in plugin options to customize available scopes.
 */
export type ApiKeyScopesConfig = {
  /**
   * Custom scope definitions.
   * Key is the scope ID (e.g., 'content:read'), value is the scope definition.
   */
  scopes?: Record<string, ScopeDefinition>
  /**
   * Include auto-generated collection scopes.
   * When true (default), generates {collection}:read, {collection}:write, {collection}:delete
   * for each Payload collection.
   * @default true when no custom scopes provided, false when custom scopes provided
   */
  includeCollectionScopes?: boolean
  /**
   * Collections to exclude from auto-generated scopes.
   * Useful for hiding sensitive collections like 'sessions' or 'verifications'.
   * @default ['sessions', 'verifications', 'accounts', 'twoFactors']
   */
  excludeCollections?: string[]
  /**
   * Default scopes assigned to new API keys when user doesn't select any.
   * If not provided, keys without scopes will have no permissions.
   */
  defaultScopes?: string[]
  /**
   * Role(s) required to create, update, and delete API keys.
   * - string: Single role required (e.g., 'admin')
   * - string[]: Any matching role grants access
   * - null: Allow any authenticated user (not recommended)
   * @default Inherits from admin.login.requiredRole, or 'admin' if unset
   */
  requiredRole?: string | string[] | null
}

/**
 * Scope data passed to the API keys management client component.
 */
export type AvailableScope = ScopeDefinition & {
  /** The scope ID (e.g., 'content:read') */
  id: string
}
