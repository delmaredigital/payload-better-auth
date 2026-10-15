import React from 'react'
import { AuthCard } from './AuthCard.js'
import { AuthField } from './AuthField.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'
import { color, font, space } from '../theme.js'

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
            color: color.text,
            fontSize: font.h3,
            fontWeight: 600,
            margin: `0 0 ${space(0.5)} 0`,
            textAlign: 'center',
          }}
        >
          Reset Password
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
          Enter your email and we&apos;ll send you a link to reset your password
        </p>

        <form onSubmit={onSubmit}>
          <AuthField id="forgot-email" label="Email" type="email" value={email} onChange={onEmailChange} autoComplete="email" marginBottom={space(1.5)} autoFocus />

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
