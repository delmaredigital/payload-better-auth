import { describe, it, expect, vi, beforeEach } from 'vitest'
import { betterAuthStrategy, apiKeyPermissionsToScopes } from '../../src/plugin/index.js'

// Helper to create a mock payload instance.
// API-key resolution now reads the api-key row directly (keyed by the mock session's
// id), so the mock supports an `apikeys` collection instead of a `verifyApiKey` API.
function createMockPayload(options: {
  users?: Record<string, unknown>[]
  members?: Record<string, unknown>[]
  apiKeys?: Record<string, unknown>[]
} = {}) {
  const { users = [], members = [], apiKeys = [] } = options
  return {
    find: vi.fn(async ({ collection, where }: { collection: string; where: any }) => {
      if (collection === 'users') {
        const idFilter = where?.id?.equals
        const docs = idFilter !== undefined ? users.filter((u) => u.id === idFilter) : users
        return { docs }
      }
      if (collection === 'apikeys') {
        // The strategy binds the lookup with an `and` of id + referenceId.
        const andFilters = where?.and ?? (where?.id ? [{ id: where.id }] : [])
        let filtered = [...apiKeys]
        for (const filter of andFilters) {
          for (const [field, condition] of Object.entries(filter) as [string, any][]) {
            if (condition?.equals !== undefined) {
              filtered = filtered.filter((k) => k[field] === condition.equals)
            }
          }
        }
        return { docs: filtered }
      }
      if (collection === 'members') {
        const andFilters = (where as { and: Array<Record<string, { equals: unknown }>> })?.and ?? []
        let filtered = [...members]
        for (const filter of andFilters) {
          for (const [field, condition] of Object.entries(filter)) {
            if (condition?.equals !== undefined) {
              filtered = filtered.filter((m) => m[field] === condition.equals)
            }
          }
        }
        return { docs: filtered }
      }
      return { docs: [] }
    }),
    betterAuth: null as unknown,
  }
}

// Helper to create mock headers
function createMockHeaders(entries: Record<string, string> = {}) {
  const headers = new Map(Object.entries(entries))
  return {
    get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    has: (name: string) => headers.has(name.toLowerCase()),
    forEach: (cb: (value: string, key: string) => void) => headers.forEach(cb),
  } as unknown as Headers
}

// Build a betterAuth mock whose getSession returns an API-key-style mock session
// (its `id` equals the api-key row id, matching Better Auth's api-key plugin).
function apiKeySession(sessionId: string | number, extra: Record<string, unknown> = {}) {
  return {
    api: {
      getSession: vi.fn(async () => {
        const response = {
          user: { id: 'user-1' },
          session: { id: sessionId, userId: 'user-1', ...extra },
        }
        return { response, headers: new Headers() }
      }),
    },
  }
}

describe('betterAuthStrategy — organization-scoped API keys', () => {
  const testUser = { id: 'user-1', email: 'test@test.com', role: 'admin' }
  const testMember = { user: 'user-1', organization: 'org-1', role: 'owner' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves org context from API key metadata when activeOrganizationId is missing', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [testMember],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: { organizationId: 'org-1' } }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBe('owner')
  })

  it('does not override activeOrganizationId when already set from session', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [testMember],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: { organizationId: 'org-different' } }],
    })
    mockPayload.betterAuth = apiKeySession('key-1', { activeOrganizationId: 'org-1' })

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    // Org context from the session must NOT be overridden by the API key's metadata.
    expect(result.user?.activeOrganizationId).toBe('org-1')
  })

  it('handles API key without metadata gracefully', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: null }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBeUndefined()
    expect(result.user?.organizationRole).toBeUndefined()
  })

  it('rejects org context when user is not a member', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [], // No memberships
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: { organizationId: 'org-1' } }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    // Should NOT have set org context since user is not a member
    expect(result.user?.activeOrganizationId).toBeUndefined()
    expect(result.user?.organizationRole).toBeUndefined()
  })

  it('handles api-key row lookup failure gracefully', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = apiKeySession('key-1')
    // Make the apikeys lookup throw (e.g. collection not configured)
    const originalFind = mockPayload.find
    mockPayload.find = vi.fn(async (args: any) => {
      if (args.collection === 'apikeys') throw new Error('Collection not found')
      return originalFind(args)
    })

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    // Should still return the user, just without org/scope context
    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBeUndefined()
    expect(result.user?.apiKeyScopes).toBeUndefined()
  })

  it('handles metadata stored as JSON string', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [testMember],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: JSON.stringify({ organizationId: 'org-1' }) }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBe('owner')
  })

  it('coerces numeric session id and organizationId when idType is number', async () => {
    const numericMember = { user: 'user-1', organization: 42, role: 'member' }
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [numericMember],
      // Serial id: the api-key row id is a number; BA returns the session id as a string.
      apiKeys: [{ id: 7, referenceId: 'user-1', metadata: { organizationId: '42' } }],
    })
    mockPayload.betterAuth = apiKeySession('7')

    const strategy = betterAuthStrategy({ idType: 'number' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe(42)
    expect(result.user?.organizationRole).toBe('member')
  })

  it('reads x-api-key header when authorization is not present', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [testMember],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: { organizationId: 'org-1' } }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ 'x-api-key': 'sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(mockPayload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'apikeys',
        where: {
          and: [{ id: { equals: 'key-1' } }, { referenceId: { equals: 'user-1' } }],
        },
      })
    )
  })

  it('skips API key lookup when no API key header is present (regular session)', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = apiKeySession('session-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'session=abc' }), // No API key header
    })

    expect(result.user).not.toBeNull()
    // The apikeys collection must never be queried for a non-API-key request.
    expect(mockPayload.find).not.toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'apikeys' })
    )
  })

  it('skips scope/org context when the session id has no matching api-key row', async () => {
    // Cookie session + a stray Bearer header: session id is a real session id, so the
    // apikeys lookup finds nothing and the request proceeds without scopes.
    const mockPayload = createMockPayload({ users: [testUser], apiKeys: [] })
    mockPayload.betterAuth = apiKeySession('session-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer not-a-real-key' }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBeUndefined()
    expect(result.user?.apiKeyScopes).toBeUndefined()
  })

  it('respects a custom apiKeysCollection slug (usePlural: false)', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    // Re-key the find to a singular 'apikey' collection.
    mockPayload.find = vi.fn(async ({ collection, where }: any) => {
      if (collection === 'users') return { docs: [testUser] }
      const idEquals = where?.and?.find((f: any) => f.id)?.id?.equals
      const refEquals = where?.and?.find((f: any) => f.referenceId)?.referenceId?.equals
      if (collection === 'apikey' && idEquals === 'key-1' && refEquals === 'user-1') {
        return { docs: [{ id: 'key-1', referenceId: 'user-1', permissions: { invoices: ['read'] }, metadata: null }] }
      }
      return { docs: [] }
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text', apiKeysCollection: 'apikey' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.apiKeyScopes).toEqual(['invoices:read'])
  })
})

