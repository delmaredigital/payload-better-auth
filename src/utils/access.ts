/**
 * Access control utilities for Payload collections.
 *
 * These helpers simplify common access control patterns when using
 * Better Auth with Payload CMS. They handle role checking, self-access
 * patterns, and field-level permissions.
 *
 * @example
 * ```ts
 * import { isAdmin, isAdminOrSelf } from '@delmaredigital/payload-better-auth'
 *
 * export const Users: CollectionConfig = {
 *   slug: 'users',
 *   access: {
 *     read: isAdminOrSelf({ adminRoles: ['admin', 'editor'] }),
 *     update: isAdminOrSelf({ adminRoles: ['admin'] }),
 *     delete: isAdmin({ adminRoles: ['admin'] }),
 *   },
 * }
 * ```
 */

import type { Access, FieldAccess, PayloadRequest } from 'payload'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RoleCheckConfig = {
  /**
   * Roles considered admin roles.
   * @default ['admin']
   */
  adminRoles?: string[]
  /**
   * User property that holds the role(s). Leave unset to use the `roleField`
   * configured on `betterAuthCollections()` (read from the request's Payload
   * config), which falls back to `'role'`.
   */
  roleField?: string
}

export type SelfAccessConfig = RoleCheckConfig & {
  /**
   * The field to use for user ID comparison.
   * @default 'id'
   */
  idField?: string
}

