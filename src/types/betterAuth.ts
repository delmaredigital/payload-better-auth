/**
 * Enhanced TypeScript types for Better Auth integration.
 *
 * Provides improved type inference for the Better Auth instance,
 * including session/user types, API methods, and error codes.
 */

import type { Auth, BetterAuthOptions } from 'better-auth/types'
import type { BasePayload, Endpoint, PayloadRequest } from 'payload'

/**
 * Role array type with configurable roles.
 */
export type RoleArray<O extends readonly string[] = readonly ['user']> =
  | O[number][]
  | null

/**
 * Override role field in a type with configured roles.
 */
type OverrideRole<T, O extends readonly string[]> = T extends object
  ? Omit<T, 'role'> & { role: RoleArray<O> }
  : T

/**
 * The return type of a Better Auth instance.
 *
 * Uses the official `Auth<O>` type from Better Auth 1.5, which provides
 * full type inference for API endpoints, session/user types, error codes,
 * and auth context.
 *
 * @template O - Better Auth options type for inference
 *
 * @example
 * ```ts
 * // Access inferred types
 * type MySession = typeof payload.betterAuth.$Infer.Session
 *
 * // Type-safe API calls
 * const result = await payload.betterAuth.api.getSession({ headers })
 * ```
 */
export type BetterAuthReturn<O extends BetterAuthOptions = BetterAuthOptions> = Auth<O>

/**
 * Payload instance with Better Auth attached.
 *
 * After initialization, the Payload instance is extended with
 * the `betterAuth` property containing the auth instance.
 *
 * @template O - Better Auth options type for inference
 *
 * @example
 * ```ts
 * // In a server action or API route
 * const payload = await getPayload({ config })
 * const payloadWithAuth = payload as PayloadWithAuth
 *
 * const session = await payloadWithAuth.betterAuth.api.getSession({ headers })
 * ```
 */
export type PayloadWithAuth<O extends BetterAuthOptions = BetterAuthOptions> =
  BasePayload & {
    betterAuth: BetterAuthReturn<O>
  }

/**
 * Extended Payload request with Better Auth instance.
 *
 * Use this type in hooks and endpoints to get type-safe
 * access to the Better Auth instance.
 *
 * @template O - Better Auth options type for inference
 *
 * @example
 * ```ts
 * const myHook: CollectionBeforeChangeHook = async ({ req }) => {
 *   const typedReq = req as PayloadRequestWithBetterAuth<typeof myBetterAuthOptions>
 *   const session = await typedReq.payload.betterAuth.api.getSession({
 *     headers: req.headers,
 *   })
 *   // ...
 * }
 * ```
 */
export interface PayloadRequestWithBetterAuth<
  O extends BetterAuthOptions = BetterAuthOptions,
> extends PayloadRequest {
  payload: PayloadWithAuth<O>
}

/**
 * Type utility for collection hooks with Better Auth context.
 *
 * Transforms a standard Payload hook type to include Better Auth
 * on the request's payload instance.
 *
 * @template O - Better Auth options type for inference
 * @template T - The original hook function type
 *
 * @example
 * ```ts
 * import type { CollectionBeforeChangeHook } from 'payload'
 *
 * const beforeChange: CollectionHookWithBetterAuth<
 *   typeof myOptions,
 *   CollectionBeforeChangeHook
 * > = async ({ req, data }) => {
 *   // req.payload.betterAuth is fully typed
 *   const session = await req.payload.betterAuth.api.getSession({
 *     headers: req.headers,
 *   })
 *   return data
 * }
 * ```
 */
export type CollectionHookWithBetterAuth<
  O extends BetterAuthOptions,
  T extends (args: Record<string, unknown>) => unknown,
> = T extends (args: infer A) => infer R
  ? (
      args: Omit<A, 'req'> & { req: PayloadRequestWithBetterAuth<O> }
    ) => R
  : never

/**
 * Payload endpoint type with Better Auth context.
 *
 * Use this for custom endpoints that need access to Better Auth.
 *
 * @template O - Better Auth options type for inference
 *
 * @example
 * ```ts
 * const myEndpoint: EndpointWithBetterAuth<typeof myOptions> = {
 *   path: '/custom-auth',
 *   method: 'post',
 *   handler: async (req) => {
 *     // req.payload.betterAuth is fully typed
 *     const session = await req.payload.betterAuth.api.getSession({
 *       headers: req.headers,
 *     })
 *     return Response.json({ session })
 *   },
 * }
 * ```
 */
export type EndpointWithBetterAuth<O extends BetterAuthOptions> = Omit<
  Endpoint,
  'handler'
> & {
  handler: (req: PayloadRequestWithBetterAuth<O>) => Promise<Response> | Response
}
