import type { AdminViewProps } from 'payload'
import { LoginView, type LoginViewProps } from './LoginView.js'
import type { PayloadWithAuth } from '../types/betterAuth.js'
import {
  detectEnabledMethods,
  resolveAvailability,
  type DetectedMethods,
  type MethodSetting,
} from '../utils/loginMethods.js'

type LoginConfig = Omit<LoginViewProps, 'authClient' | 'logo'>

type LoginViewWrapperProps = AdminViewProps

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
  const { req } = initPageResult
  const { payload } = req

  // Read login config from payload.config.custom.betterAuth.login
  const loginConfig = (payload.config.custom?.betterAuth?.login ?? {}) as LoginConfig

  // Detect which methods Better Auth actually has enabled, from its resolved options.
  const authOptions = (payload as PayloadWithAuth).betterAuth?.options
  const detected = authOptions ? detectEnabledMethods(authOptions) : FALLBACK_DETECTED

  // Resolve each option: explicit boolean wins; 'auto' (or unset) uses detection.
  const resolve = (setting: MethodSetting | undefined, detectedValue: boolean) =>
    resolveAvailability(setting ?? 'auto', detectedValue)

  return (
    <LoginView
      afterLoginPath={loginConfig.afterLoginPath}
      requiredRole={loginConfig.requiredRole}
      requireAllRoles={loginConfig.requireAllRoles}
      enablePassword={resolve(loginConfig.enablePassword, detected.password)}
      enableSignUp={resolve(loginConfig.enableSignUp, detected.signup)}
      defaultSignUpRole={loginConfig.defaultSignUpRole}
      enableForgotPassword={resolve(loginConfig.enableForgotPassword, detected.forgotPassword)}
      enablePasskey={resolve(loginConfig.enablePasskey, detected.passkey)}
      enableMagicLink={resolve(loginConfig.enableMagicLink, detected.magicLink)}
      enableEmailOtp={resolve(loginConfig.enableEmailOtp, detected.emailOtp)}
      resetPasswordUrl={loginConfig.resetPasswordUrl}
      magicLinkCallbackURL={loginConfig.magicLinkCallbackURL}
      title={loginConfig.title}
    />
  )
}

export default LoginViewWrapper
