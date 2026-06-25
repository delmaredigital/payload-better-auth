'use client'

import type React from 'react'
import { AuthCard } from './AuthCard.js'
import { AuthBanner } from './AuthBanner.js'
import { AuthButton } from './AuthButton.js'
import { AuthField } from './AuthField.js'
import { OrDivider } from './OrDivider.js'

export function LoginForm({
  logo, title, successMessage, error,
  email, onEmailChange,
  passwordAvailable, password, onPasswordChange,
  forgotPasswordAvailable, onForgotPassword,
  onSubmit, primaryLabel, actionsDisabled,
  secondaryMethods, showEmptyState,
  signUpAvailable, onCreateAccount,
}: {
  logo?: React.ReactNode
  title: string
  successMessage: string | null
  error: string | null
  email: string
  onEmailChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  passwordAvailable: boolean
  password: string
  onPasswordChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  forgotPasswordAvailable: boolean
  onForgotPassword: () => void
  onSubmit: (e: React.FormEvent) => void
  primaryLabel: string
  actionsDisabled: boolean
  secondaryMethods: Array<{ key: string; icon?: React.ReactNode; label: string; onClick: () => void; busy: boolean }>
  showEmptyState: boolean
  signUpAvailable: boolean
  onCreateAccount: () => void
}) {
  return (
    <AuthCard logo={logo}>

        <h1
          style={{
            color: 'var(--theme-text)',
            fontSize: 'var(--font-size-h3)',
            fontWeight: 600,
            textAlign: 'center',
            margin: '0 0 calc(var(--base) * 1.5) 0',
          }}
        >
          {title}
        </h1>

        {successMessage && <AuthBanner kind="success">{successMessage}</AuthBanner>}

        <form onSubmit={onSubmit}>
          <AuthField id="email" label="Email" type="email" value={email} onChange={onEmailChange} autoComplete="email" autoFocus />

          {passwordAvailable && (
          <>
          <AuthField id="password" label="Password" type="password" value={password} onChange={onPasswordChange} autoComplete="current-password" />

          {forgotPasswordAvailable && (
            <div
              style={{
                marginBottom: 'calc(var(--base) * 1.5)',
                textAlign: 'right',
              }}
            >
              <button
                type="button"
                onClick={onForgotPassword}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--theme-text)',
                  opacity: 0.7,
                  cursor: 'pointer',
                  fontSize: 'var(--font-size-small)',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Forgot password?
              </button>
            </div>
          )}
          </>
          )}

          {error && <AuthBanner kind="error">{error}</AuthBanner>}

          <AuthButton type="submit" disabled={actionsDisabled}>
            {primaryLabel}
          </AuthButton>
        </form>

        {secondaryMethods.length > 0 && (
          <>
            <OrDivider />

            {secondaryMethods.map((method) => (
              <div key={method.key} style={{ marginBottom: 'calc(var(--base) * 0.5)' }}>
                <AuthButton
                  variant="secondary"
                  icon={method.icon}
                  disabled={actionsDisabled || method.busy}
                  onClick={method.onClick}
                >
                  {method.label}
                </AuthButton>
              </div>
            ))}
          </>
        )}

        {showEmptyState && (
          <p
            style={{
              marginTop: 'var(--base)',
              textAlign: 'center',
              fontSize: 'var(--font-size-small)',
              color: 'var(--theme-text)',
              opacity: 0.7,
            }}
          >
            No sign-in methods are currently enabled.
          </p>
        )}

        {signUpAvailable && (
          <div
            style={{
              marginTop: 'calc(var(--base) * 1.5)',
              textAlign: 'center',
              fontSize: 'var(--font-size-small)',
              color: 'var(--theme-text)',
              opacity: 0.8,
            }}
          >
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={onCreateAccount}
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
              Create account
            </button>
          </div>
        )}
    </AuthCard>
  )
}
