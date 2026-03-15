import { describe, it, expect, vi, beforeEach } from 'vitest'
import { betterAuthStrategy } from '../../src/plugin/index.js'

// Helper to create a mock payload instance
function createMockPayload(options: {
  users?: Record<string, unknown>[]
  members?: Record<string, unknown>[]
} = {}) {
  const { users = [], members = [] } = options
  return {
    find: vi.fn(async ({ collection, where }: { collection: string; where: unknown }) => {
      if (collection === 'users') {
        const idFilter = (where as { id: { equals: string } })?.id?.equals
        const docs = idFilter ? users.filter((u) => u.id === idFilter) : users
        return { docs }
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
    })

    // Mock auth instance with getSession returning no activeOrganizationId
    // and verifyApiKey returning metadata with organizationId
    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
            // No activeOrganizationId — simulates API key mock session
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: { organizationId: 'org-1' },
          },
        })),
      },
    }

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
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
            activeOrganizationId: 'org-1', // Already set
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: { organizationId: 'org-different' },
          },
        })),
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBe('org-1')
    // verifyApiKey should NOT have been called since activeOrganizationId was set
    expect(mockPayload.betterAuth.api.verifyApiKey).not.toHaveBeenCalled()
  })

  it('handles API key without metadata gracefully', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: null,
          },
        })),
      },
    }

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
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: { organizationId: 'org-1' },
          },
        })),
      },
    }

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

  it('handles verifyApiKey failure gracefully', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey: vi.fn(async () => {
          throw new Error('Verification failed')
        }),
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    // Should still return the user, just without org context
    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBeUndefined()
  })

  it('handles metadata stored as JSON string', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [testMember],
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: JSON.stringify({ organizationId: 'org-1' }),
          },
        })),
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBe('owner')
  })

  it('coerces numeric organizationId when idType is number', async () => {
    const numericMember = { user: 'user-1', organization: 42, role: 'member' }
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [numericMember],
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey: vi.fn(async () => ({
          valid: true,
          key: {
            id: 'key-1',
            userId: 'user-1',
            metadata: { organizationId: '42' },
          },
        })),
      },
    }

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
    })

    const verifyApiKey = vi.fn(async () => ({
      valid: true,
      key: {
        id: 'key-1',
        userId: 'user-1',
        metadata: { organizationId: 'org-1' },
      },
    }))

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        verifyApiKey,
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ 'x-api-key': 'sk_test_abc123' }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(verifyApiKey).toHaveBeenCalledWith({
      body: { key: 'sk_test_abc123' },
    })
  })

  it('skips API key lookup when no API key header is present (regular session)', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
    })

    const verifyApiKey = vi.fn()

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
            // No activeOrganizationId
          },
        })),
        verifyApiKey,
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'session=abc' }), // No API key header
    })

    expect(result.user).not.toBeNull()
    expect(verifyApiKey).not.toHaveBeenCalled()
  })

  it('skips API key lookup when verifyApiKey method is not available', async () => {
    const mockPayload = createMockPayload({
      users: [testUser],
    })

    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          user: { id: 'user-1' },
          session: {
            id: 'session-1',
            userId: 'user-1',
          },
        })),
        // No verifyApiKey method
      },
    }

    const strategy = betterAuthStrategy({ idType: 'text' })
    const result = await strategy.authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: 'Bearer sk_test_abc123' }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBeUndefined()
  })
})
