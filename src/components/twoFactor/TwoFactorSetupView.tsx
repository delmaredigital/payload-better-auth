'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useConfig } from '@payloadcms/ui'

export type TwoFactorSetupViewProps = {
  /** Custom logo element */
  logo?: React.ReactNode
  /** Page title. Default: 'Set Up Two-Factor Authentication' */
  title?: string
  /** Path to redirect after successful setup. Defaults to `routes.admin`. */
  afterSetupPath?: string
  /** Callback after successful setup */
  onSetupComplete?: () => void
}

/**
 * Two-factor authentication setup component.
 * Displays QR code for TOTP apps and allows verification.
 * Uses Better Auth's twoFactor plugin endpoints.
 */
export function TwoFactorSetupView({
  logo,
  title = 'Set Up Two-Factor Authentication',
  afterSetupPath,
  onSetupComplete,
}: TwoFactorSetupViewProps) {
  const {
    config: {
      routes: { admin: adminRoute, api: apiRoute },
    },
  } = useConfig()
  const resolvedAfterSetupPath = afterSetupPath ?? adminRoute
  const [step, setStep] = useState<'loading' | 'qr' | 'verify' | 'backup' | 'complete'>('loading')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function enableTwoFactor() {
      try {
        const response = await fetch(`${apiRoute}/auth/two-factor/enable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        })

        if (response.ok) {
          const data = await response.json()
          setTotpUri(data.totpURI)
          setSecret(data.secret)
          setBackupCodes(data.backupCodes || [])
          setStep('qr')
        } else {
          const data = await response.json().catch(() => ({}))
          setError(data.message || 'Failed to enable two-factor authentication.')
          setStep('qr')
        }
      } catch {
        setError('An error occurred. Please try again.')
        setStep('qr')
      }
    }
    enableTwoFactor()
  }, [apiRoute])

  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${apiRoute}/auth/two-factor/verify-totp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: verificationCode }),
      })

      if (response.ok) {
        if (backupCodes.length > 0) {
          setStep('backup')
        } else {
          setStep('complete')
          onSetupComplete?.()
        }
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.message || 'Invalid verification code. Please try again.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleBackupContinue() {
    setStep('complete')
    onSetupComplete?.()
  }

  // Loading state
  if (step === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--theme-bg)',
        }}
      >
        <div style={{ color: 'var(--theme-text)', opacity: 0.7 }}>
          Setting up two-factor authentication...
        </div>
      </div>
    )
  }

  // Complete state
  if (step === 'complete') {
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
            Two-Factor Enabled!
          </h1>

          <p
            style={{
              color: 'var(--theme-text)',
              opacity: 0.8,
              marginBottom: 'calc(var(--base) * 1.5)',
              fontSize: 'var(--font-size-small)',
            }}
          >
            Your account is now protected with two-factor authentication.
          </p>

          <a
            href={resolvedAfterSetupPath}
            style={{
              display: 'inline-block',
              padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Continue
          </a>
        </div>
      </div>
    )
  }

  // Backup codes state
  if (step === 'backup') {
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
            maxWidth: '450px',
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
              margin: '0 0 calc(var(--base) * 0.5) 0',
              textAlign: 'center',
            }}
          >
            Save Your Backup Codes
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
            Store these codes safely. You can use them to access your account if you lose your authenticator.
          </p>

          <div
            style={{
              background: 'var(--theme-elevation-100)',
              padding: 'var(--base)',
              borderRadius: 'var(--style-radius-s)',
              marginBottom: 'calc(var(--base) * 1.5)',
              fontFamily: 'monospace',
              fontSize: 'var(--font-size-small)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 'calc(var(--base) * 0.5)',
              }}
            >
              {backupCodes.map((code, index) => (
                <div
                  key={index}
                  style={{
                    color: 'var(--theme-text)',
                    padding: 'calc(var(--base) * 0.25)',
                  }}
                >
                  {code}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              navigator.clipboard.writeText(backupCodes.join('\n'))
            }}
            style={{
              width: '100%',
              padding: 'calc(var(--base) * 0.5)',
              background: 'var(--theme-elevation-150)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-small)',
              cursor: 'pointer',
              marginBottom: 'var(--base)',
            }}
          >
            Copy to Clipboard
          </button>

          <button
            onClick={handleBackupContinue}
            style={{
              width: '100%',
              padding: 'calc(var(--base) * 0.75)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            I've Saved My Codes
          </button>
        </div>
      </div>
    )
  }

  // QR code and verify state
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
            margin: '0 0 calc(var(--base) * 0.5) 0',
            textAlign: 'center',
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
          Scan the QR code with your authenticator app, then enter the code below.
        </p>

        {totpUri && (
          <div
            style={{
              textAlign: 'center',
              marginBottom: 'calc(var(--base) * 1.5)',
            }}
          >
            {/* QR code using QRServer.com API */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
              alt="QR Code for authenticator app"
              style={{
                width: '200px',
                height: '200px',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
              }}
            />
          </div>
        )}

        {secret && (
          <div
            style={{
              marginBottom: 'calc(var(--base) * 1.5)',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                color: 'var(--theme-text)',
                opacity: 0.7,
                fontSize: 'var(--font-size-small)',
                marginBottom: 'calc(var(--base) * 0.5)',
              }}
            >
              Or enter this code manually:
            </p>
            <code
              style={{
                display: 'inline-block',
                padding: 'calc(var(--base) * 0.5)',
                background: 'var(--theme-elevation-100)',
                borderRadius: 'var(--style-radius-s)',
                fontFamily: 'monospace',
                fontSize: 'var(--font-size-small)',
                color: 'var(--theme-text)',
                wordBreak: 'break-all',
              }}
            >
              {secret}
            </code>
          </div>
        )}

        <form onSubmit={handleVerify}>
          <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
            <label
              htmlFor="code"
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
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              placeholder="000000"
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-h4)',
                fontFamily: 'monospace',
                textAlign: 'center',
                letterSpacing: '0.5em',
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
            disabled={loading || verificationCode.length !== 6}
            style={{
              width: '100%',
              padding: 'calc(var(--base) * 0.75)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              cursor: loading || verificationCode.length !== 6 ? 'not-allowed' : 'pointer',
              opacity: loading || verificationCode.length !== 6 ? 0.7 : 1,
              transition: 'opacity 150ms ease',
            }}
          >
            {loading ? 'Verifying...' : 'Verify and Enable'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default TwoFactorSetupView
