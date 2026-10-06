import type { AdminViewProps } from 'payload'
import { getAuthTables } from 'better-auth/db'
import type { BetterAuthOptions } from 'better-auth'
import { LoginView, type LoginViewProps } from './LoginView.js'
import type { PayloadWithAuth } from '../types/betterAuth.js'
import type { AuthContextLike } from '../utils/loginMethods.js'
import {
  detectEnabledMethods,
  detectOtpLengths,
  resolveAvailability,
  detectSocialProviders,
  resolveSocialProviders,
  DEFAULT_OTP_LENGTHS,
  type DetectedMethods,
  type MethodSetting,
} from '../utils/loginMethods.js'
import { getRoleField } from '../utils/access.js'

type LoginConfig = Omit<
  LoginViewProps,
  'authClient' | 'logo' | 'socialProviders' | 'roleField'
> & {
  enableSocial?: boolean | string[]
}

type LoginViewWrapperProps = AdminViewProps

/**
 * Props resolved server-side and safe to pass across the RSC boundary to a
 * client LoginView (all serializable — no `authClient`/`logo`).
 */
export type ResolvedLoginViewProps = Omit<LoginViewProps, 'authClient' | 'logo'>

/**
 * Resolve the LoginView props from a Payload instance: read the login config and
 * resolve each `'auto'` method against the Better Auth instance's resolved
 * context (`auth.$context`). Shared by the default wrapper and the passkey-enabled
 * wrapper so the (long) prop list has a single source of truth.
 */
export async function resolveLoginViewProps(
  payload: LoginViewWrapperProps['initPageResult']['req']['payload']
): Promise<ResolvedLoginViewProps> {
  const loginConfig = (payload.config.custom?.betterAuth?.login ?? {}) as LoginConfig
  // Plugin's mount segment under routes.api — the login page renders with the
  // unauthenticated client config (no `admin.custom`), so hand it across the
  // RSC boundary explicitly for the client to build correct auth URLs.
  const authBasePath = payload.config.custom?.betterAuth?.authBasePath as string | undefined
  const auth = (payload as PayloadWithAuth).betterAuth
  // Better Auth's RESOLVED context, not `auth.options`. `auth.options` is the raw
  // object handed to `betterAuth()`; the context carries the options as they stand
  // after every plugin's `init()` ran, plus the social providers Better Auth actually
  // resolved. Detecting off the raw config means missing whatever plugins contribute
  // — which is exactly how genericOAuth providers went undetected (issue #32).
  const context = auth ? await resolveAuthContext(auth, payload) : null
  // If the context failed to resolve, fall back to the raw options so the page still
  // renders a password form; Better Auth already logged the underlying failure.
  const authOptions = context?.options ?? auth?.options
  const detected = authOptions ? detectEnabledMethods(authOptions) : FALLBACK_DETECTED
  const otpLengths = authOptions ? detectOtpLengths(authOptions) : DEFAULT_OTP_LENGTHS
  // No context means no trustworthy provider list: render no social buttons rather
  // than buttons that would 'Provider not found' on click.
  const detectedSocial = context ? await detectSocialProviders(context) : []
  const socialProviders = resolveSocialProviders(loginConfig.enableSocial, detectedSocial)

  const resolve = (setting: MethodSetting | undefined, detectedValue: boolean) =>
    resolveAvailability(setting ?? 'auto', detectedValue)

  // Set on betterAuthCollections(), not under admin.login: one value for every
  // role check. The login gate reads Better Auth's session user, so translate
  // the stored name to the session key when `fieldName` renames the field.
  const roleField = sessionRoleKey(authOptions, getRoleField(payload.config))

  return {
    afterLoginPath: loginConfig.afterLoginPath,
    requiredRole: loginConfig.requiredRole,
    requireAllRoles: loginConfig.requireAllRoles,
    roleField,
    enablePassword: resolve(loginConfig.enablePassword, detected.password),
    enableSignUp: resolve(loginConfig.enableSignUp, detected.signup),
    defaultSignUpRole: loginConfig.defaultSignUpRole,
    enableForgotPassword: resolve(loginConfig.enableForgotPassword, detected.forgotPassword),
    enablePasskey: resolve(loginConfig.enablePasskey, detected.passkey),
    enableMagicLink: resolve(loginConfig.enableMagicLink, detected.magicLink),
    enableEmailOtp: resolve(loginConfig.enableEmailOtp, detected.emailOtp),
    enableTwoFactorBackupCode: resolve(
      loginConfig.enableTwoFactorBackupCode,
      detected.twoFactorBackupCode
    ),
    enableTwoFactorEmailOtp: resolve(
      loginConfig.enableTwoFactorEmailOtp,
      detected.twoFactorEmailOtp
    ),
    resetPasswordUrl: loginConfig.resetPasswordUrl,
    magicLinkCallbackURL: loginConfig.magicLinkCallbackURL,
    socialProviders,
    socialCallbackURL: loginConfig.socialCallbackURL,
    title: loginConfig.title,
    authBasePath,
    otpLengths,
  }
}

