'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation.js'
import { useConfig } from '@payloadcms/ui'

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
      routes: { admin: adminRoute, api: apiRoute },
    },
  } = useConfig()
  const resolvedAfterResetPath = afterResetPath ?? `${adminRoute}/login`
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (!tokenParam) {
      setError('Invalid or missing reset token. Please request a new password reset link.')
    } else {
      setToken(tokenParam)
    }
  }, [searchParams])

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
      const response = await fetch(`${apiRoute}/auth/reset-password`, {
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
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              {logo}
            </div>
          )}

          <h1
            style={{
              color: 'var(--theme-success-500)',
              fontSize: 'var(--font-size-h3)',
              fontWeight: 600,
              margin: '0 0 var(--base) 0',
            }}
          >
            Password Reset!
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.8,
              marginBottom: 'calc(var(--base) * 1.5)',
              fontSize: 'var(--font-size-small)',
            }}
          >
            Your password has been successfully reset. You can now log in with your new password.
          </p>

          <button
            onClick={() => router.push(resolvedAfterResetPath)}
            style={{
              padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
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
            marginBottom: 'calc(var(--base) * 0.5)',
            textAlign: 'center',
            margin: '0 0 calc(var(--base) * 0.5) 0',
          }}
        >
          {title}
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
          Enter your new password below.
        </p>

        <form onSubmit={handleSubmit}>
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
              htmlFor="confirmPassword"
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
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={minPasswordLength}
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
            disabled={loading || !token}
            style={{
              width: '100%',
              padding: 'calc(var(--base) * 0.75)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
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
