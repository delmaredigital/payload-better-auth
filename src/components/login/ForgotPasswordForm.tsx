import React from 'react'
import { AuthCard } from './AuthCard.js'
import { AuthField } from './AuthField.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'

export function ForgotPasswordForm({ email, onEmailChange, onSubmit, onBack, loading, error, logo }: {
  email: string
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void
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

        <form onSubmit={onSubmit}>
          <AuthField id="forgot-email" label="Email" type="email" value={email} onChange={onEmailChange} autoComplete="email" marginBottom="calc(var(--base) * 1.5)" autoFocus />

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Sending...' : 'Send Reset Link'}
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
