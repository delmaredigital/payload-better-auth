'use client'

import { useState, useEffect, useRef } from 'react'
import { Button, Banner } from '@payloadcms/ui'
import { PlusIcon } from '@payloadcms/ui/icons/Plus'
import { XIcon } from '@payloadcms/ui/icons/X'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'
import { useAuthClientBaseURL } from '../useAuthMountPath.js'
import { color, font, radius, space } from '../theme.js'

type PasskeyItem = {
  id: string
  name?: string | null
  credentialID?: string
  createdAt: Date
  lastUsedAt?: Date | null
}

export type PasskeysManagementClientProps = {
  /** Optional pre-configured auth client */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
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

  const authBaseURL = useAuthClientBaseURL()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)
  const getClient = async () => {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    const { passkeyClient } = await import('@better-auth/passkey/client')
    clientRef.current = createAuthClient({
      ...(authBaseURL ? { baseURL: authBaseURL } : {}),
      plugins: [twoFactorClient(), passkeyClient()],
    })
    return clientRef.current
  }

  useEffect(() => {
    let ignore = false
    fetchPasskeys(() => !ignore)
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // `isActive` guards against setState after unmount and StrictMode double-fetch.
  async function fetchPasskeys(isActive: () => boolean = () => true) {
    setLoading(true)
    setError(null)

    try {
      const client = await getClient()
      const result = await client.passkey.listUserPasskeys()
      if (!isActive()) return

      if (result.error) {
        setError(result.error.message ?? 'Failed to load passkeys')
      } else {
        setPasskeys((result.data as PasskeyItem[]) ?? [])
      }
    } catch {
      if (isActive()) setError('Failed to load passkeys')
    } finally {
      if (isActive()) setLoading(false)
    }
  }

  async function handleRegister() {
    setRegistering(true)
    setError(null)
    setSuccess(null)

    try {
      const client = await getClient()
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
      const client = await getClient()
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
      {error && <Banner type="danger">{error}</Banner>}
      {success && <Banner type="success">{success}</Banner>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space() }}>
        <p className="field-description" style={{ margin: 0 }}>
          Passkeys provide secure, passwordless sign-in using your device&apos;s biometrics or security keys.
        </p>
        {!showRegisterForm && (
          <Button
            buttonStyle="secondary"
            size="medium"
            icon={<PlusIcon />}
            onClick={() => setShowRegisterForm(true)}
          >
            Add Passkey
          </Button>
        )}
      </div>

      {showRegisterForm && (
        <div style={{ marginBottom: space() }}>
          <div style={{ marginBottom: space() }}>
            <label className="field-label" style={{ marginBottom: space(0.5), display: 'block' }}>
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
                padding: space(),
                background: color.inputBg,
                border: `1px solid ${color.inputBorder}`,
                borderRadius: radius.small,
                color: color.text,
                fontSize: font.base,
                boxSizing: 'border-box',
              }}
            />
            <p className="field-description" style={{ marginTop: space(0.25) }}>
              Your browser will prompt you to use your device&apos;s biometrics or security key.
            </p>
          </div>
          <div style={{ display: 'flex', gap: space(0.5) }}>
            <Button
              buttonStyle="primary"
              size="medium"
              onClick={handleRegister}
              disabled={registering}
            >
              {registering ? 'Registering...' : 'Register Passkey'}
            </Button>
            <Button
              buttonStyle="secondary"
              size="medium"
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
            border: `1px solid ${color.border}`,
            borderRadius: radius.small,
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
                padding: space(),
                borderBottom:
                  index < passkeys.length - 1
                    ? `1px solid ${color.border}`
                    : 'none',
              }}
            >
              <div>
                <div style={{ color: color.text, fontWeight: 500 }}>
                  {pk.name || 'Passkey'}
                </div>
                <p className="field-description" style={{ margin: `${space(0.25)} 0 0 0` }}>
                  Created: {formatDate(pk.createdAt)}
                  {pk.lastUsedAt && ` | Last used: ${formatDate(pk.lastUsedAt)}`}
                </p>
              </div>

              <Button
                buttonStyle="destructive"
                size="medium"
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
