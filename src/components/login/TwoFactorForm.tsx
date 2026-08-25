import React, { useEffect, useState } from 'react'
import { AuthCard } from './AuthCard.js'
import { OtpInput } from './OtpInput.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'

/** Second-factor entry modes the form can render. */
export type TwoFactorMethod = 'totp' | 'backup' | 'emailOtp'

const RESEND_COOLDOWN_SECONDS = 30

const copyByMethod: Record<TwoFactorMethod, { hint: string; label: string }> = {
  totp: {
    hint: 'Enter the 6-digit code from your authenticator app',
    label: 'Verification Code',
  },
  backup: {
    hint: 'Enter one of the backup codes you saved when setting up two-factor authentication. Each code works once.',
    label: 'Backup Code',
  },
  emailOtp: {
    hint: "We've emailed you a verification code. Enter it below.",
    label: 'Emailed Code',
  },
}

const linkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--theme-text)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-small)',
  opacity: 0.7,
  padding: 'calc(var(--base) * 0.25)',
  textDecoration: 'underline',
}

export function TwoFactorForm({
  code,
  onCodeChange,
  onSubmit,
  onBack,
  loading,
  error,
  logo,
  method = 'totp',
  onMethodChange,
  enableBackupCode = false,
  enableEmailOtp = false,
  onResendEmailOtp,
}: {
  code: string
  onCodeChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  loading: boolean
  error: string | null
  logo?: React.ReactNode
  /** Which second factor is being entered. Default: 'totp'. */
  method?: TwoFactorMethod
  /** Called when the user picks a different second factor. */
  onMethodChange?: (method: TwoFactorMethod) => void
  /** Offer "use a backup code". */
  enableBackupCode?: boolean
  /** Offer "email me a code" (requires the twoFactor plugin's `otpOptions`). */
  enableEmailOtp?: boolean
  /** Re-send the emailed code (shown in emailOtp mode). */
  onResendEmailOtp?: () => void
}) {
  const { hint, label } = copyByMethod[method]
  const submitDisabled =
    loading || (method === 'backup' ? code.trim().length === 0 : code.length !== 6)

  // A code is emailed when the method is selected and on every resend, so gate
  // resends behind a countdown — the server rate-limits anyway, but a ticking
  // link beats an opaque rate-limit error.
  const [resendCooldown, setResendCooldown] = useState(0)
  useEffect(() => {
    if (method === 'emailOtp') setResendCooldown(RESEND_COOLDOWN_SECONDS)
  }, [method])
  useEffect(() => {
    if (resendCooldown === 0) return
    const timer = setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [resendCooldown])

  const alternates: Array<{ label: string; method: TwoFactorMethod }> = []
  if (method !== 'totp') {
    alternates.push({ label: 'Use your authenticator app', method: 'totp' })
  }
  if (enableBackupCode && method !== 'backup') {
    alternates.push({ label: 'Use a backup code', method: 'backup' })
  }
  if (enableEmailOtp && method !== 'emailOtp') {
    alternates.push({ label: 'Email me a code', method: 'emailOtp' })
  }

  return (
    <AuthCard logo={logo}>

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
          {hint}
        </p>

        <form onSubmit={onSubmit}>
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
              {label}
            </label>
            {method === 'backup' ? (
              <input
                id="totp-code"
                type="text"
                value={code}
                onChange={(e) => onCodeChange(e.target.value)}
                autoFocus
                autoComplete="off"
                required
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
            ) : (
              <OtpInput id="totp-code" value={code} onChange={onCodeChange} autoFocus pattern="[0-9]*" />
            )}
          </div>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={submitDisabled}>
            {loading ? 'Verifying...' : 'Verify'}
          </AuthButton>
        </form>

        {(alternates.length > 0 || (method === 'emailOtp' && onResendEmailOtp)) && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--base) * 0.25)',
              marginTop: 'var(--base)',
              textAlign: 'center',
            }}
          >
            {method === 'emailOtp' && onResendEmailOtp && (
              <button
                type="button"
                onClick={() => {
                  onResendEmailOtp()
                  setResendCooldown(RESEND_COOLDOWN_SECONDS)
                }}
                style={{
                  ...linkStyle,
                  cursor: resendCooldown > 0 ? 'default' : linkStyle.cursor,
                  textDecoration: resendCooldown > 0 ? 'none' : linkStyle.textDecoration,
                }}
                disabled={loading || resendCooldown > 0}
              >
                {resendCooldown > 0
                  ? `Resend the code (${resendCooldown}s)`
                  : 'Resend the code'}
              </button>
            )}
            {alternates.map((alternate) => (
              <button
                key={alternate.method}
                type="button"
                onClick={() => onMethodChange?.(alternate.method)}
                style={linkStyle}
                disabled={loading}
              >
                {alternate.label}
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onBack}
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
    </AuthCard>
  )
}
