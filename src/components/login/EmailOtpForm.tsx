import React from 'react'
import { AuthCard } from './AuthCard.js'
import { OtpInput } from './OtpInput.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'
import { color, font, space } from '../theme.js'

export function EmailOtpForm({ email, code, onCodeChange, onSubmit, onBack, loading, error, logo, codeLength = 6 }: {
  email: string
  code: string
  onCodeChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  loading: boolean
  error: string | null
  logo?: React.ReactNode
  /** Digits in the emailed code — the emailOTP plugin's `otpLength`. Default: 6. */
  codeLength?: number
}) {
  return (
    <AuthCard logo={logo}>

        <h1
          style={{
            color: color.text,
            fontSize: font.h3,
            fontWeight: 600,
            margin: `0 0 ${space(0.5)} 0`,
            textAlign: 'center',
          }}
        >
          Enter Your Code
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
          We&apos;ve sent a verification code to <strong>{email}</strong>
        </p>

        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: space(1.5) }}>
            <label
              htmlFor="email-otp-code"
              style={{
                display: 'block',
                color: color.text,
                marginBottom: space(0.5),
                fontSize: font.small,
                fontWeight: 500,
              }}
            >
              Verification Code
            </label>
            <OtpInput id="email-otp-code" value={code} onChange={onCodeChange} length={codeLength} autoFocus />
          </div>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={loading || code.length !== codeLength}>
            {loading ? 'Verifying...' : 'Verify'}
          </AuthButton>
        </form>

        <button
          type="button"
          onClick={onBack}
          style={{
            width: '100%',
            marginTop: space(),
            padding: space(0.5),
            background: 'transparent',
            border: 'none',
            color: color.text,
            opacity: 0.7,
            fontSize: font.small,
            cursor: 'pointer',
          }}
        >
          ← Back to login
        </button>
    </AuthCard>
  )
}
