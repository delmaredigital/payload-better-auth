'use client'

import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation.js'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient, magicLinkClient, emailOTPClient } from 'better-auth/client/plugins'
import { hasAnyRole, hasAllRoles, normalizeRoles } from '../utils/access.js'
import { resolveAvailability, pickPrimaryMethod } from '../utils/loginMethods.js'
import { useConfig } from '@payloadcms/ui'

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
  const {config: {routes: {admin:adminRoute, api:apiRoute}}} = useConfig()
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

  // Feature availability
  const [passkeyAvailable, setPasskeyAvailable] = useState(enablePasskey === true)
  const [signUpAvailable, setSignUpAvailable] = useState(enableSignUp === true)
  const [forgotPasswordAvailable, setForgotPasswordAvailable] = useState(enableForgotPassword === true)

  // Probe results for the new methods (null = not yet probed).
  // Password is optimistic (shown until a 404 proves the strategy is disabled);
  // magic-link and email-OTP stay hidden until a probe confirms availability.
  const [passwordProbe, setPasswordProbe] = useState<boolean | null>(true)
  const [magicLinkProbe, setMagicLinkProbe] = useState<boolean | null>(null)
  const [emailOtpProbe, setEmailOtpProbe] = useState<boolean | null>(null)

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

  // Auto-detect passkey availability if set to 'auto'
  useEffect(() => {
    if (enablePasskey === 'auto') {
      // Check if passkey endpoint exists (GET request)
      // Better Auth passkey routes are at /passkey/* (singular)
      fetch(`${apiRoute}/auth/passkey/generate-authenticate-options`, {
        method: 'GET',
        credentials: 'include',
      })
        .then((res) => {
          // If we get a response (even 400/401 for not authenticated), passkey is available
          // 404 means passkey plugin is not installed
          setPasskeyAvailable(res.status !== 404)
        })
        .catch(() => {
          setPasskeyAvailable(false)
        })
    } else {
      setPasskeyAvailable(enablePasskey === true)
    }
  }, [enablePasskey])

  // Auto-detect sign up availability if set to 'auto'
  useEffect(() => {
    if (enableSignUp === 'auto') {
      // Check if sign-up endpoint exists
      fetch(`${apiRoute}/auth/sign-up/email`, {
        method: 'OPTIONS',
        credentials: 'include',
      })
        .then((res) => {
          // 404 means sign-up is not available
          setSignUpAvailable(res.status !== 404)
        })
        .catch(() => {
          // If OPTIONS fails, try a HEAD or just assume it's available since it's a core endpoint
          setSignUpAvailable(true)
        })
    } else {
      setSignUpAvailable(enableSignUp === true)
    }
  }, [enableSignUp])

  // Auto-detect forgot password availability if set to 'auto'
  useEffect(() => {
    if (enableForgotPassword === 'auto') {
      // Check if request-password-reset endpoint exists
      fetch(`${apiRoute}/auth/request-password-reset`, {
        method: 'OPTIONS',
        credentials: 'include',
      })
        .then((res) => {
          // 404 means request-password-reset is not available
          setForgotPasswordAvailable(res.status !== 404)
        })
        .catch(() => {
          // If OPTIONS fails, assume it's available since it's a core endpoint
          setForgotPasswordAvailable(true)
        })
    } else {
      setForgotPasswordAvailable(enableForgotPassword === true)
    }
  }, [enableForgotPassword])

  // Auto-detect password (email) sign-in availability if set to 'auto'
  useEffect(() => {
    if (enablePassword !== 'auto') return
    fetch(`${apiRoute}/auth/sign-in/email`, { method: 'OPTIONS', credentials: 'include' })
      .then((res) => setPasswordProbe(res.status !== 404))
      .catch(() => setPasswordProbe(true)) // core method: assume available on probe error
  }, [enablePassword])

  // Auto-detect magic-link availability if set to 'auto'
  useEffect(() => {
    if (enableMagicLink !== 'auto') return
    fetch(`${apiRoute}/auth/sign-in/magic-link`, { method: 'OPTIONS', credentials: 'include' })
      .then((res) => setMagicLinkProbe(res.status !== 404))
      .catch(() => setMagicLinkProbe(false)) // optional method: assume unavailable on error
  }, [enableMagicLink])

  // Auto-detect email-OTP availability if set to 'auto'
  useEffect(() => {
    if (enableEmailOtp !== 'auto') return
    fetch(`${apiRoute}/auth/email-otp/send-verification-otp`, { method: 'OPTIONS', credentials: 'include' })
      .then((res) => setEmailOtpProbe(res.status !== 404))
      .catch(() => setEmailOtpProbe(false))
  }, [enableEmailOtp])

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
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
        }}
      >
        <div style={{ color: 'var(--theme-text)', opacity: 0.7 }}>
          Loading...
        </div>
      </div>
    )
  }

  // Access denied state
  if (accessDenied) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          <h1
            style={{
              color: 'var(--theme-error-500)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 var(--base) 0',
            }}
          >
            Access Denied
          </h1>
          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.8,
              marginBottom: 'calc(var(--base) * 1.5)',
              fontSize: 'var(--font-size-small)',
            }}
          >
            You don't have permission to access the admin panel.
            Please contact an administrator if you believe this is an error.
          </p>
          <button
            onClick={handleSignOut}
            style={{
              padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-150)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-base)',
              cursor: 'pointer',
            }}
          >
            Sign out and try again
          </button>
        </div>
      </div>
    )
  }

  // Two-factor verification view
  if (viewMode === 'twoFactor') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {logo && (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 'calc(var(--base) * 1.5)',
              }}
            >
              {logo}
            </div>
          )}

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 0.5) 0',
              textAlign: 'center',
            }}
          >
            Two-Factor Authentication
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              textAlign: 'center',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            Enter the 6-digit code from your authenticator app
          </p>

          <form onSubmit={handleTotpVerify}>
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <label
                htmlFor="totp-code"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Verification Code
              </label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                placeholder="000000"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-h4)',
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  letterSpacing: '0.5em',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--theme-error-500)',
                  marginBottom: 'var(--base)',
                  fontSize: 'var(--font-size-small)',
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-error-50)',
                  borderRadius: 'var(--style-radius-s)',
                  border: '1px solid var(--theme-error-200)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={totpLoading || totpCode.length !== 6}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-elevation-800)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-elevation-50)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: totpLoading || totpCode.length !== 6 ? 'not-allowed' : 'pointer',
                opacity: totpLoading || totpCode.length !== 6 ? 0.7 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              {totpLoading ? 'Verifying...' : 'Verify'}
            </button>
          </form>

          <button
            type="button"
            onClick={handleBackToLogin}
            style={{
              width: '100%',
              marginTop: 'var(--base)',
              padding: 'calc(var(--base) * 0.5)',
              background: 'transparent',
              border: 'none',
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              cursor: 'pointer',
            }}
          >
            ← Back to login
          </button>
        </div>
      </div>
    )
  }

  // Email-OTP code entry view
  if (viewMode === 'emailOtp') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {logo && (
            <div style={{ textAlign: 'center', marginBottom: 'calc(var(--base) * 1.5)' }}>{logo}</div>
          )}

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 0.5) 0',
              textAlign: 'center',
            }}
          >
            Enter Your Code
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              textAlign: 'center',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            We&apos;ve sent a verification code to <strong>{email}</strong>
          </p>

          <form onSubmit={handleVerifyEmailOtp}>
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <label
                htmlFor="email-otp-code"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Verification Code
              </label>
              <input
                id="email-otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                placeholder="000000"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-h4)',
                  fontFamily: 'monospace',
                  textAlign: 'center',
                  letterSpacing: '0.5em',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--theme-error-500)',
                  marginBottom: 'var(--base)',
                  fontSize: 'var(--font-size-small)',
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-error-50)',
                  borderRadius: 'var(--style-radius-s)',
                  border: '1px solid var(--theme-error-200)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={otpLoading || otp.length !== 6}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-elevation-800)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-elevation-50)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: otpLoading || otp.length !== 6 ? 'not-allowed' : 'pointer',
                opacity: otpLoading || otp.length !== 6 ? 0.7 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              {otpLoading ? 'Verifying...' : 'Verify'}
            </button>
          </form>

          <button
            type="button"
            onClick={handleBackToLogin}
            style={{
              width: '100%',
              marginTop: 'var(--base)',
              padding: 'calc(var(--base) * 0.5)',
              background: 'transparent',
              border: 'none',
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              cursor: 'pointer',
            }}
          >
            ← Back to login
          </button>
        </div>
      </div>
    )
  }

  // Registration view
  if (viewMode === 'register') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {logo && (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 'calc(var(--base) * 1.5)',
              }}
            >
              {logo}
            </div>
          )}

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 1.5) 0',
              textAlign: 'center',
            }}
          >
            Create Account
          </h1>

          <form onSubmit={handleSignUp}>
            <div style={{ marginBottom: 'var(--base)' }}>
              <label
                htmlFor="name"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 'var(--base)' }}>
              <label
                htmlFor="register-email"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Email
              </label>
              <input
                id="register-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 'var(--base)' }}>
              <label
                htmlFor="register-password"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Password
              </label>
              <input
                id="register-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <label
                htmlFor="confirm-password"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Confirm Password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--theme-error-500)',
                  marginBottom: 'var(--base)',
                  fontSize: 'var(--font-size-small)',
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-error-50)',
                  borderRadius: 'var(--style-radius-s)',
                  border: '1px solid var(--theme-error-200)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-elevation-800)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-elevation-50)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <div
            style={{
              marginTop: 'calc(var(--base) * 1.5)',
              textAlign: 'center',
              fontSize: 'var(--font-size-small)',
              color: 'var(--theme-text)',
              opacity: 0.8,
            }}
          >
            Already have an account?{' '}
            <button
              type="button"
              onClick={handleBackToLogin}
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
              Sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Forgot password view
  if (viewMode === 'forgotPassword') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {logo && (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 'calc(var(--base) * 1.5)',
              }}
            >
              {logo}
            </div>
          )}

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 0.5) 0',
              textAlign: 'center',
            }}
          >
            Reset Password
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              textAlign: 'center',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            Enter your email and we&apos;ll send you a link to reset your password
          </p>

          <form onSubmit={handleForgotPassword}>
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <label
                htmlFor="forgot-email"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-input-bg)',
                  border: '1px solid var(--theme-elevation-150)',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-text)',
                  fontSize: 'var(--font-size-base)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {error && (
              <div
                style={{
                  color: 'var(--theme-error-500)',
                  marginBottom: 'var(--base)',
                  fontSize: 'var(--font-size-small)',
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-error-50)',
                  borderRadius: 'var(--style-radius-s)',
                  border: '1px solid var(--theme-error-200)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-elevation-800)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-elevation-50)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <button
            type="button"
            onClick={handleBackToLogin}
            style={{
              width: '100%',
              marginTop: 'var(--base)',
              padding: 'calc(var(--base) * 0.5)',
              background: 'transparent',
              border: 'none',
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              cursor: 'pointer',
            }}
          >
            ← Back to login
          </button>
        </div>
      </div>
    )
  }

  // Reset link sent confirmation view
  if (viewMode === 'resetSent') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          {logo && (
            <div
              style={{
                marginBottom: 'calc(var(--base) * 1.5)',
              }}
            >
              {logo}
            </div>
          )}

          <div
            style={{
              width: '64px',
              height: '64px',
              background: 'var(--theme-success-100)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto calc(var(--base) * 1.5)',
              fontSize: '28px',
            }}
          >
            ✓
          </div>

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 0.5) 0',
            }}
          >
            Check Your Email
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            We&apos;ve sent a password reset link to <strong>{email}</strong>
          </p>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.6,
              fontSize: 'var(--font-size-small)',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            Didn&apos;t receive the email? Check your spam folder or try again.
          </p>

          <button
            type="button"
            onClick={handleBackToLogin}
            style={{
              padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-150)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-base)',
              cursor: 'pointer',
            }}
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  // Magic-link sent confirmation view
  if (viewMode === 'magicLinkSent') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
          padding: 'var(--base)',
        }}
      >
        <div
          style={{
            background: 'var(--theme-elevation-50)',
            padding: 'calc(var(--base) * 2)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          {logo && <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>{logo}</div>}

          <div
            style={{
              width: '64px',
              height: '64px',
              background: 'var(--theme-success-100)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto calc(var(--base) * 1.5)',
              fontSize: '28px',
            }}
          >
            ✉
          </div>

          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 calc(var(--base) * 0.5) 0',
            }}
          >
            Check Your Email
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              fontSize: 'var(--font-size-small)',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            We&apos;ve sent a sign-in link to <strong>{email}</strong>
          </p>

          <button
            type="button"
            onClick={handleBackToLogin}
            style={{
              padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-150)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-base)',
              cursor: 'pointer',
            }}
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  // Main login view
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--theme-bg)',
        padding: 'var(--base)',
      }}
    >
      <div
        style={{
          background: 'var(--theme-elevation-50)',
          padding: 'calc(var(--base) * 2)',
          borderRadius: 'var(--style-radius-m)',
          boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
          width: '100%',
          maxWidth: '400px',
        }}
      >
        {logo && (
          <div
            style={{
              textAlign: 'center',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            {logo}
          </div>
        )}

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

        {successMessage && (
          <div
            style={{
              color: 'var(--theme-success-500)',
              marginBottom: 'var(--base)',
              fontSize: 'var(--font-size-small)',
              padding: 'calc(var(--base) * 0.5)',
              background: 'var(--theme-success-50)',
              borderRadius: 'var(--style-radius-s)',
              border: '1px solid var(--theme-success-200)',
            }}
          >
            {successMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 'var(--base)' }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                color: 'var(--theme-text)',
                marginBottom: 'calc(var(--base) * 0.5)',
                fontSize: 'var(--font-size-small)',
                fontWeight: 500,
              }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-base)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 'var(--base)' }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                color: 'var(--theme-text)',
                marginBottom: 'calc(var(--base) * 0.5)',
                fontSize: 'var(--font-size-small)',
                fontWeight: 500,
              }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-base)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

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

          {error && (
            <div
              style={{
                color: 'var(--theme-error-500)',
                marginBottom: 'var(--base)',
                fontSize: 'var(--font-size-small)',
                padding: 'calc(var(--base) * 0.5)',
                background: 'var(--theme-error-50)',
                borderRadius: 'var(--style-radius-s)',
                border: '1px solid var(--theme-error-200)',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || passkeyLoading}
            style={{
              width: '100%',
              padding: 'calc(var(--base) * 0.75)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              cursor: loading || passkeyLoading ? 'not-allowed' : 'pointer',
              opacity: loading || passkeyLoading ? 0.7 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {passkeyAvailable && (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                margin: 'calc(var(--base) * 1.5) 0',
                gap: 'calc(var(--base) * 1)',
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  background: 'var(--theme-elevation-150)',
                }}
              />
              <span
                style={{
                  color: 'var(--theme-text)',
                  opacity: 0.6,
                  fontSize: 'var(--font-size-small)',
                }}
              >
                or
              </span>
              <div
                style={{
                  flex: 1,
                  height: '1px',
                  background: 'var(--theme-elevation-150)',
                }}
              />
            </div>

            <button
              type="button"
              onClick={handlePasskeySignIn}
              disabled={loading || passkeyLoading}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'transparent',
                border: '1px solid var(--theme-elevation-300)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: loading || passkeyLoading ? 'not-allowed' : 'pointer',
                opacity: loading || passkeyLoading ? 0.7 : 1,
                transition: 'opacity 150ms ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'calc(var(--base) * 0.5)',
              }}
            >
              <span style={{ fontSize: '18px' }}>🔐</span>
              {passkeyLoading ? 'Authenticating...' : 'Sign in with Passkey'}
            </button>
          </>
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
      </div>
    </div>
  )
}

export default LoginView
