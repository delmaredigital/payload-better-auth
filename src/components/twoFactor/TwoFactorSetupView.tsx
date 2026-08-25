'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useConfig } from '@payloadcms/ui'
import { QRCodeSVG } from 'qrcode.react'
import { useAuthMountPath } from '../useAuthMountPath.js'
import { extractTotpSecret } from '../../utils/totp.js'

export type TwoFactorSetupViewProps = {
  /** Custom logo element */
  logo?: React.ReactNode
  /** Page title. Default: 'Set Up Two-Factor Authentication' */
  title?: string
  /** Path to redirect after successful setup. Defaults to `routes.admin`. */
  afterSetupPath?: string
  /** Callback after successful setup */
  onSetupComplete?: () => void
  /**
   * Whether the signed-in account has a credential (password) account.
   * `true` (default): the flow starts with a password confirmation step —
   * Better Auth's `/two-factor/enable` requires the password. `false`:
   * enablement starts immediately (needs the twoFactor plugin's
   * `allowPasswordless`). Resolve it server-side — don't ask the user — by
   * rendering through `TwoFactorSetupViewWrapper` (from `/rsc`).
   */
  hasPassword?: boolean
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
  hasPassword = true,
}: TwoFactorSetupViewProps) {
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const authMountPath = useAuthMountPath()
  const resolvedAfterSetupPath = afterSetupPath ?? adminRoute
  const [step, setStep] = useState<
    'password' | 'start' | 'qr' | 'verify' | 'backup' | 'complete'
  >(hasPassword ? 'password' : 'start')
  const [password, setPassword] = useState('')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  // Better Auth's /two-factor/enable requires the account password (unless the
  // account is passwordless and `allowPasswordless` is set), so credential
  // accounts confirm it first instead of firing a doomed request on mount.
  async function enableTwoFactor(body: { password?: string }) {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`${authMountPath}/two-factor/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // Better Auth 1.7 made the response a discriminated union on `method`;
        // `totp` is still the default, but ask for it explicitly so this stays
        // pinned to the authenticator-app flow this view actually renders.
        body: JSON.stringify({ ...body, method: 'totp' }),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.method && data.method !== 'totp') {
          setError('Unexpected two-factor method returned by the server.')
          return
        }
        setTotpUri(data.totpURI)
        // The response carries no `secret` field — it only lives inside the
        // totpURI, which is what the manual-entry fallback below shows.
        setSecret(extractTotpSecret(data.totpURI))
        setBackupCodes(data.backupCodes || [])
        setPassword('')
        setStep('qr')
      } else {
        const data = await response.json().catch(() => ({}))
        setError(data.message || 'Failed to enable two-factor authentication.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    void enableTwoFactor({ password })
  }

  // Passwordless accounts have no password to confirm — start enablement
  // directly (the ref keeps StrictMode's double-invoke to one request).
  const autoStartRan = useRef(false)
  useEffect(() => {
    if (hasPassword || autoStartRan.current) return
    autoStartRan.current = true
    void enableTwoFactor({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPassword])

  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`${authMountPath}/two-factor/verify-totp`, {
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

  async function handleCopyCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'))
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2000)
    } catch {
      // Clipboard permission denied — tell the user instead of failing silently.
      setCopyStatus('failed')
    }
  }

  function handleDownloadCodes() {
    const blob = new Blob([`${backupCodes.join('\n')}\n`], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'backup-codes.txt'
    // Firefox only honours a click on an anchor that's in the document, and
    // revoking the URL in the same tick can cancel the download that click
    // just started — so attach, click, then clean up once it's under way.
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  // Password confirmation state
  if (step === 'password') {
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
            <div style={{ textAlign: 'center', marginBottom: 'calc(var(--base) * 1.5)' }}>
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
            Confirm your password to start setting up two-factor authentication.
          </p>

          <form onSubmit={handlePasswordSubmit}>
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  color: 'var(--theme-text)',
                  marginBottom: 'calc(var(--base) * 0.5)',
                  fontSize: 'var(--font-size-small)',
                  fontWeight: 500,
                }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
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
              disabled={loading || password.length === 0}
              style={{
                width: '100%',
                padding: 'calc(var(--base) * 0.75)',
                background: 'var(--theme-elevation-800)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-elevation-50)',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: loading || password.length === 0 ? 'not-allowed' : 'pointer',
                opacity: loading || password.length === 0 ? 0.7 : 1,
                transition: 'opacity 150ms ease',
              }}
            >
              {loading ? 'Checking...' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Passwordless start state: enablement fires on mount; this renders the
  // in-between (and a retry if it fails).
  if (step === 'start') {
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
            <div style={{ textAlign: 'center', marginBottom: 'calc(var(--base) * 1.5)' }}>
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
              marginBottom: error ? 'var(--base)' : 0,
            }}
          >
            {error ? 'Two-factor setup could not be started.' : 'Preparing two-factor setup…'}
          </p>

          {error && (
            <>
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

              <button
                type="button"
                onClick={() => void enableTwoFactor({})}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: 'calc(var(--base) * 0.75)',
                  background: 'var(--theme-elevation-800)',
                  border: 'none',
                  borderRadius: 'var(--style-radius-s)',
                  color: 'var(--theme-elevation-50)',
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  transition: 'opacity 150ms ease',
                }}
              >
                {loading ? 'Retrying...' : 'Try again'}
              </button>
            </>
          )}
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

          <div
            style={{
              display: 'flex',
              gap: 'calc(var(--base) * 0.5)',
              marginBottom: 'var(--base)',
            }}
          >
            <button
              onClick={() => void handleCopyCodes()}
              style={{
                flex: 1,
                padding: 'calc(var(--base) * 0.5)',
                background: 'var(--theme-elevation-150)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-small)',
                cursor: 'pointer',
              }}
            >
              {copyStatus === 'copied'
                ? 'Copied!'
                : copyStatus === 'failed'
                  ? 'Copy failed — select the codes manually'
                  : 'Copy to Clipboard'}
            </button>
            <button
              onClick={handleDownloadCodes}
              style={{
                flex: 1,
                padding: 'calc(var(--base) * 0.5)',
                background: 'var(--theme-elevation-150)',
                border: 'none',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-small)',
                cursor: 'pointer',
              }}
            >
              Download
            </button>
          </div>

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
            {/*
              QR rendered client-side as inline SVG. The TOTP provisioning URI
              contains the shared secret and must NEVER be sent to a third party
              (it previously went to api.qrserver.com, leaking every user's 2FA
              secret to an external service).
            */}
            <QRCodeSVG
              value={totpUri}
              size={200}
              marginSize={2}
              title="QR code for authenticator app"
              style={{
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
