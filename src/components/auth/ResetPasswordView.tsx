'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useConfig, useRouter, useSearchParams } from '@payloadcms/ui'
import { useAuthMountPath } from '../useAuthMountPath.js'
import { color, font, radius, space } from '../theme.js'

export type ResetPasswordViewProps = {
  /** Custom logo element */
  logo?: React.ReactNode
  /** Page title. Default: 'Reset Password' */
  title?: string
  /** Path to redirect after successful reset. Defaults to `${routes.admin}/login`. */
  afterResetPath?: string
  /** Minimum password length. Default: 8 */
  minPasswordLength?: number
}

/**
 * Reset password page component for setting a new password.
 * Expects a token in the URL query parameter.
 * Uses Better Auth's resetPassword endpoint.
 */
export function ResetPasswordView({
  logo,
  title = 'Reset Password',
  afterResetPath,
  minPasswordLength = 8,
}: ResetPasswordViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const authMountPath = useAuthMountPath()
  const resolvedAfterResetPath = afterResetPath ?? `${adminRoute}/login`
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  // Capture the token ONCE, before the URL is touched. Next's App Router
  // mirrors `history.replaceState` into its own router state and re-derives
  // `useSearchParams()` from it, so anything keyed on searchParams re-runs
  // after the strip below with an empty query — re-deriving the token there
  // finds nothing and flags a valid link as invalid.
  const [token] = useState<string | null>(() => searchParams.get('token'))

  useEffect(() => {
    if (!token) {
      setError('Invalid or missing reset token. Please request a new password reset link.')
      return
    }
    // Strip the token from the URL so it doesn't linger in browser history,
    // synced history, or any analytics that records URLs. Remove only the
    // `token` param, preserving the rest of the query string. Runs once on
    // mount — deliberately NOT keyed on searchParams (see token capture above).
    const url = new URL(window.location.href)
    if (url.searchParams.has('token')) {
      url.searchParams.delete('token')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < minPasswordLength) {
      setError(`Password must be at least ${minPasswordLength} characters.`)
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (!token) {
      setError('Invalid reset token.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${authMountPath}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          newPassword: password,
        }),
      })

      if (response.ok) {
        setSuccess(true)
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.message || data.error?.message || 'Failed to reset password. The link may have expired.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: color.bg,
          padding: space(),
        }}
      >
        <div
          style={{
            background: color.surface,
            padding: space(2),
            borderRadius: radius.medium,
            boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
            width: '100%',
            maxWidth: '400px',
            textAlign: 'center',
          }}
        >
          {logo && (
            <div style={{ marginBottom: space(1.5) }}>
              {logo}
            </div>
          )}

          <h1
            style={{
              color: color.success,
              fontSize: font.h3,
              fontWeight: 600,
              margin: `0 0 ${space()} 0`,
            }}
          >
            Password Reset!
          </h1>

          <p
            style={{
              color: color.text,
              opacity: 0.8,
              marginBottom: space(1.5),
              fontSize: font.small,
            }}
          >
            Your password has been successfully reset. You can now log in with your new password.
          </p>

          <button
            onClick={() => router.push(resolvedAfterResetPath)}
            style={{
              padding: `${space(0.75)} ${space(1.5)}`,
              background: color.inverse,
              border: 'none',
              borderRadius: radius.small,
              color: color.onInverse,
              fontSize: font.base,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.bg,
        padding: space(),
      }}
    >
      <div
        style={{
          background: color.surface,
          padding: space(2),
          borderRadius: radius.medium,
          boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)',
          width: '100%',
          maxWidth: '400px',
        }}
      >
        {logo && (
          <div
            style={{
              textAlign: 'center',
              marginBottom: space(1.5),
            }}
          >
            {logo}
          </div>
        )}

        <h1
          style={{
            color: color.text,
            fontSize: font.h3,
            fontWeight: 600,
            marginBottom: space(0.5),
            textAlign: 'center',
            margin: `0 0 ${space(0.5)} 0`,
          }}
        >
          {title}
        </h1>

        <p
          style={{
            color: color.text,
            opacity: 0.7,
            fontSize: font.small,
            textAlign: 'center',
            marginBottom: space(1.5),
          }}
        >
          Enter your new password below.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: space() }}>
            <label
              htmlFor="password"
              style={{
                display: 'block',
                color: color.text,
                marginBottom: space(0.5),
                fontSize: font.small,
                fontWeight: 500,
              }}
            >
              New Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={minPasswordLength}
              autoComplete="new-password"
              style={{
                width: '100%',
                padding: space(0.75),
                background: color.inputBg,
                border: `1px solid ${color.inputBorder}`,
                borderRadius: radius.small,
                color: color.text,
                fontSize: font.base,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: space(1.5) }}>
            <label
              htmlFor="confirmPassword"
              style={{
                display: 'block',
                color: color.text,
                marginBottom: space(0.5),
                fontSize: font.small,
                fontWeight: 500,
              }}
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={minPasswordLength}
              autoComplete="new-password"
              style={{
                width: '100%',
                padding: space(0.75),
                background: color.inputBg,
                border: `1px solid ${color.inputBorder}`,
                borderRadius: radius.small,
                color: color.text,
                fontSize: font.base,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div
              style={{
                color: color.danger,
                marginBottom: space(),
                fontSize: font.small,
                padding: space(0.5),
                background: color.dangerBg,
                borderRadius: radius.small,
                border: `1px solid ${color.dangerBorder}`,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !token}
            style={{
              width: '100%',
              padding: space(0.75),
              background: color.inverse,
              border: 'none',
              borderRadius: radius.small,
              color: color.onInverse,
              fontSize: font.base,
              fontWeight: 500,
              cursor: loading || !token ? 'not-allowed' : 'pointer',
              opacity: loading || !token ? 0.7 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ResetPasswordView
