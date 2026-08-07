'use client'

import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation.js'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient, magicLinkClient, emailOTPClient } from 'better-auth/client/plugins'
import { hasAnyRole, hasAllRoles, normalizeRoles } from '../utils/access.js'
import { resolveAvailability, pickPrimaryMethod } from '../utils/loginMethods.js'
import { useConfig } from '@payloadcms/ui'
import { useAuthClientBaseURL } from './useAuthMountPath.js'
import { LoadingScreen } from './login/LoadingScreen.js'
import { AccessDeniedScreen } from './login/AccessDeniedScreen.js'
import { EmailSentScreen } from './login/EmailSentScreen.js'
import { TwoFactorForm } from './login/TwoFactorForm.js'
import { EmailOtpForm } from './login/EmailOtpForm.js'
import { ForgotPasswordForm } from './login/ForgotPasswordForm.js'
import { RegisterForm } from './login/RegisterForm.js'
import { LoginForm } from './login/LoginForm.js'

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
   *
   * Passkey requires an injected `authClient` built with `passkeyClient()` —
   * the optional `@better-auth/passkey` peer is not (and cannot be) bundled into
   * this component. Without such a client, the passkey button surfaces a
   * guidance message instead of signing in.
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
   * @deprecated No longer sent to the server. Role is now assigned
   * authoritatively server-side (the sign-up form no longer transmits a role,
   * to close a privilege-escalation path). Configure the default self-sign-up
   * role via `firstUserAdmin: { defaultRole }` in `betterAuthCollections()`
   * instead. This prop is retained for backward compatibility but is ignored.
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
  /** Resolved social providers to display (server-resolved by LoginViewWrapper). Default: none. */
  socialProviders?: Array<{ id: string; label: string }>
  /**
   * Where a successful social sign-in returns. Default: the current login page URL, so the
   * built-in session check + role gate run. Errors always return to the login page.
   */
  socialCallbackURL?: string
  /**
   * The plugin's `authBasePath` (mount segment under `routes.api`). Combined with
   * `routes.api` from the live Payload config to point the auth client at the
   * mounted endpoints — Better Auth's client otherwise defaults to `/api/auth`,
   * which is wrong whenever `routes.api` isn't `/api`. Resolved server-side by
   * LoginViewWrapper (the unauthenticated login page's client config carries no
   * `admin.custom`). Default: '/auth'.
   */
  authBasePath?: string
}

