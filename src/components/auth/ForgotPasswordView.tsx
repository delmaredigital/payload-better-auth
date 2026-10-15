'use client'

import { useConfig } from '@payloadcms/ui'
import { useState, useRef, type FormEvent } from 'react'
import { createAuthClient } from 'better-auth/react'
import { useAuthClientBaseURL } from '../useAuthMountPath.js'
import { color, font, radius, space } from '../theme.js'

export type ForgotPasswordViewProps = {
  /** Optional pre-configured auth client */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
  /** Custom logo element */
  logo?: React.ReactNode
  /** Page title. Default: 'Forgot Password' */
  title?: string
  /** Path to login page. Default: '/admin/login' */
  loginPath?: string
  /** Success message to show after email is sent */
  successMessage?: string
}

/**
 * Forgot password page component for requesting a password reset email.
 * Uses the Better Auth client's `requestPasswordReset` (the raw
 * `/forget-password` endpoint was renamed to `/request-password-reset` in
 * Better Auth 1.6; the client tracks such renames across versions).
 */
export function ForgotPasswordView({
  authClient: providedClient,
  logo,
  title = 'Forgot Password',
  loginPath = '/admin/login',
  successMessage = 'If an account exists with this email, you will receive a password reset link.',
}: ForgotPasswordViewProps) {

  // Payload Config
  const {config: {routes: {admin:adminRoute}}} = useConfig()
  const authBaseURL = useAuthClientBaseURL()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)
  const getClient = () => {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    clientRef.current = createAuthClient({
      ...(authBaseURL ? { baseURL: authBaseURL } : {}),
    })
    return clientRef.current
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const client = getClient()
      const result = await client.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}${adminRoute}/reset-password`,
      })

      // Better Auth already answers unknown emails with a success (that's the
      // anti-enumeration boundary), so a returned error here is a genuine
      // failure (rate limit, misconfiguration, 5xx) — surface it instead of
      // claiming an email was sent when nothing was.
      if (result.error) {
        setError(result.error.message ?? 'Failed to send reset email. Please try again.')
      } else {
        setSuccess(true)
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
              color: color.text,
              fontSize: font.h3,
              fontWeight: 600,
              margin: `0 0 ${space()} 0`,
            }}
          >
            Check Your Email
          </h1>

          <p
            style={{
              color: color.text,
              opacity: 0.8,
              marginBottom: space(1.5),
              fontSize: font.small,
            }}
          >
            {successMessage}
          </p>

          <a
            href={loginPath}
            style={{
              color: color.text,
              fontSize: font.small,
              textDecoration: 'underline',
            }}
          >
            Back to login
          </a>
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
          Enter your email and we'll send you a reset link.
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: space(1.5) }}>
            <label
              htmlFor="email"
              style={{
                display: 'block',
                color: color.text,
                marginBottom: space(0.5),
                fontSize: font.small,
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
            disabled={loading}
            style={{
              width: '100%',
              padding: space(0.75),
              background: color.inverse,
              border: 'none',
              borderRadius: radius.small,
              color: color.onInverse,
              fontSize: font.base,
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 150ms ease',
              marginBottom: space(),
            }}
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <a
              href={loginPath}
              style={{
                color: color.text,
                opacity: 0.7,
                fontSize: font.small,
                textDecoration: 'underline',
              }}
            >
              Back to login
            </a>
          </div>
        </form>
      </div>
    </div>
  )
}

export default ForgotPasswordView
