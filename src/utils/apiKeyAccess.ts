/**
 * API Key Scope Enforcement Utilities
 *
 * These utilities help enforce API key scopes in Payload access control.
 * They extract the API key from requests, validate scopes, and provide
 * type-safe access control functions.
 *
 * @example
 * ```ts
 * import { requireScope, requireAnyScope } from '@delmaredigital/payload-better-auth'
 *
 * export const Posts: CollectionConfig = {
 *   slug: 'posts',
 *   access: {
 *     read: requireAnyScope(['posts:read', 'content:read']),
 *     create: requireScope('posts:write'),
 *     update: requireScope('posts:write'),
 *     delete: requireScope('posts:delete'),
 *   },
 * }
 * ```
 */

import { createHash } from 'node:crypto'
import type { Access, PayloadRequest } from 'payload'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApiKeyInfo = {
  /** The API key ID */
  id: string
  /** User ID who owns this key */
  userId: string
  /** Array of granted scope strings */
  scopes: string[]
  /** The raw key (only first/last chars visible) */
  keyPrefix?: string
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

export type ApiKeyAccessConfig = {
  /**
   * API keys collection slug.
   * @default 'apiKeys' or 'api-keys' (auto-detected)
   */
  apiKeysCollection?: string
  /**
   * Allow access if user is authenticated (non-API key session).
   * Useful for allowing both API keys and regular sessions.
   * @default false
   */
  allowAuthenticatedUsers?: boolean
  /**
   * Custom function to extract API key from request.
   * By default, extracts from Authorization: Bearer <key> header.
   */
  extractApiKey?: (req: PayloadRequest) => string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash an API key using the same algorithm as Better Auth's defaultKeyHasher.
 * Produces a SHA-256 hash encoded as Base64URL (no padding).
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('base64url')
}

/**
 * Extract API key from request headers.
 * Supports Bearer token format: Authorization: Bearer <api-key>
 */
export function extractApiKeyFromRequest(req: PayloadRequest): string | null {
  const authHeader = req.headers?.get('authorization')
  if (!authHeader) return null

  // Support "Bearer <key>" format
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }

  // Support raw key in Authorization header
  return authHeader.trim()
}

/**
 * Look up API key info from the database.
 * Returns null if key not found or disabled.
 */