describe('apiKeyPermissionsToScopes', () => {
  it('flattens a permissions map to resource:action strings', () => {
    expect(apiKeyPermissionsToScopes({ inquiries: ['write'] })).toEqual(['inquiries:write'])
    expect(apiKeyPermissionsToScopes({ invoices: ['read', 'write'] })).toEqual([
      'invoices:read',
      'invoices:write',
    ])
  })

  it('tolerates the JSON-string form (how Payload stores the text field)', () => {
    expect(apiKeyPermissionsToScopes(JSON.stringify({ inquiries: ['write'] }))).toEqual([
      'inquiries:write',
    ])
  })

  it('returns [] for absent, empty, or malformed permissions', () => {
    expect(apiKeyPermissionsToScopes(null)).toEqual([])
    expect(apiKeyPermissionsToScopes(undefined)).toEqual([])
    expect(apiKeyPermissionsToScopes({})).toEqual([])
    expect(apiKeyPermissionsToScopes('{not json')).toEqual([])
    expect(apiKeyPermissionsToScopes(['inquiries'])).toEqual([])
  })

  it('ignores non-array action values', () => {
    expect(apiKeyPermissionsToScopes({ inquiries: 'write', invoices: ['read'] })).toEqual([
      'invoices:read',
    ])
  })
})

describe('betterAuthStrategy — API key scopes on req.user', () => {
  const testUser = { id: 'user-1', email: 'test@test.com', role: 'admin' }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function mockWithPermissions(permissions: unknown) {
    const mockPayload = createMockPayload({
      users: [testUser],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', permissions, metadata: null }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')
    return mockPayload
  }

  it('surfaces apiKeyScopes from key permissions', async () => {
    const mockPayload = mockWithPermissions({ inquiries: ['write'], invoices: ['read', 'write'] })
    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.apiKeyScopes).toEqual(['inquiries:write', 'invoices:read', 'invoices:write'])
  })

  it('surfaces scopes from the JSON-string permissions form', async () => {
    const mockPayload = mockWithPermissions(JSON.stringify({ inquiries: ['write'] }))
    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.apiKeyScopes).toEqual(['inquiries:write'])
  })

  it('surfaces [] for a key with no permissions (distinguishable from non-API-key)', async () => {
    const mockPayload = mockWithPermissions(null)
    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.apiKeyScopes).toEqual([])
  })

  it('does not attach apiKeyScopes for a regular (non-API-key) session', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = apiKeySession('session-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'session=abc' }),
    })

    expect(result.user?.apiKeyScopes).toBeUndefined()
  })

  it('resolves org context and scopes from a single api-key row read', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [{ user: 'user-1', organization: 'org-1', role: 'owner' }],
      apiKeys: [{ id: 'key-1', referenceId: 'user-1', metadata: { organizationId: 'org-1' }, permissions: { inquiries: ['write'] } }],
    })
    mockPayload.betterAuth = apiKeySession('key-1')

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBe('owner')
    expect(result.user?.apiKeyScopes).toEqual(['inquiries:write'])
    // Exactly one read of the apikeys collection serves both org context and scopes.
    const apiKeyReads = mockPayload.find.mock.calls.filter(
      ([args]: [any]) => args.collection === 'apikeys'
    )
    expect(apiKeyReads).toHaveLength(1)
  })

  it('does NOT leak another user’s key scopes when session/key ids collide', async () => {
    // Privilege-escalation regression: a cookie session for user-1 whose session-row
    // id (5) collides with an API key (id 5) owned by a DIFFERENT user (user-2). An
    // attacker attaches a stray Bearer header to force the lookup. The user-binding
    // (referenceId === sessionData.user.id) must prevent reading user-2's key.
    const mockPayload = createMockPayload({
      users: [testUser],
      apiKeys: [
        { id: 5, referenceId: 'user-2', permissions: { invoices: ['read', 'write'] }, metadata: { organizationId: 'org-victim' } },
      ],
    })
    mockPayload.betterAuth = apiKeySession(5) // session.id collides with the foreign key id

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer attacker-supplied' }),
    })

    expect(result.user).not.toBeNull()
    // No scopes and no org context borrowed from the foreign key.
    expect(result.user?.apiKeyScopes).toBeUndefined()
    expect(result.user?.activeOrganizationId).toBeUndefined()
  })
})
