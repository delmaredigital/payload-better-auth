/**
 * Require a second factor before granting document access.
 *
 * Enabled via the `requireTwoFactor` option of `createBetterAuthPlugin` and
 * applied during Payload's `onInit` — i.e. against the final, sanitized config,
 * after every plugin has finished shaping access control. That makes the gate
 * independent of plugin order: an RBAC plugin registered after
 * `createBetterAuthPlugin` is still wrapped.
 *
 * @packageDocumentation
 */

import type { Access, BasePayload, PayloadRequest } from 'payload'

export type RequireTwoFactorOptions = {
  /**
   * Toggle the gate without conditionally building options —
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
 * Wrap the access control of every collection and global on an initialized
 * Payload instance so authenticated users without a second factor are denied.
 *
 * What it deliberately does NOT gate:
 * - **Anonymous requests** — public reads (your website) keep working; the
 *   gate only constrains signed-in users who skipped 2FA enrolment.
 * - **The `admin` access key** — a user must be able to reach the admin panel
 *   to complete enrolment. Pair this with an unauthorized redirect to your
 *   2FA setup view (`admin.routes.unauthorized`) for a guided flow.
 * - **Payload's internal collections** (`payload-preferences`, ...) — the
 *   admin UI reads and writes these while an un-enrolled user is completing
 *   setup.
 *
 * Operations whose access is undefined don't inherit Payload's permissive
 * default ("any authenticated user") ungated — the gate wraps the
 * default-equivalent, so nothing slips through.
 */
export function applyRequireTwoFactorGate(
  payload: BasePayload,
  options: RequireTwoFactorOptions = {}
): void {
  const {
    fieldName = 'twoFactorEnabled',
    excludeCollections = [],
    excludeGlobals = [],
    exemptMachineCredentials = true,
    exempt,
  } = options

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

  const gateAll = <T>(access: T, keys: readonly string[]): T => {
    const existing = (access ?? {}) as Record<string, unknown>
    const gated: Record<string, unknown> = { ...existing }

    for (const key of keys) {
      gated[key] = gate(existing[key] as Access | undefined)
    }

    // Wrap anything else that's defined too (except 'admin' — users must
    // reach the admin panel to enrol their second factor).
    for (const [key, fn] of Object.entries(existing)) {
      if (key === 'admin' || keys.includes(key)) continue
      if (typeof fn === 'function') gated[key] = gate(fn as Access)
    }

    return gated as T
  }

  for (const collection of payload.config.collections ?? []) {
    // Internal collections appear in the sanitized config; the admin UI needs
    // them (e.g. preferences) while an un-enrolled user completes setup.
    if (collection.slug.startsWith('payload-')) continue
    if (excludeCollections.includes(collection.slug)) continue

    collection.access = gateAll(collection.access, collectionAccessKeys)
  }

  for (const global of payload.config.globals ?? []) {
    if (excludeGlobals.includes(global.slug)) continue

    global.access = gateAll(global.access, globalAccessKeys)
  }
}
