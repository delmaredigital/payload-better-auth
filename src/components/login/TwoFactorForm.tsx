import React from 'react'
import { AuthCard } from './AuthCard.js'
import { OtpInput } from './OtpInput.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'

export function TwoFactorForm({ code, onCodeChange, onSubmit, onBack, loading, error, logo }: {
  code: string
  onCodeChange: (v: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
  loading: boolean
  error: string | null
  logo?: React.ReactNode
}) {
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
          Enter the 6-digit code from your authenticator app
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
              Verification Code
            </label>
            <OtpInput id="totp-code" value={code} onChange={onCodeChange} />
          </div>

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={loading || code.length !== 6}>
            {loading ? 'Verifying...' : 'Verify'}
          </AuthButton>
        </form>

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
