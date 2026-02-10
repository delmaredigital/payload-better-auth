/**
 * Server-side session utilities
 *
 * @packageDocumentation
 */

import type { BasePayload } from 'payload'
import type { PayloadWithAuth } from '../plugin/index.js'

type DefaultUser = {
  id: string
  email: string
  name?: string
  image?: string
  [key: string]: unknown
}

export type Session<TUser = DefaultUser> = {
  user: TUser
  session: {
    id: string
    expiresAt: Date
    [key: string]: unknown
  }
}

/**
 * Get the current session from headers.
 *
 * Accepts an optional generic type parameter to narrow the user type.
 * Pass your Payload-generated `User` type for full type safety.
 *
 * @example
 * ```ts
 * import { headers } from 'next/headers'
 * import { getServerSession } from '@delmaredigital/payload-better-auth'
 * import type { User } from '@/payload-types'
 *
 * export default async function Page() {
 *   const headersList = await headers()
 *   const session = await getServerSession<User>(payload, headersList)
 *
 *   if (!session) {
 *     redirect('/login')
 *   }
 *
 *   // session.user.role is fully typed
 *   return <div>Hello {session.user.name}</div>
 * }
 * ```
 */
export async function getServerSession<TUser = DefaultUser>(
  payload: BasePayload,
  headers: Headers
): Promise<Session<TUser> | null> {
  try {
    const payloadWithAuth = payload as PayloadWithAuth

    if (!payloadWithAuth.betterAuth) {
      console.error('[session] Better Auth not initialized')
      return null
    }

    const session = await payloadWithAuth.betterAuth.api.getSession({ headers })
    return session as Session<TUser> | null
  } catch (error) {
    console.error('[session] Error getting session:', error)
    return null
  }
}

/**
 * Get the current user from the session.
 *
 * Accepts an optional generic type parameter to narrow the user type.
 *
 * @example
 * ```ts
 * import { headers } from 'next/headers'
 * import { getServerUser } from '@delmaredigital/payload-better-auth'
 * import type { User } from '@/payload-types'
 *
 * export default async function Page() {
 *   const headersList = await headers()
 *   const user = await getServerUser<User>(payload, headersList)
 *
 *   if (!user) {
 *     redirect('/login')
 *   }
 *
 *   return <div>Hello {user.name}</div>
 * }
 * ```
 */
export async function getServerUser<TUser = DefaultUser>(
  payload: BasePayload,
  headers: Headers
): Promise<TUser | null> {
  const session = await getServerSession<TUser>(payload, headers)
  return session?.user ?? null
}

export type SessionHelperOptions = {
  /**
   * ID type strategy matching your adapter's `adapterConfig.idType`.
   *
   * Set to `'number'` when using Payload's default serial IDs.
   * Better Auth always returns string IDs from `api.getSession()` —
   * this option coerces `id` and `*Id` / `*_id` fields to numbers
   * so they work directly in Payload relationship fields.
   *
   * @default undefined (no coercion)
   */
  idType?: 'number' | 'text'
}

/**
 * Coerce numeric-string ID fields to numbers on a shallow object.
 * Matches the adapter's heuristic: `id`, fields ending in `Id` or `_id`.
 */
function coerceIds<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  const result = { ...obj } as Record<string, unknown>
  for (const [key, value] of Object.entries(result)) {
    if (typeof value !== 'string') continue
    if (key === 'id' || /(?:Id|_id)$/.test(key)) {
      if (/^\d+$/.test(value)) {
        result[key] = parseInt(value, 10)
      }
    }
  }
  return result as T
}

/**
 * Create typed session helpers bound to your User type.
 *
 * Define once in a shared file, then import the typed helpers
 * everywhere — no generics needed at call sites.
 *
 * @example
 * ```ts
 * // lib/auth.ts
 * import { createSessionHelpers } from '@delmaredigital/payload-better-auth'
 * import type { User } from '@/payload-types'
 *
 * export const { getServerSession, getServerUser } = createSessionHelpers<User>()
 * ```
 *
 * @example
 * ```ts
 * // With serial IDs (Payload default) — coerces string IDs to numbers
 * export const { getServerSession, getServerUser } = createSessionHelpers<User>({
 *   idType: 'number',
 * })
 * ```
 *
 * ```ts
 * // app/page.tsx
 * import { getServerSession } from '@/lib/auth'
 *
 * const session = await getServerSession(payload, headersList)
 * // session.user is typed as User — no generic needed
 * // session.user.id is a number when idType: 'number'
 * ```
 */
export function createSessionHelpers<TUser = DefaultUser>(
  options?: SessionHelperOptions
) {
  const shouldCoerceIds = options?.idType === 'number'

  const typedGetServerSession = async (
    payload: BasePayload,
    headers: Headers
  ): Promise<Session<TUser> | null> => {
    const session = await getServerSession<TUser>(payload, headers)
    if (!session || !shouldCoerceIds) return session
    return {
      user: coerceIds(session.user),
      session: coerceIds(session.session),
    }
  }

  return {
    getServerSession: typedGetServerSession,
    getServerUser: async (
      payload: BasePayload,
      headers: Headers
    ): Promise<TUser | null> => {
      const session = await typedGetServerSession(payload, headers)
      return session?.user ?? null
    },
  }
}
