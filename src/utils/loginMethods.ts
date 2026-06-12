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
