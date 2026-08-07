import type { AdminViewProps } from 'payload'
import { LoginView, type LoginViewProps } from './LoginView.js'
import type { PayloadWithAuth } from '../types/betterAuth.js'
import {
  detectEnabledMethods,
  resolveAvailability,
  detectSocialProviders,
  resolveSocialProviders,
  type DetectedMethods,
  type MethodSetting,
} from '../utils/loginMethods.js'

type LoginConfig = Omit<LoginViewProps, 'authClient' | 'logo' | 'socialProviders'> & {
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
 * resolve each `'auto'` method against the Better Auth instance's server-side
 * options. Shared by the default wrapper and the passkey-enabled wrapper so the
 * (long) prop list has a single source of truth.
 */
export function resolveLoginViewProps(
  payload: LoginViewWrapperProps['initPageResult']['req']['payload']
): ResolvedLoginViewProps {
  const loginConfig = (payload.config.custom?.betterAuth?.login ?? {}) as LoginConfig
  // Plugin's mount segment under routes.api — the login page renders with the
  // unauthenticated client config (no `admin.custom`), so hand it across the
  // RSC boundary explicitly for the client to build correct auth URLs.
  const authBasePath = payload.config.custom?.betterAuth?.authBasePath as string | undefined
  const authOptions = (payload as PayloadWithAuth).betterAuth?.options
  const detected = authOptions ? detectEnabledMethods(authOptions) : FALLBACK_DETECTED
  const detectedSocial = authOptions ? detectSocialProviders(authOptions) : []
  const socialProviders = resolveSocialProviders(loginConfig.enableSocial, detectedSocial)

  const resolve = (setting: MethodSetting | undefined, detectedValue: boolean) =>
    resolveAvailability(setting ?? 'auto', detectedValue)

  return {
    afterLoginPath: loginConfig.afterLoginPath,
    requiredRole: loginConfig.requiredRole,
    requireAllRoles: loginConfig.requireAllRoles,
    enablePassword: resolve(loginConfig.enablePassword, detected.password),
    enableSignUp: resolve(loginConfig.enableSignUp, detected.signup),
    defaultSignUpRole: loginConfig.defaultSignUpRole,
    enableForgotPassword: resolve(loginConfig.enableForgotPassword, detected.forgotPassword),
    enablePasskey: resolve(loginConfig.enablePasskey, detected.passkey),
    enableMagicLink: resolve(loginConfig.enableMagicLink, detected.magicLink),
    enableEmailOtp: resolve(loginConfig.enableEmailOtp, detected.emailOtp),
    resetPasswordUrl: loginConfig.resetPasswordUrl,
    magicLinkCallbackURL: loginConfig.magicLinkCallbackURL,
    socialProviders,
    socialCallbackURL: loginConfig.socialCallbackURL,
    title: loginConfig.title,
    authBasePath,
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
}

/**
 * Server component wrapper for LoginView.
 *
 * Reads login configuration from `payload.config.custom.betterAuth.login` and
 * resolves each `'auto'` option against the Better Auth instance's resolved
 * `options` (server-side), passing concrete booleans to the client LoginView.
 *
 * This replaces the old client-side `OPTIONS` endpoint probing: Better Auth
 * answers every `OPTIONS` request with 200 (CORS preflight), so probing could
 * never determine whether a method was actually enabled. The server `options`
 * are authoritative.
 */
export async function LoginViewWrapper({ initPageResult }: LoginViewWrapperProps) {
  const { payload } = initPageResult.req
  return <LoginView {...resolveLoginViewProps(payload)} />
}

export default LoginViewWrapper
