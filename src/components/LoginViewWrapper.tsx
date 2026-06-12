import type { AdminViewProps } from 'payload'
import { LoginView, type LoginViewProps } from './LoginView.js'

type LoginConfig = Omit<LoginViewProps, 'authClient' | 'logo'>

type LoginViewWrapperProps = AdminViewProps

/**
 * Server component wrapper for LoginView.
 * Reads login configuration from payload.config.custom.betterAuth.login
 * and passes it as props to the client LoginView component.
 */
export async function LoginViewWrapper({ initPageResult }: LoginViewWrapperProps) {
  const { req } = initPageResult
  const { payload } = req

  // Read login config from payload.config.custom.betterAuth.login
  const loginConfig = (payload.config.custom?.betterAuth?.login ?? {}) as LoginConfig

  return (
    <LoginView
      afterLoginPath={loginConfig.afterLoginPath}
      requiredRole={loginConfig.requiredRole}
      requireAllRoles={loginConfig.requireAllRoles}
      enablePasskey={loginConfig.enablePasskey}
      enableSignUp={loginConfig.enableSignUp}
      defaultSignUpRole={loginConfig.defaultSignUpRole}
      enableForgotPassword={loginConfig.enableForgotPassword}
      resetPasswordUrl={loginConfig.resetPasswordUrl}
      enablePassword={loginConfig.enablePassword}
      enableMagicLink={loginConfig.enableMagicLink}
      enableEmailOtp={loginConfig.enableEmailOtp}
      magicLinkCallbackURL={loginConfig.magicLinkCallbackURL}
      title={loginConfig.title}
    />
  )
}

export default LoginViewWrapper
