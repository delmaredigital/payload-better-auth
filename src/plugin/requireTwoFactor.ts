/**
 * Require a second factor before granting document access.
 *
 * @packageDocumentation
 */

import type { Access, Config, PayloadRequest, Plugin } from 'payload'
import type { BetterAuthOptions } from 'better-auth'
import { detectEnabledPlugins } from '../utils/detectEnabledPlugins.js'

export type RequireTwoFactorOptions = {
  /**
   * Toggle the gate without conditionally spreading the plugins array —
   * e.g. `enabled: process.env.NODE_ENV === 'production'`.
   * @default true
   */
  enabled?: boolean

  /**
   * User field that records an enrolled second factor. Better Auth's
   * `twoFactor()` plugin maintains `twoFactorEnabled`.
   * @default 'twoFactorEnabled'
   */
  fieldName?: string

  /** Collection slugs to leave ungated. */
  excludeCollections?: string[]

  /** Global slugs to leave ungated. */
  excludeGlobals?: string[]

  /**
   * Skip the gate for machine credentials — requests authenticated by an API
   * key or an OAuth bearer token (detected via the `apiKeyScopes` /
   * `oauthScopes` the strategy attaches to `req.user`). A machine can't enter
   * a TOTP code; its access is already constrained by its scopes.
   * @default true
   */
  exemptMachineCredentials?: boolean

  /** Custom escape hatch: return true to bypass the gate for this request. */
  exempt?: (req: PayloadRequest) => boolean

  /**
   * When provided, used to verify the Better Auth `twoFactor()` plugin is
   * actually enabled. Without it, a user can never enrol, so the gate would
   * lock every authenticated user out of gated operations — the plugin warns
   * at config-build time instead of failing silently at runtime.
   */
  betterAuthOptions?: Partial<BetterAuthOptions>
}

/** Mirrors Payload's default access: any authenticated user. */
const defaultAccess: Access = ({ req }) => Boolean(req.user)

const collectionAccessKeys = [
  'create',
  'read',
  'update',
  'delete',
  'readVersions',
  'unlock',
] as const

const globalAccessKeys = ['read', 'update', 'readVersions'] as const

/**
 * Payload plugin that denies collection and global operations to
 * authenticated users who have not enrolled a second factor.
 *
 * What it deliberately does NOT gate:
 * - **Anonymous requests** — public reads (your website) keep working; the
 *   gate only constrains signed-in users who skipped 2FA enrolment.
 * - **The `admin` access key** — a user must be able to reach the admin panel
 *   to complete enrolment. Pair this with an unauthorized redirect to your
 *   2FA setup view (`admin.routes.unauthorized`) for a guided flow.
 *
 * Operations whose access is undefined don't inherit Payload's permissive
 * default ("any authenticated user") — the gate fails closed by wrapping the
 * default-equivalent, so an ungated operation can't slip through.
 *
 * ORDER MATTERS: access gating works by wrapping the access functions present
 * in the config when this plugin runs, so it must be the LAST plugin in your
 * `plugins` array — after anything that defines or replaces access control
 * (e.g. an RBAC plugin). A later plugin that overwrites `collection.access`
 * would silently discard the gate. This is also why it can't be an inline
 * option of `createBetterAuthPlugin`, which typically runs early.
 *
 * @example
 * ```ts
 * import { requireTwoFactor } from '@delmaredigital/payload-better-auth'
 *
 * export default buildConfig({
 *   plugins: [
 *     createBetterAuthPlugin({ ... }),
 *     rbacPlugin({ ... }),
 *     // Last, so it wraps every other plugin's access control.
 *     requireTwoFactor({
 *       enabled: process.env.NODE_ENV === 'production',
 *       betterAuthOptions,
 *     }),
 *   ],
 * })
 * ```
 */
export function requireTwoFactor(
  options: RequireTwoFactorOptions = {}
): Plugin {
  const {
    enabled = true,
    fieldName = 'twoFactorEnabled',
    excludeCollections = [],
    excludeGlobals = [],
    exemptMachineCredentials = true,
    exempt,
    betterAuthOptions,
  } = options

  return (config: Config): Config => {
    if (!enabled) return config

    if (betterAuthOptions && !detectEnabledPlugins(betterAuthOptions).hasTwoFactor) {
      console.warn(
        '[requireTwoFactor] The gate is enabled but the Better Auth twoFactor() ' +
          'plugin was not detected in betterAuthOptions. Users have no way to ' +
          'enrol a second factor, so every authenticated user will be denied ' +
          'gated operations. Add twoFactor() to your Better Auth plugins, or ' +
          'disable this plugin.'
      )
    }

    const lacksSecondFactor = (req: PayloadRequest): boolean => {
      const user = req.user as
        | (PayloadRequest['user'] & Record<string, unknown>)
        | null

      if (!user) return false // anonymous access is governed by existing access control

      if (
        exemptMachineCredentials &&
        (user.apiKeyScopes !== undefined || user.oauthScopes !== undefined)
      ) {
        return false
      }

      if (exempt?.(req)) return false

      return user[fieldName] !== true
    }

    const gate =
      (original: Access | undefined): Access =>
      (args) =>
        lacksSecondFactor(args.req) ? false : (original ?? defaultAccess)(args)

    const gateAll = <T extends Record<string, unknown> | undefined>(
      access: T,
      keys: readonly string[]
    ): Record<string, unknown> => {
      const gated: Record<string, unknown> = { ...access }

      for (const key of keys) {
        gated[key] = gate(access?.[key] as Access | undefined)
      }

      // Wrap anything else that's defined too (except 'admin' — users must
      // reach the admin panel to enrol their second factor).
      for (const [key, fn] of Object.entries(access ?? {})) {
        if (key === 'admin' || keys.includes(key)) continue
        if (typeof fn === 'function') gated[key] = gate(fn as Access)
      }

      return gated
    }

    return {
      ...config,
      collections: config.collections?.map((collection) =>
        excludeCollections.includes(collection.slug)
          ? collection
          : {
              ...collection,
              access: gateAll(
                collection.access as Record<string, unknown> | undefined,
                collectionAccessKeys
              ),
            }
      ),
      globals: config.globals?.map((global) =>
        excludeGlobals.includes(global.slug)
          ? global
          : {
              ...global,
              access: gateAll(
                global.access as Record<string, unknown> | undefined,
                globalAccessKeys
              ),
            }
      ),
    }
  }
}
