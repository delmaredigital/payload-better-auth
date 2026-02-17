'use client'

import { useState, useEffect } from 'react'
import { Button, Banner } from '@payloadcms/ui'
import { PlusIcon } from '@payloadcms/ui/icons/Plus'
import { XIcon } from '@payloadcms/ui/icons/X'
import {
  createPayloadAuthClient,
  type PayloadAuthClient,
} from '../../exports/client.js'

type PasskeyItem = {
  id: string
  name?: string | null
  credentialID?: string
  createdAt: Date
  lastUsedAt?: Date | null
}

export type PasskeysManagementClientProps = {
  /** Optional pre-configured auth client */
  authClient?: PayloadAuthClient
  /** Page title. Default: 'Passkeys' */
  title?: string
}

/**
 * Client component for passkey management.
 * Lists, registers, and deletes passkeys.
 */
export function PasskeysManagementClient({
  authClient: providedClient,
  title = 'Passkeys',
}: PasskeysManagementClientProps = {}) {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showRegisterForm, setShowRegisterForm] = useState(false)
  const [passkeyName, setPasskeyName] = useState('')

  const getClient = () => providedClient ?? createPayloadAuthClient()

  useEffect(() => {
    fetchPasskeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchPasskeys() {
    setLoading(true)
    setError(null)

    try {
      const client = getClient()
      const result = await client.passkey.listUserPasskeys()

      if (result.error) {
        setError(result.error.message ?? 'Failed to load passkeys')
      } else {
        setPasskeys((result.data as PasskeyItem[]) ?? [])
      }
    } catch {
      setError('Failed to load passkeys')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister() {
    setRegistering(true)
    setError(null)
    setSuccess(null)

    try {
      const client = getClient()
      const result = await client.passkey.addPasskey({
        name: passkeyName || undefined,
      })

      if (result.error) {
        setError(result.error.message ?? 'Failed to register passkey')
      } else {
        setSuccess('Passkey registered successfully!')
        setShowRegisterForm(false)
        setPasskeyName('')
        fetchPasskeys()
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Passkey registration was cancelled or not allowed')
      } else if (err instanceof Error && err.name === 'InvalidStateError') {
        setError('This passkey is already registered')
      } else {
        setError(err instanceof Error ? err.message : 'Failed to register passkey')
      }
    } finally {
      setRegistering(false)
    }
  }

  async function handleDelete(passkeyId: string) {
    if (!confirm('Are you sure you want to delete this passkey?')) {
      return
    }

    setDeleting(passkeyId)
    setError(null)
    setSuccess(null)

    try {
      const client = getClient()
      const result = await client.passkey.deletePasskey({ id: passkeyId })

      if (result.error) {
        setError(result.error.message ?? 'Failed to delete passkey')
      } else {
        setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId))
        setSuccess('Passkey deleted successfully')
      }
    } catch {
      setError('Failed to delete passkey')
    } finally {
      setDeleting(null)
    }
  }

  function formatDate(date?: Date | string | null) {
    if (!date) return 'Never'
    const d = date instanceof Date ? date : new Date(date)
    return d.toLocaleString()
  }

  return (
    <div className="field-type passkeys-management">
      {error && <Banner type="error">{error}</Banner>}
      {success && <Banner type="success">{success}</Banner>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--base)' }}>
        <p className="field-description" style={{ margin: 0 }}>
          Passkeys provide secure, passwordless sign-in using your device&apos;s biometrics or security keys.
        </p>
        {!showRegisterForm && (
          <Button
            buttonStyle="secondary"
            size="small"
            icon={<PlusIcon />}
            onClick={() => setShowRegisterForm(true)}
          >
            Add Passkey
          </Button>
        )}
      </div>

      {showRegisterForm && (
        <div style={{ marginBottom: 'var(--base)' }}>
          <div style={{ marginBottom: 'var(--base)' }}>
            <label className="field-label" style={{ marginBottom: 'calc(var(--base) * 0.5)', display: 'block' }}>
              Name (optional)
            </label>
            <input
              type="text"
              value={passkeyName}
              onChange={(e) => setPasskeyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRegister() } }}
              placeholder="e.g., MacBook Pro, iPhone"
              style={{
                width: '100%',
                padding: 'var(--base)',
                background: 'var(--theme-input-bg)',
                border: '1px solid var(--theme-border-color)',
                borderRadius: 'var(--style-radius-s)',
                color: 'var(--theme-text)',
                fontSize: 'var(--base-body-size)',
                boxSizing: 'border-box',
              }}
            />
            <p className="field-description" style={{ marginTop: 'calc(var(--base) * 0.25)' }}>
              Your browser will prompt you to use your device&apos;s biometrics or security key.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'calc(var(--base) * 0.5)' }}>
            <Button
              buttonStyle="primary"
              size="small"
              onClick={handleRegister}
              disabled={registering}
            >
              {registering ? 'Registering...' : 'Register Passkey'}
            </Button>
            <Button
              buttonStyle="secondary"
              size="small"
              onClick={() => setShowRegisterForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="field-description">Loading passkeys...</p>
      ) : passkeys.length === 0 ? (
        <p className="field-description">No passkeys registered.</p>
      ) : (
        <div
          style={{
            border: '1px solid var(--theme-border-color)',
            borderRadius: 'var(--style-radius-s)',
            overflow: 'hidden',
          }}
        >
          {passkeys.map((pk, index) => (
            <div
              key={pk.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--base)',
                borderBottom:
                  index < passkeys.length - 1
                    ? '1px solid var(--theme-border-color)'
                    : 'none',
              }}
            >
              <div>
                <div style={{ color: 'var(--theme-text)', fontWeight: 500 }}>
                  {pk.name || 'Passkey'}
                </div>
                <p className="field-description" style={{ margin: 'calc(var(--base) * 0.25) 0 0 0' }}>
                  Created: {formatDate(pk.createdAt)}
                  {pk.lastUsedAt && ` | Last used: ${formatDate(pk.lastUsedAt)}`}
                </p>
              </div>

              <Button
                buttonStyle="error"
                size="small"
                icon={<XIcon />}
                onClick={() => handleDelete(pk.id)}
                disabled={deleting === pk.id}
              >
                {deleting === pk.id ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PasskeysManagementClient
