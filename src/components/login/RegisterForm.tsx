'use client'

import type React from 'react'
import { AuthCard } from './AuthCard.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'
import { AuthField } from './AuthField.js'

export function RegisterForm({
  name,
  email,
  password,
  confirmPassword,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onBackToLogin,
  loading,
  error,
  logo,
}: {
  name: string
  email: string
  password: string
  confirmPassword: string
  onNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onConfirmPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onSubmit: (e: React.FormEvent) => void
  onBackToLogin: () => void
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
            margin: '0 0 calc(var(--base) * 1.5) 0',
            textAlign: 'center',
          }}
        >
          Create Account
        </h1>

        <form onSubmit={onSubmit}>
          <AuthField id="name" label="Name" type="text" value={name} onChange={onNameChange} autoComplete="name" />
          <AuthField id="register-email" label="Email" type="email" value={email} onChange={onEmailChange} autoComplete="email" />
          <AuthField id="register-password" label="Password" type="password" value={password} onChange={onPasswordChange} autoComplete="new-password" />
          <AuthField id="confirm-password" label="Confirm Password" type="password" value={confirmPassword} onChange={onConfirmPasswordChange} autoComplete="new-password" marginBottom="calc(var(--base) * 1.5)" />

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </AuthButton>
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
            onClick={onBackToLogin}
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
    </AuthCard>
  )
}
