'use client'

import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation.js'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient, magicLinkClient, emailOTPClient } from 'better-auth/client/plugins'
import { hasAnyRole, hasAllRoles, normalizeRoles } from '../utils/access.js'
import { resolveAvailability, pickPrimaryMethod } from '../utils/loginMethods.js'
import { useConfig } from '@payloadcms/ui'
import { AuthCard } from './login/AuthCard.js'
import { AuthBanner } from './login/AuthBanner.js'
import { AuthButton } from './login/AuthButton.js'
import { AuthField } from './login/AuthField.js'
import { OrDivider } from './login/OrDivider.js'
import { OtpInput } from './login/OtpInput.js'
import { LoadingScreen } from './login/LoadingScreen.js'
import { AccessDeniedScreen } from './login/AccessDeniedScreen.js'
import { EmailSentScreen } from './login/EmailSentScreen.js'
import { TwoFactorForm } from './login/TwoFactorForm.js'
import { EmailOtpForm } from './login/EmailOtpForm.js'
import { ForgotPasswordForm } from './login/ForgotPasswordForm.js'
import { RegisterForm } from './login/RegisterForm.js'

export type LoginViewProps = {
  /** Optional pre-configured auth client */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
  /** Custom logo element */
  logo?: React.ReactNode
  /** Login page title. Default: 'Login' */
  title?: string
  /** Path to redirect after successful login. Default: '/admin' */
  afterLoginPath?: string
  /**
   * Required role(s) for admin access.
   * - string: Single role required (default: 'admin')
   * - string[]: Multiple roles (behavior depends on requireAllRoles)
   * - null/undefined: Disable role checking
   * For complex RBAC beyond these options, disable the login view and create your own.
   */
  requiredRole?: string | string[] | null
  /**
   * When requiredRole is an array, require ALL roles (true) or ANY role (false).
   * Default: false (any matching role grants access)
   */
  requireAllRoles?: boolean
  /**
   * Enable passkey (WebAuthn) sign-in option.
   * - true: Always show passkey button
   * - false: Never show passkey button
   * - 'auto' (default): Auto-detect if passkey plugin is available
   */
  enablePasskey?: boolean | 'auto'
  /**
   * Enable user registration (sign up) option.
   * - true: Always show "Create account" link
   * - false: Never show registration option
   * - 'auto' (default): Auto-detect if sign-up endpoint is available
   */
  enableSignUp?: boolean | 'auto'
  /**
   * Default role to assign to new users during registration.
   * Default: 'user'
   */
  defaultSignUpRole?: string
  /**
   * Enable forgot password option.
   * - true: Always show "Forgot password?" link
   * - false: Never show forgot password option
   * - 'auto' (default): Auto-detect if forget-password endpoint is available
   */
  enableForgotPassword?: boolean | 'auto'
  /**
   * Custom URL for password reset page. If provided, users will be redirected here
   * instead of showing the inline password reset form.
   * The reset token will be appended as ?token=xxx
   */
  resetPasswordUrl?: string
  /**
   * Enable email + password sign-in.
   * - true: Always show the password field
   * - false: Hide the password field (passwordless-only)
   * - 'auto' (default): Auto-detect via the /sign-in/email endpoint
   */
  enablePassword?: boolean | 'auto'
  /**
   * Enable magic-link sign-in ("email me a link").
   * - true / false / 'auto' (default: auto-detect via /sign-in/magic-link)
   */
  enableMagicLink?: boolean | 'auto'
  /**
   * Enable email-OTP sign-in ("email me a code").
   * - true / false / 'auto' (default: auto-detect via /email-otp/send-verification-otp)
   */
  enableEmailOtp?: boolean | 'auto'
  /**
   * Where the emailed magic link returns after verification.
   * Default: afterLoginPath
   */
  magicLinkCallbackURL?: string
}

/**
 * Check if user has the required role(s)
 */
function checkUserRoles(
  user: { role?: unknown } | null | undefined,
  requiredRole: string | string[] | null | undefined,
  requireAllRoles: boolean
): boolean {
  // No role requirement = access granted
  if (!requiredRole) return true

  // No user = access denied
  if (!user) return false

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

  if (requireAllRoles) {
    return hasAllRoles(user, roles)
  }

  return hasAnyRole(user, roles)
}

