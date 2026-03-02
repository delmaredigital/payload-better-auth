'use client'

import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import {
  createPayloadAuthClient,
  type PayloadAuthClient,
} from '../../exports/client.js'
import type { AvailableScope } from '../../types/apiKey.js'

type ApiKey = {
  id: string
  name: string | null
  start?: string | null
  startsWith?: string
  createdAt: Date
  expiresAt?: Date | null
  lastUsedAt?: Date | null
  /** Stored scope IDs for display */
  metadata?: { scopes?: string[] }
}

/** A group of scopes for a single collection */
type ScopeGroup = {
  collection: string
  label: string
  scopes: {
    type: 'read' | 'write' | 'delete' | 'other'
    scope: AvailableScope
  }[]
}

export type ApiKeysManagementClientProps = {
  /** Optional pre-configured auth client */
  authClient?: PayloadAuthClient
  /** Page title. Default: 'API Keys' */
  title?: string
  /** Available scopes for key creation. Auto-generated if not provided. */
  availableScopes?: AvailableScope[]
  /** Default scopes to pre-select when creating a key */
  defaultScopes?: string[]
}

/**
 * Group scopes by collection for the UI.
 * Scopes like "posts:read", "posts:write" get grouped under "Posts"
 */
function groupScopesByCollection(scopes: AvailableScope[]): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>()

  for (const scope of scopes) {
    // Parse scope ID like "posts:read" -> collection="posts", type="read"
    const colonIndex = scope.id.indexOf(':')
    let collection: string
    let type: 'read' | 'write' | 'delete' | 'other'

    if (colonIndex > 0) {
      collection = scope.id.substring(0, colonIndex)
      const typeStr = scope.id.substring(colonIndex + 1)
      type = ['read', 'write', 'delete'].includes(typeStr)
        ? (typeStr as 'read' | 'write' | 'delete')
        : 'other'
    } else {
      // No colon - treat as standalone scope
      collection = scope.id
      type = 'other'
    }

    if (!groups.has(collection)) {
      // Create label from collection slug (posts -> Posts)
      const label = collection.charAt(0).toUpperCase() + collection.slice(1).replace(/-/g, ' ')
      groups.set(collection, {
        collection,
        label,
        scopes: [],
      })
    }

    groups.get(collection)!.scopes.push({ type, scope })
  }

  // Sort groups alphabetically, sort scopes within group by type order
  const typeOrder = { read: 0, write: 1, delete: 2, other: 3 }
  return Array.from(groups.values())
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((group) => ({
      ...group,
      scopes: group.scopes.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]),
    }))
}

/**
 * Client component for API keys management.
 * Lists, creates, and deletes API keys with scope selection.
 */
