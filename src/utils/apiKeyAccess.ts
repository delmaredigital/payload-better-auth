/**
 * API Key Permission Enforcement Utilities
 *
 * Thin wrappers around Better Auth's verifyApiKey() for use in
 * Payload access control. Uses BA's native permission format.
 *
 * @example
 * ```ts
 * import { requirePermission, allowSessionOrPermission } from '@delmaredigital/payload-better-auth'
 *
 * export const Posts: CollectionConfig = {
 *   slug: 'posts',
 *   access: {
 *     read: requirePermission('posts', 'read'),
 *     create: requirePermission('posts', 'write'),
 *     update: requirePermission('posts', 'write'),
 *     delete: requirePermission('posts', 'write'),
 *   },
 * }
 * ```
 */

import type { Access, PayloadRequest } from 'payload'
import type { PayloadWithAuth } from '../types/betterAuth.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApiKeyPermissionConfig = {
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

/** A single permission check: resource + action */
export type PermissionCheck = {
  resource: string
  action: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract API key from request headers.
 * Supports Bearer token format: Authorization: Bearer <api-key>
 */
export function extractApiKeyFromRequest(req: PayloadRequest): string | null {
  const authHeader = req.headers?.get('authorization')
  if (!authHeader) return null

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }

  return authHeader.trim()
}

/**
 * Verify an API key has the required permission using Better Auth's native verifyApiKey.
 * Returns true if the key is valid and has the permission, false otherwise.
 *
 * Includes backward compatibility: if the key was created with old CRUD actions
 * (create/update/delete), a 'write' check will fall back to checking for those.
 */
async function verifyKeyPermission(
  req: PayloadRequest,
  apiKey: string,
  resource: string,
  action: string
): Promise<boolean> {
  const auth = (req.payload as PayloadWithAuth).betterAuth
  if (!auth) return false

  try {
    // Primary check: use BA's native permission verification
    const result = await (auth.api as any).verifyApiKey({
      body: {
        key: apiKey,
        permissions: { [resource]: [action] },
      },
    })

    if (result.valid) return true

    // Backward compat: old keys stored CRUD actions instead of 'read'/'write'
    const fallbackResult = await (auth.api as any).verifyApiKey({
      body: { key: apiKey },
    })

    if (!fallbackResult.valid || !fallbackResult.key?.permissions) return false

    const perms = fallbackResult.key.permissions as Record<string, string[]>
    const actions = perms[resource]
    if (!Array.isArray(actions)) return false

    if (action === 'write') {
      // Old 'write' stored as ['read', 'create', 'update'] or ['delete']
      return actions.some((a: string) => ['create', 'update', 'delete'].includes(a))
    }

    if (action === 'read') {
      return actions.includes('read')
    }

    return false
  } catch {
    return false
  }
}

/**
 * Verify an API key without checking specific permissions.
 * Returns true if the key is valid, false otherwise.
 */
async function verifyKeyOnly(
  req: PayloadRequest,
  apiKey: string
): Promise<boolean> {
  const auth = (req.payload as PayloadWithAuth).betterAuth
  if (!auth) return false

  try {
    const result = await (auth.api as any).verifyApiKey({
      body: { key: apiKey },
    })
    return result.valid === true
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Control Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Require a specific permission on an API key.
 *
 * @param resource - Collection slug (e.g., 'posts')
 * @param action - Permission action: 'read' or 'write'
 * @param config - Optional configuration
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: requirePermission('posts', 'read'),
 *   create: requirePermission('posts', 'write'),
 * }
 * ```
 */
export function requirePermission(
  resource: string,
  action: string,
  config: ApiKeyPermissionConfig = {}
): Access {
  const {
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    const apiKey = extractApiKey(req)

    if (allowAuthenticatedUsers && req.user && !apiKey) {
      return true
    }

    if (!apiKey) return false

    return verifyKeyPermission(req, apiKey, resource, action)
  }
}

/**
 * Require any one of the specified permissions.
 *
 * @param permissions - Array of {resource, action} pairs (at least one must match)
 * @param config - Optional configuration
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: requireAnyPermission([
 *     { resource: 'posts', action: 'read' },
 *     { resource: 'pages', action: 'read' },
 *   ]),
 * }
 * ```
 */
export function requireAnyPermission(
  permissions: PermissionCheck[],
  config: ApiKeyPermissionConfig = {}
): Access {
  const {
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    const apiKey = extractApiKey(req)

    if (allowAuthenticatedUsers && req.user && !apiKey) {
      return true
    }

    if (!apiKey) return false

    for (const perm of permissions) {
      if (await verifyKeyPermission(req, apiKey, perm.resource, perm.action)) {
        return true
      }
    }
    return false
  }
}

/**
 * Require all of the specified permissions.
 *
 * @param permissions - Array of {resource, action} pairs (all must match)
 * @param config - Optional configuration
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   delete: requireAllPermissions([
 *     { resource: 'posts', action: 'write' },
 *     { resource: 'admin', action: 'write' },
 *   ]),
 * }
 * ```
 */
export function requireAllPermissions(
  permissions: PermissionCheck[],
  config: ApiKeyPermissionConfig = {}
): Access {
  const {
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    const apiKey = extractApiKey(req)

    if (allowAuthenticatedUsers && req.user && !apiKey) {
      return true
    }

    if (!apiKey) return false

    for (const perm of permissions) {
      if (!(await verifyKeyPermission(req, apiKey, perm.resource, perm.action))) {
        return false
      }
    }
    return true
  }
}

/**
 * Allow either authenticated session OR API key with permission.
 *
 * @example
 * ```ts
 * access: {
 *   read: allowSessionOrPermission('posts', 'read'),
 * }
 * ```
 */
export function allowSessionOrPermission(
  resource: string,
  action: string,
  config: Omit<ApiKeyPermissionConfig, 'allowAuthenticatedUsers'> = {}
): Access {
  return requirePermission(resource, action, { ...config, allowAuthenticatedUsers: true })
}

/**
 * Allow either authenticated session OR API key with any of the permissions.
 */
export function allowSessionOrAnyPermission(
  permissions: PermissionCheck[],
  config: Omit<ApiKeyPermissionConfig, 'allowAuthenticatedUsers'> = {}
): Access {
  return requireAnyPermission(permissions, { ...config, allowAuthenticatedUsers: true })
}

/**
 * Require a valid API key (no specific permissions checked).
 * Useful for apps that use role-based access and just need to verify the key exists.
 *
 * @example
 * ```ts
 * access: {
 *   read: requireApiKey(),
 * }
 * ```
 */
export function requireApiKey(
  config: ApiKeyPermissionConfig = {}
): Access {
  const {
    allowAuthenticatedUsers = false,
    extractApiKey = extractApiKeyFromRequest,
  } = config

  return async ({ req }) => {
    const apiKey = extractApiKey(req)

    if (allowAuthenticatedUsers && req.user && !apiKey) {
      return true
    }

    if (!apiKey) return false

    return verifyKeyOnly(req, apiKey)
  }
}
