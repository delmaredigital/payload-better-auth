'use client'

import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { createAuthClient } from 'better-auth/react'
import type { PermissionDefinition } from '../../types/apiKey.js'

type ApiKey = {
  id: string
  name: string | null
  start?: string | null
  startsWith?: string
  createdAt: Date
  expiresAt?: Date | null
  lastUsedAt?: Date | null
  /** BA-native permissions: { resource: ['read', 'write'] } */
  permissions?: Record<string, string[]> | null
  /** Metadata (may include organizationId) */
  metadata?: Record<string, unknown> | null
}

/** Organization option for the org selector */
export type OrganizationOption = {
  id: string | number
  name: string
}

export type ApiKeysManagementClientProps = {
  /** Optional pre-configured auth client with apiKey plugin */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
  /** Page title. Default: 'API Keys' */
  title?: string
  /** Available permission definitions (collections + actions). Auto-generated if not provided. */
  permissions?: PermissionDefinition[]
  /**
   * Available organizations for scoping API keys.
   * When provided, shows an organization selector in the creation form.
   * Each key can be optionally bound to one organization.
   */
  organizations?: OrganizationOption[]
}

/**
 * Client component for API keys management.
 * Lists, creates, and deletes API keys with permission selection (read/write per collection).
 */
export function ApiKeysManagementClient({
  authClient: providedClient,
  title = 'API Keys',
  permissions = [],
  organizations = [],
}: ApiKeysManagementClientProps = {}) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyExpiry, setNewKeyExpiry] = useState('')
  // Selected permissions: { posts: ['read', 'write'], pages: ['read'] }
  const [selectedPermissions, setSelectedPermissions] = useState<Record<string, string[]>>({})
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>('')

  const hasPermissions = permissions.length > 0
  const hasOrganizations = organizations.length > 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)
  const getClient = async () => {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    const { apiKeyClient } = await import('@better-auth/api-key/client')
    clientRef.current = createAuthClient({ plugins: [apiKeyClient()] })
    return clientRef.current
  }

  // Toggle a specific action for a collection
  function toggleAction(slug: string, action: string) {
    setSelectedPermissions((prev) => {
      const current = prev[slug] ?? []
      if (current.includes(action)) {
        // Remove action — if removing 'read' also remove 'write'
        if (action === 'read') {
          const filtered = current.filter((a) => a !== 'read' && a !== 'write')
          if (filtered.length === 0) {
            const { [slug]: _, ...rest } = prev
            return rest
          }
          return { ...prev, [slug]: filtered }
        }
        const filtered = current.filter((a) => a !== action)
        if (filtered.length === 0) {
          const { [slug]: _, ...rest } = prev
          return rest
        }
        return { ...prev, [slug]: filtered }
      } else {
        // Add action — if adding 'write' also add 'read'
        if (action === 'write') {
          return { ...prev, [slug]: [...new Set([...current, 'read', 'write'])] }
        }
        return { ...prev, [slug]: [...current, action] }
      }
    })
  }

  // Bulk toggle all of an action type
  function toggleAllOfType(action: string) {
    const allHave = permissions.every((p) => (selectedPermissions[p.slug] ?? []).includes(action))
    if (allHave) {
      // Remove this action from all — if removing 'read' also remove 'write'
      setSelectedPermissions((prev) => {
        const next: Record<string, string[]> = {}
        for (const [slug, actions] of Object.entries(prev)) {
          const filtered = action === 'read'
            ? actions.filter((a) => a !== 'read' && a !== 'write')
            : actions.filter((a) => a !== action)
          if (filtered.length > 0) next[slug] = filtered
        }
        return next
      })
    } else {
      // Add this action to all — if 'write' also add 'read'
      setSelectedPermissions((prev) => {
        const next = { ...prev }
        for (const p of permissions) {
          const current = next[p.slug] ?? []
          if (action === 'write') {
            next[p.slug] = [...new Set([...current, 'read', 'write'])]
          } else {
            next[p.slug] = [...new Set([...current, action])]
          }
        }
        return next
      })
    }
  }

  function isAllOfTypeSelected(action: string): boolean {
    return permissions.length > 0 && permissions.every((p) => (selectedPermissions[p.slug] ?? []).includes(action))
  }

  function isSomeOfTypeSelected(action: string): boolean {
    const count = permissions.filter((p) => (selectedPermissions[p.slug] ?? []).includes(action)).length
    return count > 0 && count < permissions.length
  }

  function clearAll() {
    setSelectedPermissions({})
  }

  function selectAll() {
    const next: Record<string, string[]> = {}
    for (const p of permissions) {
      next[p.slug] = ['read', 'write']
    }
    setSelectedPermissions(next)
  }

  // Count total selected actions
  const selectedCount = useMemo(() => {
    let count = 0
    for (const actions of Object.values(selectedPermissions)) {
      count += actions.length
    }
    return count
  }, [selectedPermissions])

  // Format permissions for display
  function formatPermissions(perms: Record<string, string[]> | null | undefined): string[] {
    if (!perms) return []
    const labels: string[] = []
    for (const [slug, actions] of Object.entries(perms)) {
      const def = permissions.find((p) => p.slug === slug)
      const label = def?.label ?? slug
      for (const action of actions) {
        labels.push(`${label}: ${action}`)
      }
    }
    return labels
  }

  useEffect(() => {
    fetchApiKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchApiKeys() {
    setLoading(true)
    setError(null)

    try {
      const client = await getClient()
      const result = await client.apiKey.list()

      if (result.error) {
        setError(result.error.message ?? 'Failed to load API keys')
      } else {
        const data = result.data as unknown as { apiKeys: ApiKey[] } | ApiKey[]
        setApiKeys(Array.isArray(data) ? data : data.apiKeys ?? [])
      }
    } catch {
      setError('Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setNewlyCreatedKey(null)

    try {
      const client = await getClient()
      const createOptions: {
        name: string
        expiresIn?: number
        permissions?: Record<string, string[]>
        organizationId?: string | number
      } = { name: newKeyName }

      if (newKeyExpiry) {
        createOptions.expiresIn = parseInt(newKeyExpiry) * 24 * 60 * 60
      }

      // Send permissions directly in BA's native format
      if (hasPermissions && selectedCount > 0) {
        createOptions.permissions = selectedPermissions
      }

      // Bind to organization if selected
      if (selectedOrganizationId) {
        createOptions.organizationId = selectedOrganizationId
      }

      const result = await client.apiKey.create(createOptions)

      if (result.error) {
        setError(result.error.message ?? 'Failed to create API key')
      } else if (result.data) {
        setNewlyCreatedKey(result.data.key)
        setShowCreateForm(false)
        setNewKeyName('')
        setNewKeyExpiry('')
        setSelectedPermissions({})
        setSelectedOrganizationId('')
        fetchApiKeys()
      }
    } catch {
      setError('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(keyId: string) {
    if (!confirm('Are you sure you want to delete this API key?')) {
      return
    }

    setDeleting(keyId)
    setError(null)

    try {
      const client = await getClient()
      const result = await client.apiKey.delete({ keyId })

      if (result.error) {
        setError(result.error.message ?? 'Failed to delete API key')
      } else {
        setApiKeys((prev) => prev.filter((k) => k.id !== keyId))
      }
    } catch {
      setError('Failed to delete API key')
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
    <div
      style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: 'calc(var(--base) * 2)',
      }}
    >

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'calc(var(--base) * 2)',
          }}
        >
          <h1
            style={{
              color: 'var(--theme-text)',
              fontSize: 'var(--font-size-h2)',
              fontWeight: 600,
              margin: 0,
            }}
          >
            {title}
          </h1>

          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              padding: 'calc(var(--base) * 0.5) calc(var(--base) * 1)',
              background: 'var(--theme-elevation-800)',
              border: 'none',
              borderRadius: 'var(--style-radius-s)',
              color: 'var(--theme-elevation-50)',
              fontSize: 'var(--font-size-small)',
              cursor: 'pointer',
            }}
          >
            Create API Key
          </button>
        </div>

        {error && (
          <div
            style={{
              color: 'var(--theme-error-500)',
              marginBottom: 'var(--base)',
              fontSize: 'var(--font-size-small)',
              padding: 'calc(var(--base) * 0.75)',
              background: 'var(--theme-error-50)',
              borderRadius: 'var(--style-radius-s)',
              border: '1px solid var(--theme-error-200)',
            }}
          >
            {error}
          </div>
        )}

        {newlyCreatedKey && (
          <div
            style={{
              marginBottom: 'calc(var(--base) * 1.5)',
              padding: 'calc(var(--base) * 1)',
              background: 'var(--theme-success-50)',
              borderRadius: 'var(--style-radius-m)',
              border: '1px solid var(--theme-success-200)',
            }}
          >
            <div
              style={{
                color: 'var(--theme-success-700)',
                fontWeight: 500,
                marginBottom: 'calc(var(--base) * 0.5)',
              }}
            >
              API Key Created
            </div>
            <p
              style={{
                color: 'var(--theme-text)',
                opacity: 0.8,
                fontSize: 'var(--font-size-small)',
                marginBottom: 'calc(var(--base) * 0.5)',
              }}
            >
              Copy this key now - you won't be able to see it again:
            </p>
            <div
              style={{
                display: 'flex',
                gap: 'calc(var(--base) * 0.5)',
                alignItems: 'center',
              }}
            >
              <code
                style={{
                  flex: 1,
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-elevation-100)',
                  borderRadius: 'var(--style-radius-s)',
                  fontFamily: 'monospace',
                  fontSize: 'var(--font-size-small)',
                  color: 'var(--theme-text)',
                  wordBreak: 'break-all',
                }}
              >
                {newlyCreatedKey}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newlyCreatedKey)
                }}
                style={{
                  padding: 'calc(var(--base) * 0.5)',
                  background: 'var(--theme-elevation-200)',
                  border: 'none',
                  borderRadius: 'var(--style-radius-s)',
                  cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {showCreateForm && (
          <div
            style={{
              marginBottom: 'calc(var(--base) * 1.5)',
              padding: 'calc(var(--base) * 1.5)',
              background: 'var(--theme-elevation-50)',
              borderRadius: 'var(--style-radius-m)',
              border: '1px solid var(--theme-elevation-100)',
            }}
          >
            <h2
              style={{
                color: 'var(--theme-text)',
                fontSize: 'var(--font-size-h4)',
                fontWeight: 500,
                margin: '0 0 var(--base) 0',
              }}
            >
              Create New API Key
            </h2>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 'var(--base)' }}>
                <label
                  style={{
                    display: 'block',
                    color: 'var(--theme-text)',
                    fontSize: 'var(--font-size-small)',
                    marginBottom: 'calc(var(--base) * 0.25)',
                  }}
                >
                  Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  required
                  placeholder="My API Key"
                  style={{
                    width: '100%',
                    padding: 'calc(var(--base) * 0.5)',
                    background: 'var(--theme-input-bg)',
                    border: '1px solid var(--theme-elevation-150)',
                    borderRadius: 'var(--style-radius-s)',
                    color: 'var(--theme-text)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ marginBottom: 'var(--base)' }}>
                <label
                  style={{
                    display: 'block',
                    color: 'var(--theme-text)',
                    fontSize: 'var(--font-size-small)',
                    marginBottom: 'calc(var(--base) * 0.25)',
                  }}
                >
                  Expires in (days, optional)
                </label>
                <input
                  type="number"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                  placeholder="30"
                  min="1"
                  style={{
                    width: '100%',
                    padding: 'calc(var(--base) * 0.5)',
                    background: 'var(--theme-input-bg)',
                    border: '1px solid var(--theme-elevation-150)',
                    borderRadius: 'var(--style-radius-s)',
                    color: 'var(--theme-text)',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Organization selector — bind key to a specific org */}
              {hasOrganizations && (
                <div style={{ marginBottom: 'var(--base)' }}>
                  <label
                    style={{
                      display: 'block',
                      color: 'var(--theme-text)',
                      fontSize: 'var(--font-size-small)',
                      marginBottom: 'calc(var(--base) * 0.25)',
                    }}
                  >
                    Organization (optional)
                  </label>
                  <select
                    value={selectedOrganizationId}
                    onChange={(e) => setSelectedOrganizationId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 'calc(var(--base) * 0.5)',
                      background: 'var(--theme-input-bg)',
                      border: '1px solid var(--theme-elevation-150)',
                      borderRadius: 'var(--style-radius-s)',
                      color: 'var(--theme-text)',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">No organization (global key)</option>
                    {organizations.map((org) => (
                      <option key={String(org.id)} value={String(org.id)}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{
                      marginTop: 'calc(var(--base) * 0.25)',
                      fontSize: '11px',
                      color: 'var(--theme-elevation-600)',
                    }}
                  >
                    {selectedOrganizationId
                      ? 'API key will only have access to this organization\'s data.'
                      : 'Without an organization, the key will not have org-scoped access.'}
                  </div>
                </div>
              )}

              {/* Permission selection — read/write per collection */}
              {hasPermissions && (
                <div style={{ marginBottom: 'var(--base)' }}>
                  <label
                    style={{
                      display: 'block',
                      color: 'var(--theme-text)',
                      fontSize: 'var(--font-size-small)',
                      marginBottom: 'calc(var(--base) * 0.5)',
                    }}
                  >
                    Permissions
                  </label>

                  {/* Bulk action buttons */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 'calc(var(--base) * 0.5)',
                      marginBottom: 'calc(var(--base) * 0.75)',
                    }}
                  >
                    <BulkButton
                      label="All Read"
                      active={isAllOfTypeSelected('read')}
                      indeterminate={isSomeOfTypeSelected('read')}
                      onClick={() => toggleAllOfType('read')}
                    />
                    <BulkButton
                      label="All Write"
                      active={isAllOfTypeSelected('write')}
                      indeterminate={isSomeOfTypeSelected('write')}
                      onClick={() => toggleAllOfType('write')}
                    />
                    <div style={{ flex: 1 }} />
                    <button
                      type="button"
                      onClick={selectAll}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px solid var(--theme-elevation-200)',
                        borderRadius: 'var(--style-radius-s)',
                        color: 'var(--theme-text)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        opacity: 0.8,
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearAll}
                      style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        border: '1px solid var(--theme-elevation-200)',
                        borderRadius: 'var(--style-radius-s)',
                        color: 'var(--theme-text)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        opacity: 0.8,
                      }}
                    >
                      Clear
                    </button>
                  </div>

                  {/* Permission grid — collection rows with read/write checkboxes */}
                  <div
                    style={{
                      background: 'var(--theme-input-bg)',
                      border: '1px solid var(--theme-elevation-150)',
                      borderRadius: 'var(--style-radius-s)',
                      maxHeight: '400px',
                      overflowY: 'auto',
                    }}
                  >
                    {/* Header row */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 60px 60px',
                        gap: 'calc(var(--base) * 0.5)',
                        padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.75)',
                        borderBottom: '1px solid var(--theme-elevation-150)',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: 'var(--theme-elevation-600)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      <span>Collection</span>
                      <span style={{ textAlign: 'center' }}>Read</span>
                      <span style={{ textAlign: 'center' }}>Write</span>
                    </div>

                    {permissions.map((perm) => {
                      const actions = selectedPermissions[perm.slug] ?? []
                      const hasRead = actions.includes('read')
                      const hasWrite = actions.includes('write')

                      return (
                        <div
                          key={perm.slug}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 60px 60px',
                            gap: 'calc(var(--base) * 0.5)',
                            padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.75)',
                            borderBottom: '1px solid var(--theme-elevation-100)',
                            alignItems: 'center',
                            background: (hasRead || hasWrite) ? 'var(--theme-elevation-50)' : 'transparent',
                          }}
                        >
                          <span
                            style={{
                              color: 'var(--theme-text)',
                              fontSize: 'var(--font-size-small)',
                              fontWeight: 500,
                            }}
                          >
                            {perm.label}
                          </span>
                          <label style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={hasRead}
                              onChange={() => toggleAction(perm.slug, 'read')}
                              style={{ cursor: 'pointer' }}
                            />
                          </label>
                          <label style={{ display: 'flex', justifyContent: 'center', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={hasWrite}
                              onChange={() => toggleAction(perm.slug, 'write')}
                              style={{ cursor: 'pointer' }}
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>

                  {/* Selection summary */}
                  <div
                    style={{
                      marginTop: 'calc(var(--base) * 0.5)',
                      fontSize: '11px',
                      color: selectedCount === 0 ? 'var(--theme-warning-500)' : 'var(--theme-elevation-600)',
                    }}
                  >
                    {selectedCount === 0
                      ? 'No permissions selected. Key will have no access.'
                      : `${selectedCount} permission${selectedCount === 1 ? '' : 's'} selected`}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 'calc(var(--base) * 0.5)' }}>
                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    padding: 'calc(var(--base) * 0.5) calc(var(--base) * 1)',
                    background: 'var(--theme-elevation-800)',
                    border: 'none',
                    borderRadius: 'var(--style-radius-s)',
                    color: 'var(--theme-elevation-50)',
                    fontSize: 'var(--font-size-small)',
                    cursor: creating ? 'not-allowed' : 'pointer',
                    opacity: creating ? 0.7 : 1,
                  }}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  style={{
                    padding: 'calc(var(--base) * 0.5) calc(var(--base) * 1)',
                    background: 'transparent',
                    border: '1px solid var(--theme-elevation-200)',
                    borderRadius: 'var(--style-radius-s)',
                    color: 'var(--theme-text)',
                    fontSize: 'var(--font-size-small)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              textAlign: 'center',
              padding: 'calc(var(--base) * 3)',
            }}
          >
            Loading API keys...
          </div>
        ) : apiKeys.length === 0 ? (
          <div
            style={{
              color: 'var(--theme-text)',
              opacity: 0.7,
              textAlign: 'center',
              padding: 'calc(var(--base) * 3)',
            }}
          >
            No API keys found. Create one to get started.
          </div>
        ) : (
          <div
            style={{
              background: 'var(--theme-elevation-50)',
              borderRadius: 'var(--style-radius-m)',
              overflow: 'hidden',
              border: '1px solid var(--theme-elevation-100)',
            }}
          >
            {apiKeys.map((key, index) => (
              <div
                key={key.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--base) * 1)',
                  borderBottom:
                    index < apiKeys.length - 1
                      ? '1px solid var(--theme-elevation-100)'
                      : 'none',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      color: 'var(--theme-text)',
                      fontWeight: 500,
                      marginBottom: 'calc(var(--base) * 0.25)',
                    }}
                  >
                    {key.name}
                  </div>
                  <div
                    style={{
                      color: 'var(--theme-elevation-600)',
                      fontSize: 'var(--font-size-small)',
                    }}
                  >
                    {(key.start || key.startsWith) && <code>{key.start || key.startsWith}...</code>}
                    <span> • Created: {formatDate(key.createdAt)}</span>
                    {key.expiresAt && (
                      <span> • Expires: {formatDate(key.expiresAt)}</span>
                    )}
                    {key.lastUsedAt && (
                      <span> • Last used: {formatDate(key.lastUsedAt)}</span>
                    )}
                  </div>
                  {/* Display organization binding */}
                  {Boolean(key.metadata?.organizationId) && (
                    <div
                      style={{
                        marginTop: 'calc(var(--base) * 0.5)',
                      }}
                    >
                      <span
                        style={{
                          padding: '2px 6px',
                          background: 'var(--theme-elevation-150)',
                          borderRadius: 'var(--style-radius-s)',
                          fontSize: '11px',
                          color: 'var(--theme-elevation-700)',
                          fontWeight: 500,
                        }}
                      >
                        Org: {(() => {
                          const orgId = String(key.metadata?.organizationId ?? '')
                          const org = organizations.find((o) => String(o.id) === orgId)
                          return org?.name ?? orgId
                        })()}
                      </span>
                    </div>
                  )}
                  {/* Display permissions */}
                  {key.permissions && Object.keys(key.permissions).length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'calc(var(--base) * 0.25)',
                        marginTop: 'calc(var(--base) * 0.5)',
                      }}
                    >
                      {formatPermissions(key.permissions).map((label) => (
                        <span
                          key={label}
                          style={{
                            padding: '2px 6px',
                            background: 'var(--theme-elevation-100)',
                            borderRadius: 'var(--style-radius-s)',
                            fontSize: '11px',
                            color: 'var(--theme-elevation-700)',
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={() => handleDelete(key.id)}
                  disabled={deleting === key.id}
                  style={{
                    padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.75)',
                    background: 'transparent',
                    border: '1px solid var(--theme-error-300)',
                    borderRadius: 'var(--style-radius-s)',
                    color: 'var(--theme-error-500)',
                    fontSize: 'var(--font-size-small)',
                    cursor: deleting === key.id ? 'not-allowed' : 'pointer',
                    opacity: deleting === key.id ? 0.7 : 1,
                  }}
                >
                  {deleting === key.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/**
 * Bulk action button with active/indeterminate states
 */
function BulkButton({
  label,
  active,
  indeterminate,
  onClick,
}: {
  label: string
  active: boolean
  indeterminate: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 10px',
        background: active
          ? 'var(--theme-elevation-700)'
          : indeterminate
          ? 'var(--theme-elevation-300)'
          : 'var(--theme-elevation-100)',
        border: 'none',
        borderRadius: 'var(--style-radius-s)',
        color: active ? 'var(--theme-elevation-50)' : 'var(--theme-text)',
        fontSize: '11px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      {label}
    </button>
  )
}

export default ApiKeysManagementClient