/**
 * Full login page component matching Payload's admin theme.
 * Registered as a custom admin view at /admin/login.
 */
type ViewMode =
  | 'login'
  | 'register'
  | 'forgotPassword'
  | 'resetSent'
  | 'twoFactor'
  | 'emailOtp'
  | 'magicLinkSent'

export function LoginView({
  authClient: providedClient,
  logo,
  title = 'Login',
  afterLoginPath = '/admin',
  requiredRole = 'admin',
  requireAllRoles = false,
  enablePasskey = 'auto',
  enableSignUp = 'auto',
  defaultSignUpRole = 'user',
  enableForgotPassword = 'auto',
  resetPasswordUrl,
  enablePassword = 'auto',
  enableMagicLink = 'auto',
  enableEmailOtp = 'auto',
  magicLinkCallbackURL,
}: LoginViewProps) {
  const router = useRouter()

  // Payload Config
  const {config: {routes: {admin:adminRoute}}} = useConfig()
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('login')

  // Form fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // UI state
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [passkeyLoading, setPasskeyLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)

  // Which methods to show. LoginViewWrapper resolves these server-side from the
  // Better Auth instance's options and passes concrete booleans. For standalone
  // <LoginView> use, an unresolved 'auto' falls back to safe defaults: password
  // shown, optional methods hidden. We no longer probe endpoints — Better Auth
  // answers every OPTIONS request with 200 (CORS preflight), so probing could
  // never tell whether a method was actually enabled.
  const passwordAvailable = resolveAvailability(enablePassword, true)
  const passkeyAvailable = resolveAvailability(enablePasskey, false)
  const signUpAvailable = resolveAvailability(enableSignUp, false)
  const forgotPasswordAvailable = resolveAvailability(enableForgotPassword, false)
  const magicLinkAvailable = resolveAvailability(enableMagicLink, false)
  const emailOtpAvailable = resolveAvailability(enableEmailOtp, false)

  // Email-OTP code entry state
  const [otp, setOtp] = useState('')
  const [otpLoading, setOtpLoading] = useState(false)

  // Two-factor authentication state
  const [totpCode, setTotpCode] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)
  const getClient = async () => {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    const { passkeyClient } = await import('@better-auth/passkey/client')
    clientRef.current = createAuthClient({
      plugins: [twoFactorClient(), magicLinkClient(), emailOTPClient(), passkeyClient()],
    })
    return clientRef.current
  }

  // Check if user is already logged in on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const client = await getClient()
        const result = await client.getSession()

        if (result.data?.user) {
          const user = result.data.user as { role?: unknown }
          // User is logged in, check role
          if (checkUserRoles(user, requiredRole, requireAllRoles)) {
            router.push(afterLoginPath)
            return
          } else {
            setAccessDenied(true)
          }
        }
      } catch {
        // No session, show login form
      }
      setCheckingSession(false)
    }
    checkSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterLoginPath, requiredRole, requireAllRoles, router])

  /**
   * Shared post-authentication tail: re-fetch the session for complete user data
   * (e.g. roles applied by hooks), enforce the role gate, and redirect on success.
   * Returns the outcome so each caller can reset its own loading flag / show its own
   * "no session" message.
   */
  async function completeSignIn(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
  ): Promise<'redirected' | 'accessDenied' | 'noSession'> {
    const sessionResult = await client.getSession()
    if (!sessionResult.data?.user) return 'noSession'
    const user = sessionResult.data.user as { role?: unknown }
    if (!checkUserRoles(user, requiredRole, requireAllRoles)) {
      setAccessDenied(true)
      return 'accessDenied'
    }
    router.push(afterLoginPath)
    router.refresh()
    return 'redirected'
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    setAccessDenied(false)

    try {
      const client = await getClient()
      const result = await client.signIn.email({
        email,
        password,
      })

      // Check if 2FA is required (use 'in' operator for proper TypeScript inference)
      if (result.data && 'twoFactorRedirect' in result.data && result.data.twoFactorRedirect) {
        setViewMode('twoFactor')
        setLoading(false)
        return
      }

      if (result.error) {
        setError(result.error.message ?? 'Invalid credentials')
        setLoading(false)
        return
      }

      if (result.data?.user) {
        const outcome = await completeSignIn(client)
        if (outcome === 'noSession') {
          setError('Sign-in succeeded but session could not be verified')
          setLoading(false)
        } else if (outcome === 'accessDenied') {
          setLoading(false)
        }
      }
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    // Validate passwords match
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    // Validate password strength (basic)
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      setLoading(false)
      return
    }

    try {
      const client = await getClient()
      const result = await client.signUp.email({
        email,
        password,
        name,
        role: defaultSignUpRole,
      } as Parameters<typeof client.signUp.email>[0])

      if (result.error) {
        setError(result.error.message ?? 'Registration failed')
        setLoading(false)
        return
      }

      // Registration successful - either auto-signed in or need to verify email
      if (result.data?.user) {
        // Re-fetch session via completeSignIn to pick up hook-applied roles
        // (e.g. firstUserAdmin sets the role after creation).
        const outcome = await completeSignIn(client)
        if (outcome === 'noSession') {
          setError('Account created but session could not be verified. Please sign in.')
          setLoading(false)
        } else if (outcome === 'accessDenied') {
          setLoading(false)
        }
      } else {
        // Likely requires email verification - show success and switch to login
        setSuccessMessage('Account created! Please check your email to verify your account.')
        setViewMode('login')
        setPassword('')
        setConfirmPassword('')
        setLoading(false)
      }
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  async function handleForgotPassword(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccessMessage(null)

    try {
      const client = await getClient()
      const result = await client.requestPasswordReset({
        email,
        redirectTo: resetPasswordUrl ?? `${window.location.origin}${adminRoute}/reset-password`,
      })

      if (result.error) {
        setError(result.error.message ?? 'Failed to send reset email')
        setLoading(false)
        return
      }

      // Success - show confirmation
      setViewMode('resetSent')
      setLoading(false)
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  async function handleTotpVerify(e: FormEvent) {
    e.preventDefault()
    setTotpLoading(true)
    setError(null)

    try {
      const client = await getClient()
      const result = await client.twoFactor.verifyTotp({ code: totpCode })

      if (result.error) {
        setError(result.error.message ?? 'Invalid verification code')
        setTotpLoading(false)
        return
      }

      // verify-totp may not return all user fields (e.g. custom 'role');
      // completeSignIn re-fetches the session for the role gate.
      const outcome = await completeSignIn(client)
      if (outcome === 'noSession') {
        setError('Sign-in succeeded but session could not be verified')
        setTotpLoading(false)
      } else if (outcome === 'accessDenied') {
        setTotpLoading(false)
      }
    } catch {
      setError('An error occurred. Please try again.')
      setTotpLoading(false)
    }
  }

  function switchView(newView: ViewMode) {
    setViewMode(newView)
    setError(null)
    setSuccessMessage(null)
    // Reset form fields based on context
    if (newView === 'login') {
      setTotpCode('')
      setConfirmPassword('')
      setOtp('')
    } else if (newView === 'register') {
      setPassword('')
      setConfirmPassword('')
    } else if (newView === 'forgotPassword') {
      setPassword('')
    }
  }

  function handleBackToLogin() {
    switchView('login')
  }

  async function handlePasskeySignIn() {
    if (!passkeyAvailable) return

    setPasskeyLoading(true)
    setError(null)
    setAccessDenied(false)

    try {
      const client = await getClient()
      const result = await client.signIn.passkey()

      if (result.error) {
        setError(result.error.message ?? 'Passkey authentication failed')
        setPasskeyLoading(false)
        return
      }

      // Passkey sign-in succeeded - completeSignIn re-fetches the session for full
      // user data (including role), more reliable than result.data.user across SDK versions.
      const outcome = await completeSignIn(client)
      if (outcome === 'noSession') {
        setError('Authentication succeeded but session could not be verified')
        setPasskeyLoading(false)
      } else if (outcome === 'accessDenied') {
        setPasskeyLoading(false)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Passkey authentication was cancelled or not allowed')
      } else {
        setError(err instanceof Error ? err.message : 'Passkey authentication failed')
      }
      setPasskeyLoading(false)
    }
  }

  async function handleSendMagicLink(e?: FormEvent) {
    e?.preventDefault()
    if (!email) {
      setError('Please enter your email address first')
      return
    }
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const client = await getClient()
      const result = await client.signIn.magicLink({
        email,
        callbackURL: magicLinkCallbackURL ?? afterLoginPath,
      })
      if (result.error) {
        setError(result.error.message ?? 'Failed to send sign-in link')
        setLoading(false)
        return
      }
      setViewMode('magicLinkSent')
      setLoading(false)
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  async function handleSendEmailOtp(e?: FormEvent) {
    e?.preventDefault()
    if (!email) {
      setError('Please enter your email address first')
      return
    }
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const client = await getClient()
      const result = await client.emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
      if (result.error) {
        setError(result.error.message ?? 'Failed to send verification code')
        setLoading(false)
        return
      }
      setOtp('')
      setViewMode('emailOtp')
      setLoading(false)
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  async function handleVerifyEmailOtp(e: FormEvent) {
    e.preventDefault()
    setOtpLoading(true)
    setError(null)
    try {
      const client = await getClient()
      const result = await client.signIn.emailOtp({ email, otp })
      if (result.error) {
        setError(result.error.message ?? 'Invalid verification code')
        setOtpLoading(false)
        return
      }
      const outcome = await completeSignIn(client)
      if (outcome === 'noSession') {
        setError('Sign-in succeeded but session could not be verified')
        setOtpLoading(false)
      } else if (outcome === 'accessDenied') {
        setOtpLoading(false)
      }
    } catch {
      setError('An error occurred. Please try again.')
      setOtpLoading(false)
    }
  }

  async function handleSignOut() {
    const client = await getClient()
    await client.signOut()
    setAccessDenied(false)
    router.refresh()
  }

  // Loading state while checking session
  if (checkingSession) {
    return <LoadingScreen />
  }

  // Access denied state
  if (accessDenied) {
    return <AccessDeniedScreen onSignOut={handleSignOut} />
  }

  // Two-factor verification view
  if (viewMode === 'twoFactor') {
    return <TwoFactorForm code={totpCode} onCodeChange={setTotpCode} onSubmit={handleTotpVerify} onBack={handleBackToLogin} loading={totpLoading} error={error} logo={logo} />
  }

  // Email-OTP code entry view
  if (viewMode === 'emailOtp') {
    return <EmailOtpForm email={email} code={otp} onCodeChange={setOtp} onSubmit={handleVerifyEmailOtp} onBack={handleBackToLogin} loading={otpLoading} error={error} logo={logo} />
  }

  // Registration view
  if (viewMode === 'register') {
    return <RegisterForm name={name} email={email} password={password} confirmPassword={confirmPassword} onNameChange={(e) => setName(e.target.value)} onEmailChange={(e) => setEmail(e.target.value)} onPasswordChange={(e) => setPassword(e.target.value)} onConfirmPasswordChange={(e) => setConfirmPassword(e.target.value)} onSubmit={handleSignUp} onBackToLogin={handleBackToLogin} loading={loading} error={error} logo={logo} />
  }

  // Forgot password view
  if (viewMode === 'forgotPassword') {
    return <ForgotPasswordForm email={email} onEmailChange={(e) => setEmail(e.target.value)} onSubmit={handleForgotPassword} onBack={handleBackToLogin} loading={loading} error={error} logo={logo} />
  }

  // Reset link sent confirmation view
  if (viewMode === 'resetSent') {
    return (
      <EmailSentScreen
        icon="✓"
        message={<>We&apos;ve sent a password reset link to <strong>{email}</strong></>}
        note="Didn't receive the email? Check your spam folder or try again."
        logo={logo}
        onBack={handleBackToLogin}
      />
    )
  }

  // Magic-link sent confirmation view
  if (viewMode === 'magicLinkSent') {
    return (
      <EmailSentScreen
        icon="✉"
        message={<>We&apos;ve sent a sign-in link to <strong>{email}</strong></>}
        logo={logo}
        onBack={handleBackToLogin}
      />
    )
  }

  // Which method owns the primary submit button (availability resolved above)
  const primaryMethod = pickPrimaryMethod({
    password: passwordAvailable,
    magicLink: magicLinkAvailable,
    emailOtp: emailOtpAvailable,
  })

  const primarySubmit =
    primaryMethod === 'magicLink'
      ? handleSendMagicLink
      : primaryMethod === 'emailOtp'
        ? handleSendEmailOtp
        : handleSubmit
  const primaryLabel = loading
    ? primaryMethod === 'password'
      ? 'Signing in...'
      : 'Sending...'
    : primaryMethod === 'magicLink'
      ? 'Email me a link'
      : primaryMethod === 'emailOtp'
        ? 'Email me a code'
        : 'Sign In'

  // Secondary methods shown under the "or" divider (available but not the primary)
  const secondaryMethods: Array<{
    key: string
    icon: string
    label: string
    onClick: () => void
    busy: boolean
  }> = []
  if (passkeyAvailable) {
    secondaryMethods.push({
      key: 'passkey',
      icon: '🔐',
      label: passkeyLoading ? 'Authenticating...' : 'Sign in with Passkey',
      onClick: handlePasskeySignIn,
      busy: passkeyLoading,
    })
  }
  if (magicLinkAvailable && primaryMethod !== 'magicLink') {
    secondaryMethods.push({
      key: 'magicLink',
      icon: '✉',
      label: 'Email me a link',
      onClick: () => handleSendMagicLink(),
      busy: false,
    })
  }
  if (emailOtpAvailable && primaryMethod !== 'emailOtp') {
    secondaryMethods.push({
      key: 'emailOtp',
      icon: '#️⃣',
      label: 'Email me a code',
      onClick: () => handleSendEmailOtp(),
      busy: false,
    })
  }

  // Main login view
  return (
    <AuthCard logo={logo}>

        <h1
          style={{
            color: 'var(--theme-text)',
            fontSize: 'var(--font-size-h3)',
            fontWeight: 600,
            textAlign: 'center',
            margin: '0 0 calc(var(--base) * 1.5) 0',
          }}
        >
          {title}
        </h1>

        {successMessage && <AuthBanner kind="success">{successMessage}</AuthBanner>}

        <form onSubmit={primarySubmit}>
          <AuthField id="email" label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

          {passwordAvailable && (
          <>
          <AuthField id="password" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />

          {forgotPasswordAvailable && (
            <div
              style={{
                marginBottom: 'calc(var(--base) * 1.5)',
                textAlign: 'right',
              }}
            >
              <button
                type="button"
                onClick={() => switchView('forgotPassword')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--theme-text)',
                  opacity: 0.7,
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-small)',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Forgot password?
              </button>
            </div>
          )}
          </>
          )}

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={loading || passkeyLoading}>
            {primaryLabel}
          </AuthButton>
        </form>

        {secondaryMethods.length > 0 && (
          <>
            <OrDivider />

            {secondaryMethods.map((method) => (
              <div key={method.key} style={{ marginBottom: 'calc(var(--base) * 0.5)' }}>
                <AuthButton
                  variant="secondary"
                  icon={method.icon}
                  disabled={loading || passkeyLoading || method.busy}
                  onClick={method.onClick}
                >
                  {method.label}
                </AuthButton>
              </div>
            ))}
          </>
        )}

        {primaryMethod === null && secondaryMethods.length === 0 && (
          <p
            style={{
              marginTop: 'var(--base)',
              textAlign: 'center',
              fontSize: 'var(--font-size-small)',
              color: 'var(--theme-text)',
              opacity: 0.7,
            }}
          >
            No sign-in methods are currently enabled.
          </p>
        )}

        {signUpAvailable && (
          <div
            style={{
              marginTop: 'calc(var(--base) * 1.5)',
              textAlign: 'center',
              fontSize: 'var(--font-size-small)',
              color: 'var(--theme-text)',
              opacity: 0.8,
            }}
          >
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={() => switchView('register')}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--theme-elevation-800)',
                cursor: 'pointer',
                fontSize: 'inherit',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              Create account
            </button>
          </div>
        )}
    </AuthCard>
  )
}

export default LoginView