/** Map a Better Auth social `?error=` code to a friendly message. */
function humanizeSocialError(code: string): string {
  const known: Record<string, string> = {
    // Standard OAuth provider denial (e.g. user clicked "Cancel" on the consent screen)
    access_denied: 'Access was denied by the provider.',
    // BA callback.mjs: no authorization code in the callback
    no_code: 'Sign-in was interrupted — no authorization code received. Please try again.',
    // BA callback.mjs: unknown or unconfigured provider
    oauth_provider_not_found: 'This sign-in provider is not configured. Please contact support.',
    // BA callback.mjs: code exchange with the provider failed
    invalid_code: 'Sign-in could not be completed. Please try again.',
    // BA callback.mjs: provider did not return usable user information
    unable_to_get_user_info: 'Could not retrieve your account information. Please try again.',
    // BA callback.mjs: provider did not return an email address
    email_not_found: 'Your provider did not share an email address. Please use a different sign-in method.',
  }
  return known[code] ?? 'Social sign-in failed. Please try again.'
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
  // defaultSignUpRole is deprecated and intentionally no longer destructured/used
  // (role is assigned server-side). Kept in the props type for back-compat.
  enableForgotPassword = 'auto',
  resetPasswordUrl,
  enablePassword = 'auto',
  enableMagicLink = 'auto',
  enableEmailOtp = 'auto',
  magicLinkCallbackURL,
  socialProviders = [],
  socialCallbackURL,
  authBasePath,
}: LoginViewProps) {
  const router = useRouter()

  // Payload Config
  const {config: {routes: {admin:adminRoute}}} = useConfig()
  const authBaseURL = useAuthClientBaseURL(authBasePath)
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
  const [socialLoading, setSocialLoading] = useState<string | null>(null) // provider id in flight
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
    // Core plugins only. Optional peers (passkey, api-key) are NOT imported
    // here: bundlers resolve the import specifier at build time, so importing
    // `@better-auth/passkey/client` would break the build of every consumer who
    // hasn't installed it — even those not using passkey. (This module's sibling
    // `exports/client.ts` documents the same rule.) To enable passkey sign-in in
    // the admin login, pass an `authClient` built with `passkeyClient()`.
    // Point the client at the mounted endpoints (routes.api + authBasePath).
    // Without a baseURL, Better Auth's client falls back to `/api/auth`, which
    // only matches the mount when Payload's `routes.api` is the default '/api'.
    clientRef.current = createAuthClient({
      ...(authBaseURL ? { baseURL: authBaseURL } : {}),
      plugins: [twoFactorClient(), magicLinkClient(), emailOTPClient()],
    })
    return clientRef.current
  }

  // Check if user is already logged in on mount
  useEffect(() => {
    let ignore = false
    async function checkSession() {
      try {
        const client = await getClient()
        const result = await client.getSession()
        // Bail if the component unmounted while the request was in flight —
        // otherwise a stale router.push()/setState fires after navigation away
        // (and runs twice under React StrictMode).
        if (ignore) return

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
      if (!ignore) setCheckingSession(false)
    }
    checkSession()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afterLoginPath, requiredRole, requireAllRoles, router])

  // Surface a social-OAuth error returned on the callback (?error=...), then strip it so a
  // refresh doesn't re-show it. Runs once; independent of the session check (error returns
  // carry no session). Only acts when social buttons are present — a non-social admin app
  // landing on ?error=anything should not see a misleading "Social sign-in failed" banner.
  useEffect(() => {
    if (socialProviders.length === 0) return
    const code = new URLSearchParams(window.location.search).get('error')
    if (!code) return
    setError(humanizeSocialError(code))
    const clean = window.location.href.split('?')[0].split('#')[0]
    window.history.replaceState(null, '', clean)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      // Do NOT send `role` from the client. Role is assigned authoritatively on
      // the server (firstUserAdmin hook / your own gated hook). Sending it here
      // required configuring `role` as a client-writable field, which let anyone
      // self-provision an admin by POSTing `{ role: 'admin' }` to the sign-up
      // endpoint. See MIGRATION notes for `defaultSignUpRole`.
      const result = await client.signUp.email({
        email,
        password,
        name,
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
      // The default client is core-only (passkey is an optional peer that can't
      // be auto-bundled). If passkey isn't on the client, guide the integrator
      // instead of throwing a cryptic "signIn.passkey is not a function".
      if (typeof client?.signIn?.passkey !== 'function') {
        setError(
          'Passkey sign-in requires a configured auth client. Pass an `authClient` built with passkeyClient() to LoginView.'
        )
        setPasskeyLoading(false)
        return
      }
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

  async function handleSocialSignIn(providerId: string) {
    if (socialLoading) return
    setSocialLoading(providerId)
    setError(null)
    setSuccessMessage(null)
    setAccessDenied(false)
    try {
      const client = await getClient()
      const loginUrl = window.location.href.split('?')[0].split('#')[0]
      const result = await client.signIn.social({
        provider: providerId,
        callbackURL: socialCallbackURL ?? loginUrl,
        errorCallbackURL: loginUrl,
      })
      if (result?.error) {
        // BA returned an error WITHOUT redirecting (e.g. provider misconfigured server-side).
        setError(result.error.message ?? 'Social sign-in failed. Please try again.')
        setSocialLoading(null)
        return
      }
      // Most BA client versions auto-navigate on success and we never reach here. If a version
      // returns the URL without navigating, drive the redirect ourselves so the user is never
      // stranded. Leave socialLoading set (the page is navigating away).
      const url = (result?.data as { url?: string } | undefined)?.url
      if (url) {
        window.location.href = url
      } else {
        // No error and no redirect URL: nothing is navigating, so don't leave the
        // buttons stuck disabled. (Real BA always returns a url or an error; this is
        // defensive against client/version anomalies.)
        setSocialLoading(null)
      }
    } catch {
      setError('An error occurred. Please try again.')
      setSocialLoading(null)
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
    icon?: React.ReactNode
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
  for (const provider of socialProviders) {
    secondaryMethods.push({
      key: `social:${provider.id}`,
      label:
        socialLoading === provider.id
          ? `Connecting to ${provider.label}…`
          : `Continue with ${provider.label}`,
      onClick: () => handleSocialSignIn(provider.id),
      busy: socialLoading === provider.id,
    })
  }

  // Main login view
  return (
    <LoginForm
      logo={logo} title={title} successMessage={successMessage} error={error}
      email={email} onEmailChange={(e) => setEmail(e.target.value)}
      passwordAvailable={passwordAvailable} password={password} onPasswordChange={(e) => setPassword(e.target.value)}
      forgotPasswordAvailable={forgotPasswordAvailable} onForgotPassword={() => switchView('forgotPassword')}
      onSubmit={primarySubmit} primaryLabel={primaryLabel} actionsDisabled={loading || passkeyLoading || socialLoading !== null}
      secondaryMethods={secondaryMethods}
      showEmptyState={primaryMethod === null && secondaryMethods.length === 0}
      signUpAvailable={signUpAvailable} onCreateAccount={() => switchView('register')}
    />
  )
}

export default LoginView
