import { describe, it, expect, vi, beforeEach } from 'vitest'
import { betterAuthStrategy } from '../../src/plugin/index.js'

/**
 * Pins the SHAPE of the user `betterAuthStrategy` returns.
 *
 * Downstream packages discriminate on `collection` (Payload stamps it on every
 * authenticated user; payload-puck >= 0.9.0 refuses to evaluate access control
 * for a user without it), and this repo's own helpers key on `_strategy` /
 * `apiKeyScopes`. These fields were previously set but never asserted; the OAuth
 * JWT path was not exercised by any test at all.
 */

// The strategy imports `verifyBearerToken` lazily via `await import('better-auth/oauth2')`.
// vi.mock intercepts dynamic imports too, so each test can drive the verifier.
const verifyBearerToken = vi.fn()
vi.mock('better-auth/oauth2', () => ({
  verifyBearerToken: (...args: unknown[]) => verifyBearerToken(...args),
}))

function createMockPayload(options: {
  users?: Record<string, unknown>[]
  members?: Record<string, unknown>[]
  usersCollection?: string
} = {}) {
  const { users = [], members = [], usersCollection = 'users' } = options
  return {
    find: vi.fn(async ({ collection, where }: { collection: string; where: any }) => {
      if (collection === usersCollection) {
        const idFilter = where?.id?.equals
        return { docs: idFilter !== undefined ? users.filter((u) => u.id === idFilter) : users }
      }
      if (collection === 'members') {
        const andFilters = (where?.and ?? []) as Array<Record<string, { equals: unknown }>>
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
      throw new Error(`Collection not found: ${collection}`)
    }),
    betterAuth: null as unknown,
  }
}

function createMockHeaders(entries: Record<string, string> = {}) {
  const headers = new Map(Object.entries(entries))
  return {
    get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    has: (name: string) => headers.has(name.toLowerCase()),
  } as unknown as Headers
}

const cookieSession = (
  userId: string,
  extra: Record<string, unknown> = {},
  setCookies: string[] = []
) => ({
  api: {
    getSession: vi.fn(async () => {
      const response = { user: { id: userId }, session: { id: 'sess-1', userId, ...extra } }
      const headers = new Headers()
      for (const cookie of setCookies) headers.append('set-cookie', cookie)
      return { response, headers }
    }),
  },
  options: { baseURL: 'https://example.com' },
})

const noSession = (options: Record<string, unknown> | undefined = { baseURL: 'https://example.com' }) => ({
  api: {
    getSession: vi.fn(async () => {
      return { response: null, headers: new Headers() }
    }),
  },
  options,
})

describe('betterAuthStrategy — user shape on the session (cookie / API key) path', () => {
  const testUser = { id: 'user-1', email: 'test@test.com', role: 'admin' }

  beforeEach(() => {
    vi.restoreAllMocks()
    verifyBearerToken.mockReset()
  })

  it('stamps collection and _strategy on the returned user', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = cookieSession('user-1')

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
    })

    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'test@test.com',
      collection: 'users',
      _strategy: 'better-auth',
    })
  })

  it('stamps the configured usersCollection, not the default', async () => {
    const mockPayload = createMockPayload({ users: [testUser], usersCollection: 'members' })
    mockPayload.betterAuth = cookieSession('user-1')

    const result = await betterAuthStrategy({ idType: 'text', usersCollection: 'members' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
    })

    expect(result.user?.collection).toBe('members')
    expect(mockPayload.find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'members' }))
  })

  it('does not let a user-document field or a session field override collection / _strategy', async () => {
    // A hostile or accidental `collection` column on the users row, or a session
    // field of the same name, must not change what Payload evaluates access against.
    const mockPayload = createMockPayload({
      users: [{ ...testUser, collection: 'admins', _strategy: 'local-jwt' }],
    })
    mockPayload.betterAuth = cookieSession('user-1', { collection: 'admins', _strategy: 'spoofed' })

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
    })

    expect(result.user?.collection).toBe('users')
    expect(result.user?._strategy).toBe('better-auth')
  })

  it('returns { user: null } (never a bare or foreign object) when the session user has no Payload row', async () => {
    const mockPayload = createMockPayload({ users: [] })
    mockPayload.betterAuth = cookieSession('ghost')

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
    })

    expect(result).toEqual({ user: null })
  })

  it('forwards Better Auth Set-Cookie headers when Payload can set headers', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    const mockAuth = cookieSession('user-1', {}, ['a=1; Path=/', 'b=2; Path=/'])
    mockPayload.betterAuth = mockAuth

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
      canSetHeaders: true,
    })

    expect(result.responseHeaders?.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('passes the disableRefresh option when Payload cannot set headers', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    const mockAuth = cookieSession('user-1', {}, ['a=1; Path=/'])
    mockPayload.betterAuth = mockAuth

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=abc' }),
      canSetHeaders: false,
    })

    expect(result.responseHeaders).toBeUndefined()
    expect(mockAuth.api.getSession).toHaveBeenCalledWith({
      headers: expect.anything(),
      returnHeaders: true,
      query: { disableRefresh: true },
    })
  })

  it('forwards Set-Cookie on a null session too (Better Auth clearing an expired cookie)', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    const cleared = 'better-auth.session_token=; Max-Age=0; Path=/'
    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => {
          const headers = new Headers()
          headers.append('set-cookie', cleared)
          return { response: null, headers }
        }),
      },
      options: { baseURL: 'https://example.com' },
    }

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ cookie: 'better-auth.session_token=stale' }),
      canSetHeaders: true,
    })

    expect(result.user).toBeNull()
    expect(result.responseHeaders?.getSetCookie()).toEqual([cleared])
  })

  it('tolerates getSession returning no headers object (before-hook short-circuit, e.g. the api-key plugin)', async () => {
    // Better Auth's dispatch returns `{ headers: undefined, response }` when a
    // plugin before-hook answers /get-session itself, which the api-key plugin does.
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = {
      api: {
        getSession: vi.fn(async () => ({
          response: { user: { id: 'user-1' }, session: { id: 'sess-1', userId: 'user-1' } },
          headers: undefined,
        })),
      },
      options: { baseURL: 'https://example.com' },
    }

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ 'x-api-key': 'sk_test_abc' }),
      canSetHeaders: true,
    })

    expect(result.user?.id).toBe('user-1')
    expect(result.responseHeaders).toBeUndefined()
  })

})