export function ApiKeysManagementClient({
  authClient: providedClient,
  title = 'API Keys',
  availableScopes = [],
  defaultScopes = [],
}: ApiKeysManagementClientProps = {}) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyExpiry, setNewKeyExpiry] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(defaultScopes)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const hasScopes = availableScopes.length > 0

  // Group scopes by collection
  const scopeGroups = useMemo(
    () => groupScopesByCollection(availableScopes),
    [availableScopes]
  )

  // Get all scope IDs by type for bulk actions
  const scopesByType = useMemo(() => {
    const result = { read: [] as string[], write: [] as string[], delete: [] as string[] }
    for (const group of scopeGroups) {
      for (const { type, scope } of group.scopes) {
        if (type === 'read' || type === 'write' || type === 'delete') {
          result[type].push(scope.id)
        }
      }
    }
    return result
  }, [scopeGroups])

  const getClient = () => providedClient ?? createPayloadAuthClient()

  // Toggle a scope selection
  function toggleScope(scopeId: string) {
    setSelectedScopes((prev) =>
      prev.includes(scopeId)
        ? prev.filter((s) => s !== scopeId)
        : [...prev, scopeId]
    )
  }

  // Toggle all scopes in a group
  function toggleGroup(group: ScopeGroup) {
    const groupScopeIds = group.scopes.map((s) => s.scope.id)
    const allSelected = groupScopeIds.every((id) => selectedScopes.includes(id))

    if (allSelected) {
      // Deselect all in group
      setSelectedScopes((prev) => prev.filter((id) => !groupScopeIds.includes(id)))
    } else {
      // Select all in group
      setSelectedScopes((prev) => [...new Set([...prev, ...groupScopeIds])])
    }
  }

  // Toggle expand/collapse for a group
  function toggleExpanded(collection: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(collection)) {
        next.delete(collection)
      } else {
        next.add(collection)
      }
      return next
    })
  }

  // Bulk toggle all scopes of a type
  function toggleAllOfType(type: 'read' | 'write' | 'delete') {
    const typeScopes = scopesByType[type]
    const allSelected = typeScopes.every((id) => selectedScopes.includes(id))

    if (allSelected) {
      setSelectedScopes((prev) => prev.filter((id) => !typeScopes.includes(id)))
    } else {
      setSelectedScopes((prev) => [...new Set([...prev, ...typeScopes])])
    }
  }

  // Check if all scopes of a type are selected
  function isAllOfTypeSelected(type: 'read' | 'write' | 'delete'): boolean {
    return scopesByType[type].length > 0 && scopesByType[type].every((id) => selectedScopes.includes(id))
  }

  // Check if some (but not all) scopes of a type are selected
  function isSomeOfTypeSelected(type: 'read' | 'write' | 'delete'): boolean {
    const typeScopes = scopesByType[type]
    const selectedCount = typeScopes.filter((id) => selectedScopes.includes(id)).length
    return selectedCount > 0 && selectedCount < typeScopes.length
  }

  // Clear all selections
  function clearAll() {
    setSelectedScopes([])
  }

  // Select all scopes
  function selectAll() {
    setSelectedScopes(availableScopes.map((s) => s.id))
  }

  // Get group selection state
  function getGroupState(group: ScopeGroup): 'all' | 'some' | 'none' {
    const groupScopeIds = group.scopes.map((s) => s.scope.id)
    const selectedCount = groupScopeIds.filter((id) => selectedScopes.includes(id)).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === groupScopeIds.length) return 'all'
    return 'some'
  }

  // Get scope label by ID
  function getScopeLabel(scopeId: string): string {
    const scope = availableScopes.find((s) => s.id === scopeId)
    return scope?.label ?? scopeId
  }

  // Get short label for scope type
  function getTypeLabel(type: 'read' | 'write' | 'delete' | 'other'): string {
    switch (type) {
      case 'read': return 'Read'
      case 'write': return 'Write'
      case 'delete': return 'Delete'
      default: return 'Access'
    }
  }

  useEffect(() => {
    fetchApiKeys()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchApiKeys() {
    setLoading(true)
    setError(null)

    try {
      const client = getClient()
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
      const client = getClient()
      // Send scopes to server - server will convert to permissions
      const createOptions: {
        name: string
        expiresIn?: number
        scopes?: string[]
      } = { name: newKeyName }

      if (newKeyExpiry) {
        createOptions.expiresIn = parseInt(newKeyExpiry) * 24 * 60 * 60 // Convert days to seconds
      }

      // Add scopes if any are selected - server handles conversion to permissions
      if (hasScopes && selectedScopes.length > 0) {
        createOptions.scopes = selectedScopes
      }

      const result = await client.apiKey.create(createOptions)

      if (result.error) {
        setError(result.error.message ?? 'Failed to create API key')
      } else if (result.data) {
        setNewlyCreatedKey(result.data.key)
        setShowCreateForm(false)
        setNewKeyName('')
        setNewKeyExpiry('')
        setSelectedScopes(defaultScopes) // Reset to defaults
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
      const client = getClient()
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

              {/* Scope selection - grouped by collection */}
              {hasScopes && (
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
                    <BulkButton
                      label="All Delete"
                      active={isAllOfTypeSelected('delete')}
                      indeterminate={isSomeOfTypeSelected('delete')}
                      onClick={() => toggleAllOfType('delete')}
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

                  {/* Collection groups */}
                  <div
                    style={{
                      background: 'var(--theme-input-bg)',
                      border: '1px solid var(--theme-elevation-150)',
                      borderRadius: 'var(--style-radius-s)',
                      maxHeight: '400px',
                      overflowY: 'auto',
                    }}
                  >
                    {scopeGroups.map((group) => {
                      const groupState = getGroupState(group)
                      const isExpanded = expandedGroups.has(group.collection)

                      return (
                        <div
                          key={group.collection}
                          style={{
                            borderBottom: '1px solid var(--theme-elevation-100)',
                          }}
                        >
                          {/* Group header */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 'calc(var(--base) * 0.5)',
                              padding: 'calc(var(--base) * 0.5) calc(var(--base) * 0.75)',
                              cursor: 'pointer',
                              background: groupState !== 'none' ? 'var(--theme-elevation-50)' : 'transparent',
                            }}
                            onClick={() => toggleExpanded(group.collection)}
                          >
                            {/* Expand/collapse arrow */}
                            <span
                              style={{
                                color: 'var(--theme-elevation-500)',
                                fontSize: '10px',
                                width: '12px',
                                transition: 'transform 0.15s',
                                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                              }}
                            >
                              ▶
                            </span>

                            {/* Group checkbox */}
                            <IndeterminateCheckbox
                              checked={groupState === 'all'}
                              indeterminate={groupState === 'some'}
                              onChange={(e) => {
                                e.stopPropagation()
                                toggleGroup(group)
                              }}
                            />

                            {/* Group label */}
                            <span
                              style={{
                                color: 'var(--theme-text)',
                                fontSize: 'var(--font-size-small)',
                                fontWeight: 500,
                                flex: 1,
                              }}
                            >
                              {group.label}
                            </span>

                            {/* Selected count badge */}
                            {groupState !== 'none' && (
                              <span
                                style={{
                                  padding: '2px 6px',
                                  background: 'var(--theme-elevation-200)',
                                  borderRadius: '10px',
                                  fontSize: '10px',
                                  color: 'var(--theme-elevation-700)',
                                }}
                              >
                                {group.scopes.filter((s) => selectedScopes.includes(s.scope.id)).length}/{group.scopes.length}
                              </span>
                            )}
                          </div>

                          {/* Expanded scopes */}
                          {isExpanded && (
                            <div
                              style={{
                                padding: '0 calc(var(--base) * 0.75) calc(var(--base) * 0.5)',
                                paddingLeft: 'calc(var(--base) * 2.5)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 'calc(var(--base) * 0.25)',
                              }}
                            >
                              {group.scopes.map(({ type, scope }) => (
                                <label
                                  key={scope.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'calc(var(--base) * 0.5)',
                                    cursor: 'pointer',
                                    padding: 'calc(var(--base) * 0.25)',
                                    borderRadius: 'var(--style-radius-s)',
                                    background: selectedScopes.includes(scope.id)
                                      ? 'var(--theme-elevation-100)'
                                      : 'transparent',
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedScopes.includes(scope.id)}
                                    onChange={() => toggleScope(scope.id)}
                                  />
                                  <span
                                    style={{
                                      color: 'var(--theme-text)',
                                      fontSize: 'var(--font-size-small)',
                                    }}
                                  >
                                    {getTypeLabel(type)}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* Selection summary */}
                  <div
                    style={{
                      marginTop: 'calc(var(--base) * 0.5)',
                      fontSize: '11px',
                      color: selectedScopes.length === 0 ? 'var(--theme-warning-500)' : 'var(--theme-elevation-600)',
                    }}
                  >
                    {selectedScopes.length === 0
                      ? 'No permissions selected. Key will have no access.'
                      : `${selectedScopes.length} permission${selectedScopes.length === 1 ? '' : 's'} selected`}
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
                  {/* Display scopes if available */}
                  {key.metadata?.scopes && key.metadata.scopes.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'calc(var(--base) * 0.25)',
                        marginTop: 'calc(var(--base) * 0.5)',
                      }}
                    >
                      {key.metadata.scopes.map((scopeId) => (
                        <span
                          key={scopeId}
                          style={{
                            padding: '2px 6px',
                            background: 'var(--theme-elevation-100)',
                            borderRadius: 'var(--style-radius-s)',
                            fontSize: '11px',
                            color: 'var(--theme-elevation-700)',
                          }}
                        >
                          {getScopeLabel(scopeId)}
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

/**
 * Checkbox that supports indeterminate state
 */
function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (e: React.MouseEvent) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={() => {}}
      onClick={onChange}
      style={{ cursor: 'pointer' }}
    />
  )
}

export default ApiKeysManagementClient
