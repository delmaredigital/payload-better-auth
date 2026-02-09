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
 * ```ts
 * // app/page.tsx
 * import { getServerSession } from '@/lib/auth'
 *
 * const session = await getServerSession(payload, headersList)
 * // session.user is typed as User — no generic needed
 * ```
 */
export function createSessionHelpers<TUser = DefaultUser>() {
  return {
    getServerSession: (payload: BasePayload, headers: Headers) =>
      getServerSession<TUser>(payload, headers),
    getServerUser: (payload: BasePayload, headers: Headers) =>
      getServerUser<TUser>(payload, headers),
  }
}
