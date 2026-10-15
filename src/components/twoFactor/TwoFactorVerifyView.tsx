'use client'

import { useState, type FormEvent } from 'react'
import { useConfig, useRouter } from '@payloadcms/ui'
import { useAuthMountPath } from '../useAuthMountPath.js'
import { color, font, radius, space } from '../theme.js'

export type TwoFactorVerifyViewProps = {
  /** Custom logo element */
  logo?: React.ReactNode
  /** Page title. Default: 'Two-Factor Authentication' */
  title?: string
  /** Path to redirect after successful verification. Defaults to `routes.admin`. */
  afterVerifyPath?: string
  /** Callback after successful verification */
  onVerifyComplete?: () => void
}

/**
 * Two-factor authentication verification component.
 * Used during login flow when 2FA is enabled on the account.
 * Uses Better Auth's twoFactor plugin endpoints.
 */
export function TwoFactorVerifyView({
  logo,
  title = 'Two-Factor Authentication',
  afterVerifyPath,
  onVerifyComplete,
}: TwoFactorVerifyViewProps) {
  const router = useRouter()
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const authMountPath = useAuthMountPath()
  const resolvedAfterVerifyPath = afterVerifyPath ?? adminRoute
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [useBackupCode, setUseBackupCode] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const endpoint = useBackupCode
        ? `${authMountPath}/two-factor/verify-backup-code`
        : `${authMountPath}/two-factor/verify-totp`

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      })

      if (response.ok) {
        onVerifyComplete?.()
        router.push(resolvedAfterVerifyPath)
        router.refresh()
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.message || 'Invalid code. Please try again.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
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
            margin: `0 0 ${space(0.5)} 0`,
            textAlign: 'center',
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
          {useBackupCode
            ? 'Enter one of your backup codes.'
            : 'Enter the code from your authenticator app.'}
        </p>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: space(1.5) }}>
            <label
              htmlFor="code"
              style={{
                display: 'block',
                color: color.text,
                marginBottom: space(0.5),
                fontSize: font.small,
                fontWeight: 500,
              }}
            >
              {useBackupCode ? 'Backup Code' : 'Verification Code'}
            </label>
            <input
              id="code"
              type="text"
              inputMode={useBackupCode ? 'text' : 'numeric'}
              pattern={useBackupCode ? undefined : '[0-9]*'}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                if (useBackupCode) {
                  setCode(e.target.value)
                } else {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
              }}
              required
              placeholder={useBackupCode ? 'xxxxxxxx' : '000000'}
              style={{
                width: '100%',
                padding: space(0.75),
                background: color.inputBg,
                border: `1px solid ${color.inputBorder}`,
                borderRadius: radius.small,
                color: color.text,
                fontSize: font.h4,
                fontFamily: 'monospace',
                textAlign: 'center',
                letterSpacing: useBackupCode ? '0.2em' : '0.5em',
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
            disabled={loading || (!useBackupCode && code.length !== 6)}
            style={{
              width: '100%',
              padding: space(0.75),
              background: color.inverse,
              border: 'none',
              borderRadius: radius.small,
              color: color.onInverse,
              fontSize: font.base,
              fontWeight: 500,
              cursor: loading || (!useBackupCode && code.length !== 6) ? 'not-allowed' : 'pointer',
              opacity: loading || (!useBackupCode && code.length !== 6) ? 0.7 : 1,
              transition: 'opacity 150ms ease',
              marginBottom: space(),
            }}
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setUseBackupCode(!useBackupCode)
                setCode('')
                setError(null)
              }}
              style={{
                background: 'none',
                border: 'none',
                color: color.text,
                opacity: 0.7,
                fontSize: font.small,
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {useBackupCode
                ? 'Use authenticator app instead'
                : 'Use a backup code instead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TwoFactorVerifyView
