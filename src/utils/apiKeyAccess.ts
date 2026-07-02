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
 *
 * Supports BOTH transports the auth strategy authenticates keys on:
 *   - `x-api-key: <api-key>`
 *   - `Authorization: Bearer <api-key>` (or a bare `Authorization` value)
 *
 * The `x-api-key` case is security-critical: the strategy (plugin/index.ts)
 * mints `req.user` for keys sent via `x-api-key`, so if this helper only read
 * `Authorization`, a key sent via `x-api-key` would yield `apiKey === null`
 * while `req.user` was set — and any `allowAuthenticatedUsers` guard would
 * treat a scoped (or zero-scope) key as a full session, bypassing scope
 * enforcement entirely.
 */
export function extractApiKeyFromRequest(req: PayloadRequest): string | null {
  const apiKeyHeader = req.headers?.get('x-api-key')
  if (apiKeyHeader) return apiKeyHeader.trim()

  const authHeader = req.headers?.get('authorization')
  if (!authHeader) return null

  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim()
  }

  return authHeader.trim()
}

/**
 * Detect whether `req.user` was authenticated from an API key (vs an
 * interactive session). The auth strategy attaches `apiKeyScopes` to the user
 * only for API-key requests, so its presence is the signal.
 *
 * Used to keep API-key-derived users out of the `allowAuthenticatedUsers`
 * short-circuit as defense-in-depth: even if a consumer supplies a custom
 * `extractApiKey` that fails to see the key's header, an API-key user must
 * never be treated as a full session.
 */
function isApiKeyUser(user: unknown): boolean {
  return (
    typeof user === 'object' &&
    user !== null &&
    (user as { apiKeyScopes?: unknown }).apiKeyScopes !== undefined
  )
}

/** Minimal typed view of the api-key plugin endpoint we call. */
interface VerifyApiKeyResult {
  valid: boolean
  key?: { permissions?: Record<string, string[]> | null } | null
}
interface ApiKeyApi {
  verifyApiKey(args: {
    body: { key: string; permissions?: Record<string, string[]> }
  }): Promise<VerifyApiKeyResult>
}

/**
 * Does a flat scope list (`resource:action` strings, e.g. from
 * `req.user.apiKeyScopes`) satisfy a requested permission? A `write` check is
 * also satisfied by legacy CRUD actions (create/update/delete).
 */
function scopeSatisfies(scopes: string[], resource: string, action: string): boolean {
  if (scopes.includes(`${resource}:${action}`)) return true
  if (action === 'write') {
    return ['create', 'update', 'delete'].some((a) => scopes.includes(`${resource}:${a}`))
  }
  return false
}

/**
 * Verify a key ONCE per request and cache the result on `req`. `verifyApiKey` is
 * not a read — it consumes the key's usage quota and a rate-limit slot and can
 * delete the key — so calling it per-permission (requireAll/Any) would burn
 * quota multiple times per request. Only used on the fallback path below.
 */
async function getVerifiedKey(
  req: PayloadRequest,
  apiKey: string
): Promise<{ permissions?: Record<string, string[]> | null } | null> {
  const auth = (req.payload as PayloadWithAuth).betterAuth
  if (!auth) return null
  const holder = req as unknown as {
    __baVerifiedKeys?: Map<string, { permissions?: Record<string, string[]> | null } | null>
  }
  const cache = (holder.__baVerifiedKeys ??= new Map())
  if (cache.has(apiKey)) return cache.get(apiKey) ?? null
  let value: { permissions?: Record<string, string[]> | null } | null = null
  try {
    const result = await (auth.api as unknown as ApiKeyApi).verifyApiKey({ body: { key: apiKey } })
    value = result.valid === true ? (result.key ?? null) : null
  } catch {
    value = null
  }
  cache.set(apiKey, value)
  return value
}

/**
 * Check whether an API key grants a permission.
 *
 * Fast path: the auth strategy already validated the key and resolved its scopes
 * onto `req.user.apiKeyScopes` via a single side-effect-free row read. Prefer
 * that — it avoids re-calling the quota-consuming `verifyApiKey` (once per
 * permission checked). Fallback (no strategy-resolved scopes): verify once via
 * Better Auth and match locally, including legacy CRUD-format keys.
 */
async function verifyKeyPermission(
  req: PayloadRequest,
  apiKey: string,
  resource: string,
  action: string
): Promise<boolean> {
  const scopes = (req.user as { apiKeyScopes?: unknown } | undefined)?.apiKeyScopes
  if (Array.isArray(scopes)) {
    return scopeSatisfies(scopes as string[], resource, action)
  }

  const key = await getVerifiedKey(req, apiKey)
  const actions = key?.permissions?.[resource]
  if (!Array.isArray(actions)) return false
  if (action === 'write') {
    return actions.some((a) => ['write', 'create', 'update', 'delete'].includes(a))
  }
  if (action === 'read') return actions.includes('read')
  return false
}

/**
 * Verify an API key is valid (no specific permission). Uses the same fast path:
 * a strategy-resolved `apiKeyScopes` means the key was already validated.
 */
async function verifyKeyOnly(req: PayloadRequest, apiKey: string): Promise<boolean> {
  const scopes = (req.user as { apiKeyScopes?: unknown } | undefined)?.apiKeyScopes
  if (Array.isArray(scopes)) return true
  const key = await getVerifiedKey(req, apiKey)
  return key !== null
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

    if (allowAuthenticatedUsers && req.user && !apiKey && !isApiKeyUser(req.user)) {
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

    if (allowAuthenticatedUsers && req.user && !apiKey && !isApiKeyUser(req.user)) {
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

    if (allowAuthenticatedUsers && req.user && !apiKey && !isApiKeyUser(req.user)) {
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

    if (allowAuthenticatedUsers && req.user && !apiKey && !isApiKeyUser(req.user)) {
      return true
    }

    if (!apiKey) return false

    return verifyKeyOnly(req, apiKey)
  }
}