describe('betterAuthStrategy — OAuth JWT bearer path', () => {
  const testUser = { id: 'user-1', email: 'test@test.com', role: 'editor' }
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.sig'

  beforeEach(() => {
    vi.restoreAllMocks()
    verifyBearerToken.mockReset()
  })

  it('verifies the bearer token against issuer/audience/JWKS derived from baseURL + basePath', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'user-1', scope: 'pages:read pages:write' })
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession({ baseURL: 'https://example.com', basePath: '/auth' })

    await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(verifyBearerToken).toHaveBeenCalledWith(jwt, {
      jwksUrl: 'https://example.com/auth/jwks',
      verifyOptions: { issuer: 'https://example.com/auth', audience: 'https://example.com' },
    })
  })

  it('defaults basePath to /api/auth', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'user-1' })
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession({ baseURL: 'https://example.com' })

    await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(verifyBearerToken).toHaveBeenCalledWith(
      jwt,
      expect.objectContaining({ jwksUrl: 'https://example.com/api/auth/jwks' })
    )
  })

  it('returns the Payload user stamped with collection, _strategy and oauthScopes', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'user-1', scope: 'pages:read pages:write' })
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result.user).toMatchObject({
      id: 'user-1',
      email: 'test@test.com',
      role: 'editor',
      collection: 'users',
      _strategy: 'better-auth',
      oauthScopes: ['pages:read', 'pages:write'],
    })
    // Not an API key: apiKeyScopes must stay absent so consumers can tell the paths apart.
    expect(result.user?.apiKeyScopes).toBeUndefined()
  })

  it('accepts an array-valued scope claim and yields [] when scope is absent', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession()
    const strategy = betterAuthStrategy({ idType: 'text' })
    const headers = createMockHeaders({ authorization: `Bearer ${jwt}` })

    verifyBearerToken.mockResolvedValue({ sub: 'user-1', scope: ['a:read', 'b:write'] })
    expect((await strategy.authenticate({ payload: mockPayload as any, headers })).user?.oauthScopes).toEqual(['a:read', 'b:write'])

    verifyBearerToken.mockResolvedValue({ sub: 'user-1' })
    expect((await strategy.authenticate({ payload: mockPayload as any, headers })).user?.oauthScopes).toEqual([])
  })

  it('resolves organization context and role from the organizationId claim', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'user-1', organizationId: 'org-1' })
    const mockPayload = createMockPayload({
      users: [testUser],
      members: [{ user: 'user-1', organization: 'org-1', role: 'owner' }],
    })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBe('owner')
  })

  it('carries organizationId but no role when the user is not a member of that org', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'user-1', organizationId: 'org-1' })
    const mockPayload = createMockPayload({ users: [testUser], members: [] })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result.user).not.toBeNull()
    expect(result.user?.activeOrganizationId).toBe('org-1')
    expect(result.user?.organizationRole).toBeUndefined()
  })

  it('fails closed when baseURL is not configured (never calls the verifier)', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession({})

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result).toEqual({ user: null })
    expect(verifyBearerToken).not.toHaveBeenCalled()
  })

  it('fails closed when verification throws', async () => {
    verifyBearerToken.mockRejectedValue(new Error('signature verification failed'))
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result).toEqual({ user: null })
  })

  it('fails closed when the verified sub has no Payload user', async () => {
    verifyBearerToken.mockResolvedValue({ sub: 'nobody' })
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ authorization: `Bearer ${jwt}` }),
    })

    expect(result).toEqual({ user: null })
  })

  it('does not attempt JWT verification without a Bearer authorization header', async () => {
    const mockPayload = createMockPayload({ users: [testUser] })
    mockPayload.betterAuth = noSession()

    const result = await betterAuthStrategy({ idType: 'text' }).authenticate({
      payload: mockPayload as any,
      headers: createMockHeaders({ 'x-api-key': 'sk_not_recognised_by_this_mock' }),
    })

    expect(result).toEqual({ user: null })
    expect(verifyBearerToken).not.toHaveBeenCalled()
  })
})