export async function getApiKeyInfo(
  req: PayloadRequest,
  apiKey: string,
  apiKeysCollection = 'apiKeys'
): Promise<ApiKeyInfo | null> {
  try {
    // Hash the raw API key to match Better Auth's storage format (SHA-256 + Base64URL).
    // We query for both the hashed and raw key to support both modes:
    // - Hashing enabled (default): only the hashed query matches
    // - Hashing disabled (disableKeyHashing: true): only the plaintext query matches
    const hashedKey = hashApiKey(apiKey)

    // Try the provided collection name first
    let results = await req.payload.find({
      collection: apiKeysCollection,
      overrideAccess: true, // Must bypass access control for credential validation
      where: {
        and: [
          { enabled: { not_equals: false } },
          {
            or: [
              { key: { equals: hashedKey } },
              { key: { equals: apiKey } },
            ],
          },
        ],
      },
      limit: 1,
      depth: 0,
    }).catch(() => null)

    // If not found, try alternative slug
    if (!results || results.docs.length === 0) {
      const altSlug = apiKeysCollection === 'apiKeys' ? 'api-keys' : 'apiKeys'
      results = await req.payload.find({
        collection: altSlug,
        overrideAccess: true,
        where: {
          and: [
            { enabled: { not_equals: false } },
            {
              or: [
                { key: { equals: hashedKey } },
                { key: { equals: apiKey } },
              ],
            },
          ],
        },
        limit: 1,
        depth: 0,
      }).catch(() => null)
    }

    if (!results || results.docs.length === 0) {
      return null
    }

    const doc = results.docs[0] as {
      id: string | number
      user?: string | number | { id: string | number }
      userId?: string | number
      permissions?: string
      scopes?: string[]
      start?: string
      metadata?: string | Record<string, unknown>
    }

    // Parse scopes from permissions field (Better Auth format) or scopes array
    let scopes: string[] = []
    if (doc.permissions) {
      try {
        const parsed = JSON.parse(doc.permissions)
        if (Array.isArray(parsed)) {
          scopes = parsed
        } else if (typeof parsed === 'object') {
          // Flatten Better Auth permissions format {"resource": ["action1", "action2"]}
          // into scope strings like ["resource:action1", "resource:action2"]
          scopes = Object.entries(parsed).flatMap(([resource, actions]) =>
            Array.isArray(actions) ? actions.map(action => `${resource}:${action}`) : [resource]
          )
        }
      } catch {
        // If not JSON, treat as comma-separated
        scopes = doc.permissions.split(',').map((s) => s.trim()).filter(Boolean)
      }
    } else if (Array.isArray(doc.scopes)) {
      scopes = doc.scopes
    }

    // Get user ID (handle both direct field and relationship)
    let userId: string
    if (doc.userId) {
      userId = String(doc.userId)
    } else if (doc.user) {
      userId = typeof doc.user === 'object' ? String(doc.user.id) : String(doc.user)
    } else {
      return null
    }

    // Parse metadata
    let metadata: Record<string, unknown> | undefined
    if (doc.metadata) {
      if (typeof doc.metadata === 'string') {
        try {
          metadata = JSON.parse(doc.metadata)
        } catch {
          // Ignore parse errors
        }
      } else {
        metadata = doc.metadata
      }
    }

    // Prefer scope names from metadata (stored by admin UI as original scope strings
    // like ["pages:read", "*"]) over permissions-derived scopes, because the permissions
    // field uses Better Auth's internal format (e.g. {"pages": {"$": ["read"]}}) and
    // Object.keys() on that only yields collection names, not proper scope strings.
    if (metadata?.scopes && Array.isArray(metadata.scopes)) {
      scopes = metadata.scopes as string[]
    }

    return {
      id: String(doc.id),
      userId,
      scopes,
      keyPrefix: doc.start,
      metadata,
    }
  } catch {
    return null
  }
}

/**
 * Check if an API key has a specific scope.
 * Supports wildcard patterns like 'posts:*' matching 'posts:read', 'posts:write', etc.
 */
export function hasScope(keyScopes: string[], requiredScope: string): boolean {
  return keyScopes.some((scope) => {
    // Exact match
    if (scope === requiredScope) return true

    // Wildcard match: 'posts:*' matches 'posts:read'
    if (scope.endsWith(':*')) {
      const prefix = scope.slice(0, -1) // Remove '*', keep ':'
      return requiredScope.startsWith(prefix)
    }

    // Global wildcard
    if (scope === '*') return true

    return false
  })
}

/**
 * Check if an API key has any of the specified scopes.
 */
export function hasAnyScope(keyScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.some((scope) => hasScope(keyScopes, scope))
}

/**
 * Check if an API key has all of the specified scopes.
 */
export function hasAllScopes(keyScopes: string[], requiredScopes: string[]): boolean {
  return requiredScopes.every((scope) => hasScope(keyScopes, scope))
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Control Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an access control function that requires a specific scope.
 *
 * @param scope - The required scope string (e.g., 'posts:read')
 * @param config - Configuration options
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: requireScope('posts:read'),
 *   create: requireScope('posts:write'),
 * }
 * ```
 */
export function requireScope(
  scope: string,
  config: ApiKeyAccessConfig = {}
): Access {
  const {
    apiKeysCollection = 'apiKeys',
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    // If authenticated users are allowed and user is logged in without API key
    if (allowAuthenticatedUsers && req.user) {
      const apiKey = extractApiKey(req)
      if (!apiKey) {
        return true // User authenticated via session, no API key = allow
      }
    }

    // Extract API key from request
    const apiKey = extractApiKey(req)
    if (!apiKey) {
      return false
    }

    // Look up API key
    const keyInfo = await getApiKeyInfo(req, apiKey, apiKeysCollection)
    if (!keyInfo) {
      return false
    }

    // Check scope
    return hasScope(keyInfo.scopes, scope)
  }
}

/**
 * Create an access control function that requires any of the specified scopes.
 *
 * @param scopes - Array of acceptable scopes (at least one must match)
 * @param config - Configuration options
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: requireAnyScope(['posts:read', 'content:read', 'admin:*']),
 * }
 * ```
 */
