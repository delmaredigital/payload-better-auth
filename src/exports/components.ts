/**
 * Admin Components for Better Auth
 *
 * These components are auto-injected when disableLocalStrategy is detected.
 * They can also be used standalone or customized.
 */

export { LogoutButton } from '../components/LogoutButton.js'
export type { BeforeLoginProps } from '../components/BeforeLogin.js'
export { BeforeLogin } from '../components/BeforeLogin.js'
export type { LoginViewProps } from '../components/LoginView.js'
export { LoginView } from '../components/LoginView.js'

// Password reset components
export type { ForgotPasswordViewProps } from '../components/auth/ForgotPasswordView.js'
export { ForgotPasswordView } from '../components/auth/ForgotPasswordView.js'
export type { ResetPasswordViewProps } from '../components/auth/ResetPasswordView.js'
export { ResetPasswordView } from '../components/auth/ResetPasswordView.js'

// Two-factor authentication components
export type { TwoFactorSetupViewProps } from '../components/twoFactor/TwoFactorSetupView.js'
export { TwoFactorSetupView } from '../components/twoFactor/TwoFactorSetupView.js'
export type { TwoFactorVerifyViewProps } from '../components/twoFactor/TwoFactorVerifyView.js'
export { TwoFactorVerifyView } from '../components/twoFactor/TwoFactorVerifyView.js'

// Management UI field wrappers (for Payload ui fields)
export { TwoFactorField } from '../components/management/fields/TwoFactorField.js'

// Passkey components moved to '@delmaredigital/payload-better-auth/components/passkey'
// API key components moved to '@delmaredigital/payload-better-auth/components/api-key'
