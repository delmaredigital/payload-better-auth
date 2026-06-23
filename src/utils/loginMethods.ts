/**
 * Pure helpers for deciding which sign-in methods the LoginView should display.
 * Kept DOM-free so they can be unit-tested under the project's node-env vitest setup.
 */

/** A method-enable setting: explicit boolean, or 'auto' to defer to an endpoint probe. */
export type MethodSetting = boolean | 'auto'

/**
 * Resolve a `boolean | 'auto'` setting against the result of an endpoint probe.
 *
 * - `true`   -> always available
 * - `false`  -> never available
 * - `'auto'` -> available iff the probe succeeded (`probeOk === true`); a `null`
 *               probe (not yet completed) resolves to `false`.
 */
export function resolveAvailability(setting: MethodSetting, probeOk: boolean | null): boolean {
  if (setting === true) return true
  if (setting === false) return false
  return probeOk === true
}

/** The sign-in methods that can own the primary submit button. */
export type PrimaryMethod = 'password' | 'magicLink' | 'emailOtp'

/**
 * Choose which available method owns the primary submit button.
 * Precedence: password -> magicLink -> emailOtp. Returns null if none are available.
 */
export function pickPrimaryMethod(available: {
  password: boolean
  magicLink: boolean
  emailOtp: boolean
}): PrimaryMethod | null {
  if (available.password) return 'password'
  if (available.magicLink) return 'magicLink'
  if (available.emailOtp) return 'emailOtp'
  return null
}

/** Which sign-in methods a Better Auth instance actually has enabled. */
export interface DetectedMethods {
  password: boolean
  signup: boolean
  forgotPassword: boolean
  passkey: boolean
  magicLink: boolean
  emailOtp: boolean
}

/**
 * Minimal structural shape of the Better Auth resolved options we read.
 * Declared locally (not imported from better-auth) so this stays dependency-free
 * and unit-testable.
 */
export interface AuthOptionsLike {
  emailAndPassword?: {
    enabled?: boolean
    disableSignUp?: boolean
    sendResetPassword?: unknown
  }
  plugins?: Array<{ id?: string } | null | undefined>
}

/**
 * Determine which sign-in methods are enabled from a Better Auth instance's
 * resolved `options`. This is the authoritative, server-side replacement for the
 * old client-side endpoint probing: Better Auth answers every `OPTIONS` request
 * with 200 (CORS preflight), so probing `OPTIONS /sign-in/*` could never tell
 * whether a method was actually enabled.
 *
 * `forgotPassword` requires a configured `sendResetPassword` callback, since the
 * reset flow can't email a link without it.
 */
export function detectEnabledMethods(options: AuthOptionsLike | null | undefined): DetectedMethods {
  const ep = options?.emailAndPassword
  const password = !!ep?.enabled
  const pluginIds = new Set(
    (options?.plugins ?? [])
      .map((p) => p?.id)
      .filter((id): id is string => typeof id === 'string'),
  )
  return {
    password,
    signup: password && !ep?.disableSignUp,
    forgotPassword: password && !!ep?.sendResetPassword,
    passkey: pluginIds.has('passkey'),
    magicLink: pluginIds.has('magic-link'),
    emailOtp: pluginIds.has('email-otp'),
  }
}
