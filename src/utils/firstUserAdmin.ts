/**
 * First User Admin Hook Utility
 *
 * Provides a Better Auth databaseHooks configuration that automatically
 * makes the first registered user an admin.
 *
 * @packageDocumentation
 */

import type { BetterAuthOptions } from 'better-auth'

export type FirstUserAdminOptions = {
  /**
   * Role to assign to the first user
   * @default 'admin'
   */
  adminRole?: string

  /**
   * Role to assign to subsequent users (if not already set)
   * @default 'user'
   */
  defaultRole?: string

  /**
   * Field name for the role field
   * @default 'role'
   */
  roleField?: string
}

/**
 * Creates Better Auth databaseHooks configuration that makes the first
 * registered user an admin.
 *
 * @example Basic usage
 * ```ts
 * import { betterAuth } from 'better-auth'
 * import { payloadAdapter } from '@delmaredigital/payload-better-auth/adapter'
 * import { firstUserAdminHooks } from '@delmaredigital/payload-better-auth'
 *
 * export const auth = betterAuth({
 *   database: payloadAdapter({ payloadClient: payload }),
 *   databaseHooks: firstUserAdminHooks(),
 * })
 * ```
 *
 * @example Custom roles
 * ```ts
 * export const auth = betterAuth({
 *   database: payloadAdapter({ payloadClient: payload }),
 *   databaseHooks: firstUserAdminHooks({
 *     adminRole: 'super-admin',
 *     defaultRole: 'member',
 *   }),
 * })
 * ```
 *
 * @example Merging with other hooks
 * ```ts
 * export const auth = betterAuth({
 *   database: payloadAdapter({ payloadClient: payload }),
 *   databaseHooks: {
 *     user: {
 *       create: {
 *         before: async (user, ctx) => {
 *           // First apply first-user-admin logic
 *           const result = await firstUserAdminHooks().user.create.before(user, ctx)
 *           const userData = result?.data ?? user
 *
 *           // Then apply your custom logic
 *           return {
 *             data: {
 *               ...userData,
 *               createdVia: 'custom-signup',
 *             },
 *           }
 *         },
 *         after: async (user) => {
 *           // Your after-create logic
 *           console.log('User created:', user.email)
 *         },
 *       },
 *     },
 *   },
 * })
 * ```
 */
export function firstUserAdminHooks(
  options?: FirstUserAdminOptions
): NonNullable<BetterAuthOptions['databaseHooks']> {
  const {
    adminRole = 'admin',
    defaultRole = 'user',
    roleField = 'role',
  } = options ?? {}

  // Using explicit any for the context type because Better Auth's
  // GenericEndpointContext type is complex and includes [x: string]: any.
  // The runtime behavior is what matters here.
  const beforeHook = async (
    user: Record<string, unknown>,
    ctx: unknown
  ): Promise<{ data: Record<string, unknown> }> => {
    try {
      // Access the adapter from context
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const context = ctx as { context?: { adapter?: any } } | null
      const adapter = context?.context?.adapter

      if (!adapter?.count) {
        // Adapter not available: assign the default role. Never honor an
        // incoming role here — this runs on the sign-up path where `user` is
        // client-controllable, so trusting `user[roleField]` would let a client
        // POST `{ role: 'admin' }` and self-escalate.
        return {
          data: {
            ...user,
            [roleField]: defaultRole,
          },
        }
      }

      const userCount = await adapter.count({
        model: 'user',
        where: [],
      })

      if (userCount === 0) {
        // First user becomes admin
        return {
          data: {
            ...user,
            [roleField]: adminRole,
          },
        }
      }

      // Subsequent users always get the default role. Role is a server-only
      // decision on the sign-up path; a client-supplied role is ignored. If you
      // need to assign specific roles to non-first users, do it from a trusted
      // context (Payload admin UI, seed script, or your own gated hook).
      return {
        data: {
          ...user,
          [roleField]: defaultRole,
        },
      }
    } catch (error) {
      // On error, don't block user creation - but fail closed on role: assign
      // the default rather than trusting a client-supplied role.
      console.warn('[firstUserAdminHooks] Failed to check user count:', error)
      return {
        data: {
          ...user,
          [roleField]: defaultRole,
        },
      }
    }
  }

  return {
    user: {
      create: {
        // Cast needed because Better Auth's hook types are complex
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        before: beforeHook as any,
      },
    },
  }
}