export type FieldUpdateConfig = SelfAccessConfig & {
  /**
   * Fields the user is allowed to update on their own record.
   * Password is handled specially and requires currentPassword.
   * @default ['name']
   */
  allowedFields?: string[]
  /**
   * The user collection slug for password verification.
   */
  userSlug?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Role Field
// ─────────────────────────────────────────────────────────────────────────────

/** The user property role checks read when no `roleField` is configured. */
export const DEFAULT_ROLE_FIELD = 'role'

/**
 * Read the configured role field from a Payload config.
 *
 * `betterAuthCollections({ roleField })` stores the value at
 * `config.custom.betterAuth.roleField`; every role check in the plugin reads it
 * from there so the name is set once.
 *
 * @param config - A Payload config (or sanitized config), or undefined
 * @returns The configured field name, or `'role'`
 */
export function getRoleField(config: { custom?: Record<string, unknown> } | undefined | null): string {
  const betterAuth = config?.custom?.betterAuth as { roleField?: unknown } | undefined
  const roleField = betterAuth?.roleField
  return typeof roleField === 'string' && roleField ? roleField : DEFAULT_ROLE_FIELD
}

/** Resolve the role field for a request: explicit option, then config, then `'role'`. */
function roleFieldFor(req: PayloadRequest, explicit?: string): string {
  return explicit || getRoleField(req.payload?.config)
}

// ─────────────────────────────────────────────────────────────────────────────
// Role Checking Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a user's role to an array.
 *
 * Handles various role formats:
 * - Array of roles
 * - Comma-separated string
 * - Single role string
 *
 * @param role - The role value from the user object
 * @returns Array of role strings
 */
export function normalizeRoles(role: unknown): string[] {
  if (Array.isArray(role)) {
    return role.filter((r): r is string => typeof r === 'string')
  }

  // A string is ONE role. We intentionally do NOT comma-split: splitting a value
  // like "super,admin" into ["super", "admin"] let a fragment coincidentally
  // match "admin" and grant access. Use an array for multiple roles (the
  // documented form) rather than a CSV string.
  if (typeof role === 'string') {
    return role ? [role] : []
  }

  return []
}

/**
 * Check if a user has any of the specified roles.
 *
 * @param user - The user object
 * @param roles - Roles to check for
 * @param roleField - User property holding the role(s) (default: `'role'`)
 * @returns True if user has at least one matching role
 *
 * @example
 * ```ts
 * const user = { role: ['admin', 'editor'] }
 * hasAnyRole(user, ['admin']) // true
 * hasAnyRole(user, ['superadmin']) // false
 * hasAnyRole({ roles: ['admin'] }, ['admin'], 'roles') // true
 * ```
 */
export function hasAnyRole(
  user: object | null | undefined,
  roles: string[],
  roleField: string = DEFAULT_ROLE_FIELD
): boolean {
  const userRoles = readUserRoles(user, roleField)
  return userRoles.some((role) => roles.includes(role))
}

/**
 * Check if a user has all of the specified roles.
 *
 * @param user - The user object
 * @param roles - Roles to check for
 * @param roleField - User property holding the role(s) (default: `'role'`)
 * @returns True if user has all matching roles
 *
 * @example
 * ```ts
 * const user = { role: ['admin', 'editor'] }
 * hasAllRoles(user, ['admin', 'editor']) // true
 * hasAllRoles(user, ['admin', 'superadmin']) // false
 * ```
 */
export function hasAllRoles(
  user: object | null | undefined,
  roles: string[],
  roleField: string = DEFAULT_ROLE_FIELD
): boolean {
  const userRoles = readUserRoles(user, roleField)
  if (userRoles.length === 0) return false
  return roles.every((role) => userRoles.includes(role))
}

/** The user's roles under `roleField`, normalized; empty when absent. */
function readUserRoles(user: object | null | undefined, roleField: string): string[] {
  if (!user) return []
  return normalizeRoles((user as Record<string, unknown>)[roleField])
}

// ─────────────────────────────────────────────────────────────────────────────
// Access Control Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if the current request user has admin roles.
 *
 * Use this as a reusable check within access functions.
 *
 * @param config - Configuration with admin roles
 * @returns Access check function
 */
export function hasAdminRoles(
  config: RoleCheckConfig = {}
): (args: { req: PayloadRequest }) => boolean {
  const { adminRoles = ['admin'], roleField } = config

  return ({ req }) => {
    return hasAnyRole(req.user, adminRoles, roleFieldFor(req, roleField))
  }
}

/**
 * Access control: Only allow users with admin roles.
 *
 * @param config - Configuration with admin roles
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   delete: isAdmin({ adminRoles: ['admin', 'superadmin'] }),
 * }
 * ```
 */
export function isAdmin(config: RoleCheckConfig = {}): Access {
  const checkAdmin = hasAdminRoles(config)

  return ({ req }) => {
    return checkAdmin({ req })
  }
}

/**
 * Field access control: Only allow users with admin roles.
 *
 * @param config - Configuration with admin roles
 * @returns Payload field access function
 *
 * @example
 * ```ts
 * fields: [
 *   {
 *     name: 'role',
 *     type: 'select',
 *     access: {
 *       update: isAdminField({ adminRoles: ['admin'] }),
 *     },
 *   },
 * ]
 * ```
 */
export function isAdminField(config: RoleCheckConfig = {}): FieldAccess {
  const checkAdmin = hasAdminRoles(config)

  return ({ req }) => {
    return checkAdmin({ req })
  }
}

/**
 * Access control: Allow admin OR the user accessing their own record.
 *
 * Returns a query constraint for non-admin users to limit access
 * to their own records only.
 *
 * @param config - Configuration with admin roles and ID field
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: isAdminOrSelf({ adminRoles: ['admin'] }),
 *   update: isAdminOrSelf({ adminRoles: ['admin'] }),
 * }
 * ```
 */
export function isAdminOrSelf(config: SelfAccessConfig = {}): Access {
  const { adminRoles = ['admin'], idField = 'id', roleField } = config
  const checkAdmin = hasAdminRoles({ adminRoles, roleField })

  return ({ req }) => {
    // Admins can access everything
    if (checkAdmin({ req })) return true

    // Non-authenticated users have no access
    if (!req.user) return false

    // Restrict to own record
    return {
      [idField]: {
        equals: req.user.id,
      },
    }
  }
}

/**
 * Access control: Allow admin OR user updating allowed fields on own record.
 *
 * This is useful for allowing users to update specific fields (like name)
 * on their own profile while preventing them from changing sensitive fields
 * like role.
 *
 * Password changes require `currentPassword` to be provided and validated.
 *
 * @param config - Configuration with admin roles, allowed fields, and user slug
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   update: canUpdateOwnFields({
 *     adminRoles: ['admin'],
 *     allowedFields: ['name', 'image'],
 *     userSlug: 'users',
 *   }),
 * }
 * ```
 */
export function canUpdateOwnFields(config: FieldUpdateConfig = {}): Access {
  const {
    adminRoles = ['admin'],
    allowedFields = ['name'],
    idField = 'id',
    userSlug = 'users',
    roleField,
  } = config
  const checkAdmin = hasAdminRoles({ adminRoles, roleField })

  void userSlug // retained for backward-compatible config shape; no longer used

  return async ({ req, id, data }) => {
    // Admins can update everything
    if (checkAdmin({ req })) return true

    // Must be authenticated
    if (!req.user) return false

    // Must be updating own record. Normalize types: ids may be numbers (SERIAL)
    // or strings (UUID/text) and can arrive as either across the two idTypes, so
    // a strict `!==` would wrongly deny (or, if coerced elsewhere, allow).
    const userId = req.user[idField]
    if (userId == null || id == null || String(userId) !== String(id) || !data) {
      return false
    }

    const dataKeys = Object.keys(data)

    // Password changes are NOT handled here. Verifying the current password in
    // an access function meant calling `payload.login` on every check — an
    // unauthenticated-at-this-layer, unthrottled brute-force oracle against the
    // user's own password. Password changes must go through Better Auth's native
    // change-password flow (`authClient.changePassword`), which requires the
    // current password AND is rate-limited. So we deny any update that touches
    // password fields and let Better Auth own that operation.
    if (dataKeys.includes('password') || dataKeys.includes('currentPassword')) {
      return false
    }

    // Check all fields are within the allowlist (top-level keys only).
    const hasDisallowed = dataKeys.some((key) => !allowedFields.includes(key))
    return !hasDisallowed
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated Access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Access control: Allow any authenticated user.
 *
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: isAuthenticated(),
 * }
 * ```
 */
export function isAuthenticated(): Access {
  return ({ req }) => {
    return !!req.user
  }
}

/**
 * Field access control: Allow any authenticated user.
 *
 * @returns Payload field access function
 */
export function isAuthenticatedField(): FieldAccess {
  return ({ req }) => {
    return !!req.user
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-Based Access
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Access control: Allow users with any of the specified roles.
 *
 * @param roles - Roles that have access
 * @param roleField - User property holding the role(s). Defaults to the
 *   configured `roleField`, then `'role'`.
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   read: hasRole(['admin', 'editor', 'viewer']),
 *   update: hasRole(['admin', 'editor']),
 * }
 * ```
 */
export function hasRole(roles: string[], roleField?: string): Access {
  return ({ req }) => {
    return hasAnyRole(req.user, roles, roleFieldFor(req, roleField))
  }
}

/**
 * Field access control: Allow users with any of the specified roles.
 *
 * @param roles - Roles that have access
 * @param roleField - User property holding the role(s). Defaults to the
 *   configured `roleField`, then `'role'`.
 * @returns Payload field access function
 */
export function hasRoleField(roles: string[], roleField?: string): FieldAccess {
  return ({ req }) => {
    return hasAnyRole(req.user, roles, roleFieldFor(req, roleField))
  }
}

/**
 * Access control: Allow users with all of the specified roles.
 *
 * @param roles - All roles required for access
 * @param roleField - User property holding the role(s). Defaults to the
 *   configured `roleField`, then `'role'`.
 * @returns Payload access function
 *
 * @example
 * ```ts
 * access: {
 *   delete: requireAllRoles(['admin', 'verified']),
 * }
 * ```
 */
export function requireAllRoles(roles: string[], roleField?: string): Access {
  return ({ req }) => {
    return hasAllRoles(req.user, roles, roleFieldFor(req, roleField))
  }
}
