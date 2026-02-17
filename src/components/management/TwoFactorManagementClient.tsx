'use client'

import { useState, useEffect } from 'react'
import { Button, Banner } from '@payloadcms/ui'
import { CopyIcon } from '@payloadcms/ui/icons/Copy'
import {
  createPayloadAuthClient,
  type PayloadAuthClient,
} from '../../exports/client.js'

export type TwoFactorManagementClientProps = {
  /** Optional pre-configured auth client */
  authClient?: PayloadAuthClient
  /** Page title. Default: 'Two-Factor Authentication' */
  title?: string
  /** Called after 2FA is enabled or disabled. Use to refresh form state. */
  onComplete?: () => void | Promise<void>
}

/**
 * Client component for two-factor authentication management.
 * Shows 2FA status and allows enabling/disabling.
 */
export function TwoFactorManagementClient({
  authClient: providedClient,
  title = 'Two-Factor Authentication',
  onComplete,
}: TwoFactorManagementClientProps = {}) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'status' | 'password' | 'setup' | 'verify' | 'backup'>('status')
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verificationCode, setVerificationCode] = useState('')
  const [password, setPassword] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

  const getClient = () => providedClient ?? createPayloadAuthClient()

  useEffect(() => {
    checkStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkStatus() {
    setLoading(true)
    try {
      const client = getClient()
      const result = await client.getSession()

      if (result.data?.user) {
        setIsEnabled((result.data.user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? false)
      } else {
        setIsEnabled(false)
      }
    } catch {
      setError('Failed to check 2FA status')
    } finally {
      setLoading(false)
    }
  }

  function handleEnableClick() {
    // Show password prompt first
    setStep('password')
    setPassword('')
    setError(null)
  }

  async function handleEnableWithPassword() {
    setActionLoading(true)
    setError(null)

    try {
      const client = getClient()
      const result = await client.twoFactor.enable({ password })

      if (result.error) {
        setError(result.error.message ?? 'Failed to enable 2FA')
      } else if (result.data) {
        setTotpUri(result.data.totpURI)
        // Secret is embedded in the totpURI, extract it for manual entry option
        const secretMatch = result.data.totpURI.match(/secret=([A-Z2-7]+)/i)
        setSecret(secretMatch ? secretMatch[1] : null)
        setBackupCodes(result.data.backupCodes ?? [])
        setPassword('') // Clear password
        setStep('setup')
      }
    } catch {
      setError('Failed to enable 2FA')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleVerify() {
    setActionLoading(true)
    setError(null)

    try {
      const client = getClient()
      const result = await client.twoFactor.verifyTotp({ code: verificationCode })

      if (result.error) {
        setError(result.error.message ?? 'Invalid verification code')
      } else {
        if (backupCodes.length > 0) {
          setStep('backup')
        } else {
          setIsEnabled(true)
          setStep('status')
          onComplete?.()
        }
      }
    } catch {
      setError('Verification failed')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleDisable() {
    if (!confirm('Are you sure you want to disable two-factor authentication?')) {
      return
    }

    setActionLoading(true)
    setError(null)

    try {
      const client = getClient()
      const result = await client.twoFactor.disable({ password: '' })

      if (result.error) {
        setError(result.error.message ?? 'Failed to disable 2FA')
      } else {
        setIsEnabled(false)
        onComplete?.()
      }
    } catch {
      setError('Failed to disable 2FA')
    } finally {
      setActionLoading(false)
    }
  }

  function handleBackupContinue() {
    setIsEnabled(true)
    setStep('status')
    onComplete?.()
  }

  if (loading) {
    return <p className="field-description">Loading...</p>
  }

  return (
    <div className="field-type two-factor-management">
      {error && (
        <Banner type="error">{error}</Banner>
      )}

      {step === 'status' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="field-description" style={{ margin: 0 }}>
            {isEnabled ? 'Two-factor authentication is enabled.' : 'Two-factor authentication is not enabled.'}
          </p>
          <Button
            buttonStyle={isEnabled ? 'error' : 'secondary'}
            size="small"
            onClick={isEnabled ? handleDisable : handleEnableClick}
            disabled={actionLoading}
          >
            {actionLoading ? 'Loading...' : isEnabled ? 'Disable' : 'Enable'}
          </Button>
        </div>
      )}

      {step === 'password' && (
        <div>
          <p className="field-description">
            Enter your password to enable two-factor authentication.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && password) { e.preventDefault(); handleEnableWithPassword() } }}
            placeholder="Enter your password"
            className="field-type__wrap"
            style={{
              width: '100%',
              padding: 'var(--base)',
              background: 'var(--theme-input-bg)',
              border: '1px solid var(--theme-border-color)',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-text)',
              fontSize: 'var(--base-body-size)',
              marginBottom: 'var(--base)',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 'calc(var(--base) * 0.5)' }}>
            <Button
              buttonStyle="primary"
              size="small"
              onClick={handleEnableWithPassword}
              disabled={actionLoading || !password}
            >
              {actionLoading ? 'Enabling...' : 'Continue'}
            </Button>
            <Button
              buttonStyle="secondary"
              size="small"
              onClick={() => setStep('status')}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'setup' && totpUri && (
        <div style={{ textAlign: 'center' }}>
          <p className="field-description">
            Scan this QR code with your authenticator app:
          </p>

          <img
            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totpUri)}`}
            alt="QR Code"
            style={{
              width: '200px',
              height: '200px',
              border: '1px solid var(--theme-border-color)',
              borderRadius: 'var(--style-radius-s)',
              marginBottom: 'var(--base)',
            }}
          />

          {secret && (
            <div style={{ marginBottom: 'calc(var(--base) * 1.5)' }}>
              <p className="field-description" style={{ marginBottom: 'calc(var(--base) * 0.5)' }}>
                Or enter manually:
              </p>
              <code
                style={{
                  display: 'inline-block',
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-elevation-100)',
                  borderRadius: 'var(--style-radius-s)',
                  fontFamily: 'monospace',
                  fontSize: 'var(--base-body-size)',
                  color: 'var(--theme-text)',
                }}
              >
                {secret}
              </code>
            </div>
          )}

          <div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={verificationCode}
              onChange={(e) =>
                setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              onKeyDown={(e) => { if (e.key === 'Enter' && verificationCode.length === 6) { e.preventDefault(); handleVerify() } }}
              placeholder="000000"
              style={{
                width: '200px',
                padding: 'var(--base)',
                background: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-border-color)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: '1.5rem',
                fontFamily: 'monospace',
                textAlign: 'center',
                letterSpacing: '0.5em',
                marginBottom: 'var(--base)',
                boxSizing: 'border-box',
              }}
            />
            <br />
            <Button
              buttonStyle="primary"
              size="small"
              onClick={handleVerify}
              disabled={actionLoading || verificationCode.length !== 6}
            >
              {actionLoading ? 'Verifying...' : 'Verify'}
            </Button>
          </div>
        </div>
      )}

      {step === 'backup' && (
        <div>
          <Banner type="info">
            Save these backup codes in a safe place. You can use them to sign in if you lose access to your authenticator app.
          </Banner>

          <div
            style={{
              background: 'var(--theme-elevation-100)',
              padding: 'var(--base)',
              borderRadius: 'var(--style-radius-s)',
              marginTop: 'var(--base)',
              marginBottom: 'var(--base)',
              fontFamily: 'monospace',
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

          <div style={{ display: 'flex', gap: 'calc(var(--base) * 0.5)' }}>
            <Button
              buttonStyle="secondary"
              size="small"
              icon={<CopyIcon />}
              onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))}
            >
              Copy to Clipboard
            </Button>
            <Button
              buttonStyle="primary"
              size="small"
              onClick={handleBackupContinue}
            >
              I've Saved My Codes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TwoFactorManagementClient