export function requireAnyScope(
  scopes: string[],
  config: ApiKeyAccessConfig = {}
): Access {
  const {
    apiKeysCollection = 'apiKeys',
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    // If authenticated users are allowed and user is logged in without API key
    if (allowAuthenticatedUsers && req.user) {
      const apiKey = extractApiKey(req)
      if (!apiKey) {
        return true
      }
    }

    const apiKey = extractApiKey(req)
    if (!apiKey) {
      return false
    }

    const keyInfo = await getApiKeyInfo(req, apiKey, apiKeysCollection)
    if (!keyInfo) {
      return false
    }

    return hasAnyScope(keyInfo.scopes, scopes)
  }
}

/**
 * Create an access control function that requires all specified scopes.
 *
 * @param scopes - Array of required scopes (all must be present)
 * @param config - Configuration options
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   delete: requireAllScopes(['posts:delete', 'admin:write']),
 * }
 * ```
 */
export function requireAllScopes(
  scopes: string[],
  config: ApiKeyAccessConfig = {}
): Access {
  const {
    apiKeysCollection = 'apiKeys',
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    // If authenticated users are allowed and user is logged in without API key
    if (allowAuthenticatedUsers && req.user) {
      const apiKey = extractApiKey(req)
      if (!apiKey) {
        return true
      }
    }

    const apiKey = extractApiKey(req)
    if (!apiKey) {
      return false
    }

    const keyInfo = await getApiKeyInfo(req, apiKey, apiKeysCollection)
    if (!keyInfo) {
      return false
    }

    return hasAllScopes(keyInfo.scopes, scopes)
  }
}

/**
 * Create an access control function that allows either:
 * 1. Authenticated users (via session)
 * 2. API key with required scope
 *
 * This is useful for endpoints that should work with both auth methods.
 *
 * @param scope - The required scope for API key access
 * @param config - Configuration options
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: allowSessionOrScope('posts:read'),
 * }
 * ```
 */
export function allowSessionOrScope(
  scope: string,
  config: Omit<ApiKeyAccessConfig, 'allowAuthenticatedUsers'> = {}
): Access {
  return requireScope(scope, { ...config, allowAuthenticatedUsers: true })
}

/**
 * Create an access control function that allows either:
 * 1. Authenticated users (via session)
 * 2. API key with any of the required scopes
 *
 * @param scopes - Array of acceptable scopes for API key access
 * @param config - Configuration options
 * @returns Payload access function
 */
export function allowSessionOrAnyScope(
  scopes: string[],
  config: Omit<ApiKeyAccessConfig, 'allowAuthenticatedUsers'> = {}
): Access {
  return requireAnyScope(scopes, { ...config, allowAuthenticatedUsers: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Better Auth Integration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an API key and get its info.
 *
 * This performs a database lookup to validate the key and retrieve
 * its associated scopes and user.
 *
 * @param req - Payload request
 * @param apiKeysCollection - The API keys collection slug
 * @returns API key info if valid, null otherwise
 *
 * @example
 * ```ts
 * const keyInfo = await validateApiKey(req)
 * if (keyInfo) {
 *   console.log('Valid API key for user:', keyInfo.userId)
 *   console.log('Scopes:', keyInfo.scopes)
 * }
 * ```
 */
export async function validateApiKey(
  req: PayloadRequest,
  apiKeysCollection = 'apiKeys'
): Promise<ApiKeyInfo | null> {
  const apiKey = extractApiKeyFromRequest(req)
  if (!apiKey) return null
  return getApiKeyInfo(req, apiKey, apiKeysCollection)
}