/**
 * Fallback used when the Better Auth instance isn't available on `payload` yet.
 * Show password (so admins are never locked out) and hide the optional methods
 * (so we never render a button for a plugin that may be absent).
 */
const FALLBACK_DETECTED: DetectedMethods = {
  password: true,
  signup: false,
  forgotPassword: false,
  passkey: false,
  magicLink: false,
  emailOtp: false,
  // The 2FA step only renders when the server demanded a second factor, so the
  // backup-code escape hatch is safe to keep; the emailed code needs otpOptions.
  twoFactorBackupCode: true,
  twoFactorEmailOtp: false,
}

/**
 * Translate `roleField` to the key the Better Auth session user actually
 * carries. `roleField` names the stored field — on the Payload document AND in
 * Better Auth's schema when `fieldName` remaps it (`role: { fieldName:
 * 'roles' }` stores `roles`). The session user, though, keys additional fields
 * by their schema key (`role`), so the login gate must read that key or a
 * renamed role field locks real admins out. When no schema field stores under
 * `roleField` — a Payload-only role field, say — the name passes through.
 */
function sessionRoleKey(authOptions: unknown, roleField: string): string {
  if (!authOptions) return roleField
  try {
    const userTable = getAuthTables(authOptions as BetterAuthOptions).user
    for (const [key, fieldDef] of Object.entries(userTable?.fields ?? {})) {
      if ((fieldDef.fieldName ?? key) === roleField) return key
    }
  } catch {
    // Schema not derivable from these options — keep the configured name.
  }
  return roleField
}

/**
 * Await `auth.$context`, tolerating a rejection.
 *
 * `$context` is a single promise built once by `betterAuth()`, so awaiting it per
 * render costs nothing after boot. It can reject, though — genericOAuth's `init()`
 * throws when OIDC discovery fails and no `accountIssuer` pins the account
 * namespace — and a login page that 500s locks the admin out of the very screen
 * they'd use to fix it. Log and let the caller fall back.
 */
async function resolveAuthContext(
  auth: PayloadWithAuth['betterAuth'],
  payload: LoginViewWrapperProps['initPageResult']['req']['payload']
): Promise<AuthContextLike | null> {
  try {
    return (await auth.$context) as AuthContextLike
  } catch (err) {
    payload.logger?.error(
      { err },
      '[better-auth] Could not resolve the Better Auth context; the login page is ' +
        'falling back to unresolved options (social sign-in buttons are hidden).'
    )
    return null
  }
}

/**
 * Server component wrapper for LoginView.
 *
 * Reads login configuration from `payload.config.custom.betterAuth.login` and
 * resolves each `'auto'` option against the Better Auth instance's resolved
 * context (server-side), passing concrete booleans to the client LoginView.
 *
 * This replaces the old client-side `OPTIONS` endpoint probing: Better Auth
 * answers every `OPTIONS` request with 200 (CORS preflight), so probing could
 * never determine whether a method was actually enabled. The resolved server-side
 * context is authoritative — and, unlike `auth.options`, it accounts for whatever
 * the configured plugins contributed during their `init()`.
 */
export async function LoginViewWrapper({ initPageResult }: LoginViewWrapperProps) {
  const { payload } = initPageResult.req
  return <LoginView {...(await resolveLoginViewProps(payload))} />
}

export default LoginViewWrapper
